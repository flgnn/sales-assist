const { bootstrap, tokens, auth, makeAnalyzedSession, request } = require("./helpers");

let app, db, t;
beforeAll(async () => { ({ app, db } = bootstrap()); t = await tokens(app); });

const auditActions = (id) => db.prepare("SELECT action, from_value, to_value, actor_role FROM audit_logs WHERE entity_type='session' AND entity_id=? ORDER BY id").all(id);

describe("Alur persetujuan berjenjang + audit log", () => {
  test("draft -> diajukan -> ditolak (wajib catatan) -> diajukan ulang -> disetujui -> diterbitkan; semua tercatat", async () => {
    const id = await makeAnalyzedSession(app, t.sales);

    let r = await request(app).post(`/api/sessions/${id}/submit`).set(auth(t.sales));
    expect(r.status).toBe(200);
    expect(r.body.session.approval_status).toBe("diajukan");

    // terkunci saat diajukan
    r = await request(app).put(`/api/sessions/${id}`).set(auth(t.sales)).send({ nama_pelanggan: "X", kebutuhan: "Y" });
    expect(r.status).toBe(409);
    r = await request(app).post(`/api/sessions/${id}/analyze`).set(auth(t.sales)).send({});
    expect(r.status).toBe(409);

    // tolak tanpa catatan -> 400
    r = await request(app).post(`/api/sessions/${id}/decision`).set(auth(t.manager)).send({ decision: "reject" });
    expect(r.status).toBe(400);
    r = await request(app).post(`/api/sessions/${id}/decision`).set(auth(t.manager)).send({ decision: "reject", note: "Harga PSB perlu dicek ulang" });
    expect(r.status).toBe(200);
    expect(r.body.session.approval_status).toBe("ditolak");
    expect(r.body.session.decision_note).toMatch(/PSB/);

    // setelah ditolak, sales boleh mengedit & mengajukan ulang
    r = await request(app).put(`/api/sessions/${id}`).set(auth(t.sales)).send({ nama_pelanggan: "PT Uji Revisi", kebutuhan: "CCTV 10 titik" });
    expect(r.status).toBe(200);
    r = await request(app).post(`/api/sessions/${id}/submit`).set(auth(t.sales));
    expect(r.body.session.approval_status).toBe("diajukan");

    r = await request(app).post(`/api/sessions/${id}/decision`).set(auth(t.manager)).send({ decision: "approve", note: "OK" });
    expect(r.body.session.approval_status).toBe("disetujui");

    // belum boleh diterbitkan sebelum disetujui? sudah disetujui -> boleh
    r = await request(app).post(`/api/sessions/${id}/approve`).set(auth(t.sales));
    expect(r.status).toBe(200);
    expect(r.body.rab_nomor).toMatch(/^RAB\//);
    const nomor = r.body.rab_nomor;
    r = await request(app).post(`/api/sessions/${id}/approve`).set(auth(t.sales));
    expect(r.body.rab_nomor).toBe(nomor); // idempoten

    const acts = auditActions(id).map(a => a.action);
    expect(acts).toEqual(["session.submit", "session.reject", "session.resubmit", "session.approve", "session.finalize"]);
    // 100% perubahan status tercatat: setiap perubahan from->to konsisten
    const trail = auditActions(id).filter(a => a.action !== "session.finalize");
    expect(trail.map(a => `${a.from_value}>${a.to_value}`)).toEqual(["draft>diajukan", "diajukan>ditolak", "ditolak>diajukan", "diajukan>disetujui"]);
    expect(trail[1].actor_role).toBe("manager");

    // disetujui = terkunci permanen
    r = await request(app).delete(`/api/sessions/${id}`).set(auth(t.sales));
    expect(r.status).toBe(409);
  });

  test("tidak dapat diterbitkan sebelum disetujui", async () => {
    const id = await makeAnalyzedSession(app, t.sales);
    const r = await request(app).post(`/api/sessions/${id}/approve`).set(auth(t.sales));
    expect(r.status).toBe(409);
  });

  test("pengajuan kosong ditolak; sales hanya bisa mengajukan miliknya; tarik pengajuan", async () => {
    const c = await request(app).post("/api/sessions").set(auth(t.sales)).send({ nama_pelanggan: "PT Kosong", kebutuhan: "internet" });
    let r = await request(app).post(`/api/sessions/${c.body.session.id}/submit`).set(auth(t.sales));
    expect(r.status).toBe(400);

    const id = await makeAnalyzedSession(app, t.sales);
    r = await request(app).post(`/api/sessions/${id}/submit`).set(auth(t.sales2));
    expect(r.status).toBe(404); // tidak terlihat oleh sales lain
    await request(app).post(`/api/sessions/${id}/submit`).set(auth(t.sales));
    r = await request(app).post(`/api/sessions/${id}/recall`).set(auth(t.sales));
    expect(r.body.session.approval_status).toBe("draft");
    // transisi tidak sah: tarik saat draft
    r = await request(app).post(`/api/sessions/${id}/recall`).set(auth(t.sales));
    expect(r.status).toBe(409);
  });

  test("pemisahan tugas: manajer tidak boleh memutuskan RAB miliknya; admin & sales tidak boleh memutuskan", async () => {
    const id = await makeAnalyzedSession(app, t.sales);
    await request(app).post(`/api/sessions/${id}/submit`).set(auth(t.sales));
    expect((await request(app).post(`/api/sessions/${id}/decision`).set(auth(t.sales)).send({ decision: "approve" })).status).toBe(403);
    expect((await request(app).post(`/api/sessions/${id}/decision`).set(auth(t.admin)).send({ decision: "approve" })).status).toBe(403);

    // RAB milik manajer sendiri
    const mgrSession = db.prepare("INSERT INTO sessions (user_id, nama_pelanggan, kebutuhan, approval_status) VALUES ((SELECT id FROM users WHERE username='manager'), 'PT M', 'x', 'diajukan')").run().lastInsertRowid;
    const r = await request(app).post(`/api/sessions/${mgrSession}/decision`).set(auth(t.manager)).send({ decision: "approve" });
    expect(r.status).toBe(403);
  });

  test("manajer dapat membaca sesi tetapi tidak dapat mengubahnya; antrean persetujuan", async () => {
    const id = await makeAnalyzedSession(app, t.sales);
    await request(app).post(`/api/sessions/${id}/submit`).set(auth(t.sales));
    expect((await request(app).get(`/api/sessions/${id}`).set(auth(t.manager))).status).toBe(200);
    expect((await request(app).put(`/api/sessions/${id}`).set(auth(t.manager)).send({ nama_pelanggan: "x", kebutuhan: "y" })).status).toBe(403);
    const q = await request(app).get("/api/approvals?status=diajukan").set(auth(t.manager));
    expect(q.status).toBe(200);
    expect(q.body.approvals.some(a => a.id === id && a.total > 0)).toBe(true);
    const au = await request(app).get(`/api/sessions/${id}/audit`).set(auth(t.manager));
    expect(au.body.rows[0].action).toBe("session.submit");
  });

  test("keterlacakan harga: item rekomendasi menyimpan produk + versi harga", async () => {
    const id = await makeAnalyzedSession(app, t.sales);
    const tr = await request(app).get(`/api/sessions/${id}/price-trace`).set(auth(t.sales));
    expect(tr.body.items.length).toBeGreaterThan(0);
    expect(tr.body.items.every(i => i.tracked && i.versi_acuan === 1)).toBe(true);
  });
});
