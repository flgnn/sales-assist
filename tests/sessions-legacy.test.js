// Regresi fitur versi KP yang dipertahankan: riwayat, bookmark, dashboard, clone, edit item, hapus.
const { bootstrap, tokens, auth, makeAnalyzedSession, makeApprovedSession, request } = require("./helpers");

let app, db, t;
beforeAll(async () => { ({ app, db } = bootstrap()); t = await tokens(app); });

test("riwayat: pencarian, sortir, paginasi, filter witel", async () => {
  await makeAnalyzedSession(app, t.sales, { nama_pelanggan: "PT Alfa" });
  await makeAnalyzedSession(app, t.sales, { nama_pelanggan: "CV Beta" });
  let r = await request(app).get("/api/sessions?q=alfa").set(auth(t.sales));
  expect(r.status).toBe(200);
  expect(JSON.stringify(r.body)).toMatch(/PT Alfa/);
  expect(r.body.sessions[0].approval_status).toBe("draft"); // riwayat menampilkan status persetujuan
  for (const q of ["sort=oldest", "sort=name", "sortBy=nama_pelanggan&sortDir=asc", "witel=priangan", "page=1&limit=1"]) {
    expect((await request(app).get(`/api/sessions?${q}`).set(auth(t.sales))).status).toBe(200);
  }
});

test("dashboard & bookmark & arsip", async () => {
  const id = await makeAnalyzedSession(app, t.sales);
  expect((await request(app).get("/api/sessions/dashboard/summary").set(auth(t.sales))).status).toBe(200);
  expect((await request(app).get("/api/sessions/dashboard/summary?witel=priangan&start_date=2020-01-01&end_date=2100-01-01").set(auth(t.sales))).status).toBe(200);
  const b = await request(app).put(`/api/sessions/${id}/bookmark`).set(auth(t.sales));
  expect(b.body.bookmarked).toBe(true);
  const list = await request(app).get("/api/sessions/bookmarks").set(auth(t.sales));
  expect(JSON.stringify(list.body)).toContain(String(id));
  expect((await request(app).get("/api/sessions/archives").set(auth(t.sales))).status).toBe(200);
  expect((await request(app).put(`/api/sessions/${id}/bookmark`).set(auth(t.sales))).body.bookmarked).toBe(false);
});

test("edit item: ubah qty/harga menandai DIEDIT SALES; tambah manual dengan acuan produk; hapus item", async () => {
  const id = await makeAnalyzedSession(app, t.sales);
  const items = (await request(app).get(`/api/sessions/${id}`).set(auth(t.sales))).body.items;
  const put = await request(app).put(`/api/sessions/${id}/items/${items[0].id}`).set(auth(t.sales)).send({ qty: 7, diskon_satuan: 10 });
  expect(put.body.item).toMatchObject({ qty: 7, sumber: "DIEDIT SALES" });
  const pid = db.prepare("SELECT id FROM master_products WHERE sheet='hsi' LIMIT 1").get().id;
  const add = await request(app).post(`/api/sessions/${id}/items`).set(auth(t.sales)).send({ nama: "Manual HSI", harga: 1, product_id: pid });
  expect(add.status).toBe(201);
  expect(add.body.item.product_id).toBe(pid);
  expect((await request(app).post(`/api/sessions/${id}/items`).set(auth(t.sales)).send({})).status).toBe(400);
  expect((await request(app).delete(`/api/sessions/${id}/items/${add.body.item.id}`).set(auth(t.sales))).body.deleted).toBe(true);
  expect((await request(app).delete(`/api/sessions/${id}/items/999999`).set(auth(t.sales))).status).toBe(404);
  expect((await request(app).put(`/api/sessions/${id}/items/999999`).set(auth(t.sales)).send({ qty: 1 })).status).toBe(404);
});

test("clone RAB yang sudah disetujui menjadi draft baru yang dapat diedit, membawa acuan versi harga", async () => {
  const id = await makeApprovedSession(app, t);
  const c = await request(app).post(`/api/sessions/${id}/clone`).set(auth(t.sales));
  expect(c.status).toBe(201);
  expect(c.body.session.approval_status).toBe("draft");
  expect(c.body.session.rab_nomor).toBeNull();
  expect(c.body.items.every(i => i.price_version_id)).toBe(true);
  const upd = await request(app).put(`/api/sessions/${c.body.session.id}`).set(auth(t.sales)).send({ nama_pelanggan: "PT Clone", kebutuhan: "x", budget: "5000000" });
  expect(upd.status).toBe(200);
  expect((await request(app).delete(`/api/sessions/${c.body.session.id}`).set(auth(t.sales))).body.deleted).toBe(true);
  expect(db.prepare("SELECT action FROM audit_logs WHERE action='session.delete'").all()).toHaveLength(1);
});

test("analisis ulang dengan budget menyimpan pagu; validasi pembuatan sesi", async () => {
  const id = await makeAnalyzedSession(app, t.sales);
  const a = await request(app).post(`/api/sessions/${id}/analyze`).set(auth(t.sales)).send({ budget: 800000 });
  expect(a.status).toBe(200);
  expect(db.prepare("SELECT budget FROM sessions WHERE id=?").get(id).budget).toBe(800000);
  expect((await request(app).post("/api/sessions").set(auth(t.sales)).send({ nama_pelanggan: "x" })).status).toBe(400);
  expect((await request(app).get("/api/sessions/999999").set(auth(t.sales))).status).toBe(404);
});

test("migrasi KP: RAB lama berstatus completed dianggap disetujui", () => {
  expect(db.getMeta("legacy_approval_backfill")).toBe("1");
});
