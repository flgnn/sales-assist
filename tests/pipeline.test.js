const { bootstrap, tokens, auth, makeApprovedSession, request } = require("./helpers");

let app, db, t;
beforeAll(async () => { ({ app, db } = bootstrap()); t = await tokens(app); });

const create = (body, token = t.sales) => request(app).post("/api/pipeline").set(auth(token)).send(body);
const stage = (id, body, token = t.sales) => request(app).post(`/api/pipeline/${id}/stage`).set(auth(token)).send(body);

describe("Pipeline penjualan", () => {
  test("seluruh status: prospek -> penawaran -> negosiasi -> menang, dengan riwayat & audit", async () => {
    const o = (await create({ nama_pelanggan: "PT Menang", nilai: 1000000, next_followup_at: "2030-01-01" })).body.opportunity;
    expect(o.stage).toBe("prospek");
    for (const s of ["penawaran", "negosiasi", "menang"]) {
      const r = await stage(o.id, { stage: s });
      expect(r.status).toBe(200);
      expect(r.body.opportunity.stage).toBe(s);
    }
    const d = await request(app).get(`/api/pipeline/${o.id}`).set(auth(t.sales));
    expect(d.body.events.map(e => e.to_stage)).toEqual(["prospek", "penawaran", "negosiasi", "menang"]);
    expect(d.body.opportunity.closed_at).toBeTruthy();
    expect(db.prepare("SELECT COUNT(*) c FROM audit_logs WHERE entity_type='opportunity' AND entity_id=? AND action='opportunity.stage'").get(o.id).c).toBe(3);
    // status final tidak dapat diubah
    expect((await stage(o.id, { stage: "kalah", lost_reason: "harga" })).status).toBe(409);
    expect((await request(app).put(`/api/pipeline/${o.id}`).set(auth(t.sales)).send({ nilai: 5 })).status).toBe(409);
  });

  test("kalah wajib alasan; transisi tidak sah ditolak", async () => {
    const o = (await create({ nama_pelanggan: "PT Kalah", nilai: 500000 })).body.opportunity;
    expect((await stage(o.id, { stage: "menang" })).status).toBe(409);      // prospek -> menang tidak sah
    expect((await stage(o.id, { stage: "kalah" })).status).toBe(400);       // tanpa alasan
    const r = await stage(o.id, { stage: "kalah", lost_reason: "Harga pesaing lebih rendah" });
    expect(r.body.opportunity).toMatchObject({ stage: "kalah", lost_reason: "Harga pesaing lebih rendah" });
    expect((await stage(o.id, { stage: "ngawur" })).status).toBe(400);
  });

  test("dibuat dari RAB: nilai default = total RAB; satu RAB satu peluang; RAB milik orang lain ditolak", async () => {
    const sid = await makeApprovedSession(app, t);
    const r = await create({ session_id: sid });
    expect(r.status).toBe(201);
    expect(r.body.opportunity.nilai).toBeGreaterThan(0);
    expect((await create({ session_id: sid })).status).toBe(409);
    expect((await create({ session_id: sid }, t.sales2)).status).toBe(404);
    expect((await create({})).status).toBe(400);
  });

  test("kepemilikan: sales lain tidak melihat; manajer/admin melihat semua tapi tidak bisa mengubah", async () => {
    const o = (await create({ nama_pelanggan: "PT Privat", nilai: 10 })).body.opportunity;
    expect((await request(app).get(`/api/pipeline/${o.id}`).set(auth(t.sales2))).status).toBe(404);
    expect((await request(app).get(`/api/pipeline/${o.id}`).set(auth(t.manager))).status).toBe(200);
    expect((await stage(o.id, { stage: "penawaran" }, t.manager)).status).toBe(403);
    expect((await request(app).put(`/api/pipeline/${o.id}`).set(auth(t.manager)).send({ nilai: 1 })).status).toBe(404);
    const mine = await request(app).get("/api/pipeline").set(auth(t.sales2));
    expect(mine.body.opportunities.every(x => x.owner_name !== "Akbar Trisnamulya Putra")).toBe(true);
    const all = await request(app).get("/api/pipeline").set(auth(t.manager));
    expect(all.body.opportunities.some(x => x.nama_pelanggan === "PT Privat")).toBe(true);
  });

  test("ringkasan: nilai pipeline, win rate = menang/(menang+kalah), alasan kalah, filter owner/tanggal", async () => {
    const s = await request(app).get("/api/pipeline/summary").set(auth(t.manager));
    expect(s.status).toBe(200);
    const { won_count, lost_count, win_rate, open_value, lost_reasons } = s.body;
    expect(won_count).toBeGreaterThanOrEqual(1);
    expect(lost_count).toBeGreaterThanOrEqual(1);
    expect(win_rate).toBeCloseTo(won_count / (won_count + lost_count), 5);
    expect(open_value).toBeGreaterThan(0);
    expect(lost_reasons[0].reason).toMatch(/pesaing/);
    const empty = await request(app).get("/api/pipeline/summary?from=2000-01-01&to=2000-01-02").set(auth(t.manager));
    expect(empty.body.win_rate).toBeNull();
    const own = await request(app).get("/api/pipeline/summary").set(auth(t.sales2));
    expect(own.body.won_count).toBe(0);
    expect((await request(app).get("/api/pipeline/summary?from=bukan-tanggal").set(auth(t.manager))).status).toBe(400);
  });

  test("pengingat: terlambat / hari ini / mendatang; ubah tindak lanjut", async () => {
    const { todayWib } = require("../src/services/pipelineService");
    const a = (await create({ nama_pelanggan: "PT Telat", next_followup_at: todayWib(-3) }, t.sales2)).body.opportunity;
    const b = (await create({ nama_pelanggan: "PT Hari Ini", next_followup_at: todayWib(0) }, t.sales2)).body.opportunity;
    const c = (await create({ nama_pelanggan: "PT Nanti", next_followup_at: todayWib(3) }, t.sales2)).body.opportunity;
    (await create({ nama_pelanggan: "PT Jauh", next_followup_at: todayWib(30) }, t.sales2));
    const r = (await request(app).get("/api/pipeline/reminders?days=7").set(auth(t.sales2))).body;
    expect(r.overdue.map(o => o.id)).toEqual([a.id]);
    expect(r.today_due.map(o => o.id)).toEqual([b.id]);
    expect(r.upcoming.map(o => o.id)).toEqual([c.id]);
    const sum = (await request(app).get("/api/pipeline/summary").set(auth(t.sales2))).body.reminders;
    expect(sum).toEqual({ overdue: 1, today: 1, upcoming: 1 });
    // selesaikan tindak lanjut: jadwalkan ulang
    await request(app).put(`/api/pipeline/${a.id}`).set(auth(t.sales2)).send({ next_followup_at: todayWib(10), followup_note: "Telepon lagi" });
    expect((await request(app).get("/api/pipeline/reminders").set(auth(t.sales2))).body.overdue).toHaveLength(0);
  });

  test("penjadwal email pengingat mengirim sekali sehari ke pemilik berEmail", async () => {
    const { todayWib } = require("../src/services/pipelineService");
    const { runOnce, start } = require("../src/services/reminderScheduler");
    db.prepare("UPDATE users SET email='sales2@contoh.co.id' WHERE username='sales2'").run();
    await create({ nama_pelanggan: "PT Email", next_followup_at: todayWib(-1) }, t.sales2);
    const first = await runOnce();
    expect(first.sent).toBe(1);
    expect((await runOnce()).sent).toBe(0); // sudah dikirim hari ini
    expect(start()).toBeNull(); // nonaktif tanpa REMINDER_EMAIL=1
  });

  test("hapus: hanya prospek milik sendiri", async () => {
    const o = (await create({ nama_pelanggan: "PT Hapus" })).body.opportunity;
    expect((await request(app).delete(`/api/pipeline/${o.id}`).set(auth(t.sales2))).status).toBe(404);
    await stage(o.id, { stage: "penawaran" });
    expect((await request(app).delete(`/api/pipeline/${o.id}`).set(auth(t.sales))).status).toBe(409);
    const p = (await create({ nama_pelanggan: "PT Hapus2" })).body.opportunity;
    expect((await request(app).delete(`/api/pipeline/${p.id}`).set(auth(t.sales))).body.deleted).toBe(true);
  });
});
