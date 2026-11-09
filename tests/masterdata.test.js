const ExcelJS = require("exceljs");
const { bootstrap, tokens, auth, makeAnalyzedSession, request } = require("./helpers");

let app, db, t;
beforeAll(async () => { ({ app, db } = bootstrap()); t = await tokens(app); });

async function xlsx(rows) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Produk");
  rows.forEach(r => ws.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
}
const post = (buf, q = "") => request(app).post(`/api/master-data/import${q}`).set(auth(t.admin)).set("Content-Type", "application/octet-stream").send(buf);

describe("Master data: CRUD + riwayat versi harga", () => {
  let id;
  test("create membuat versi harga 1 dan audit", async () => {
    const r = await request(app).post("/api/master-data").set(auth(t.admin)).send({ sheet: "hsi", layanan: "1S", paket: "HSI Uji", lokasi: "Bisnis", mbps: 77, harga: 500000, psb: 0 });
    expect(r.status).toBe(201);
    id = r.body.product.id;
    expect(r.body.product.price_version).toBe(1);
    expect(db.prepare("SELECT COUNT(*) c FROM audit_logs WHERE action='product.create' AND entity_id=?").get(id).c).toBe(1);
  });

  test("duplikat ditolak 409; validasi 400", async () => {
    let r = await request(app).post("/api/master-data").set(auth(t.admin)).send({ sheet: "hsi", layanan: "1S", paket: "HSI Uji", lokasi: "Bisnis", mbps: 77, harga: 1 });
    expect(r.status).toBe(409);
    r = await request(app).post("/api/master-data").set(auth(t.admin)).send({ sheet: "xx", layanan: "A", paket: "B", harga: 1 });
    expect(r.status).toBe(400);
    r = await request(app).post("/api/master-data").set(auth(t.admin)).send({ sheet: "hsi", layanan: "A", paket: "B", harga: -5 });
    expect(r.status).toBe(400);
  });

  test("100% perubahan harga tercatat: tiap perubahan = versi baru + audit; non-harga tidak membuat versi", async () => {
    let r = await request(app).put(`/api/master-data/${id}`).set(auth(t.admin)).send({ harga: 550000, reason: "Kenaikan tarif" });
    expect(r.body.product.price_version).toBe(2);
    r = await request(app).put(`/api/master-data/${id}`).set(auth(t.admin)).send({ harga: 550000, psb: 100000 });
    expect(r.body.product.price_version).toBe(3);
    r = await request(app).put(`/api/master-data/${id}`).set(auth(t.admin)).send({ harga: 550000, psb: 100000 }); // sama
    expect(r.body.product.price_version).toBe(3);
    const v = await request(app).get(`/api/master-data/${id}/versions`).set(auth(t.sales));
    expect(v.body.versions.map(x => [x.version, x.harga, x.psb])).toEqual([[3, 550000, 100000], [2, 550000, 0], [1, 500000, 0]]);
    expect(db.prepare("SELECT COUNT(*) c FROM audit_logs WHERE action='product.price_change' AND entity_id=?").get(id).c).toBe(2);
  });

  test("RAB lama tetap menunjuk versi harga acuannya setelah harga berubah", async () => {
    const prod = db.prepare("SELECT id, harga FROM master_products WHERE sheet='dbt' AND layanan='Antares Eazy' LIMIT 1").get();
    const sid = await makeAnalyzedSession(app, t.sales);
    const before = (await request(app).get(`/api/sessions/${sid}/price-trace`).set(auth(t.sales))).body.items;
    const tracked = before.find(i => i.product_id === prod.id) || before[0];
    await request(app).put(`/api/master-data/${tracked.product_id}`).set(auth(t.admin)).send({ harga: tracked.harga_rab + 1000, reason: "uji jejak" });
    const after = (await request(app).get(`/api/sessions/${sid}/price-trace`).set(auth(t.sales))).body.items.find(i => i.item_id === tracked.item_id);
    expect(after.versi_acuan).toBe(1);
    expect(after.harga_acuan).toBe(tracked.harga_rab);
    expect(after.versi_terkini).toBe(2);
    expect(after.harga_berubah_sejak_rab).toBe(true);
    // harga di RAB tidak berubah diam-diam
    expect(after.harga_rab).toBe(tracked.harga_rab);
  });

  test("nonaktif: tidak tampil di daftar sales, tampil untuk admin; hard delete diblokir bila dipakai RAB", async () => {
    let r = await request(app).delete(`/api/master-data/${id}`).set(auth(t.admin));
    expect(r.body.deactivated).toBe(true);
    expect((await request(app).get("/api/master-data?q=HSI Uji").set(auth(t.sales))).body.total).toBe(0);
    expect((await request(app).get("/api/master-data?q=HSI Uji&include_inactive=1").set(auth(t.admin))).body.total).toBe(1);
    expect((await request(app).get("/api/master-data?q=HSI Uji&include_inactive=1").set(auth(t.sales))).body.total).toBe(0); // sales tak bisa memaksa
    r = await request(app).post(`/api/master-data/${id}/reactivate`).set(auth(t.admin));
    expect(r.body.product.is_active).toBe(1);

    const used = db.prepare("SELECT product_id FROM session_items WHERE product_id IS NOT NULL LIMIT 1").get().product_id;
    r = await request(app).delete(`/api/master-data/${used}?hard=1`).set(auth(t.admin));
    expect(r.status).toBe(409);
    r = await request(app).delete(`/api/master-data/${id}?hard=1`).set(auth(t.admin));
    expect(r.body.deleted).toBe(true);
    expect((await request(app).get(`/api/master-data/${id}`).set(auth(t.admin))).status).toBe(404);
  });

  test("lookup & sheets & detail", async () => {
    expect((await request(app).get("/api/master-data/lookup?nama=astinet").set(auth(t.sales))).body.found).toBe(true);
    expect((await request(app).get("/api/master-data/lookup?nama=zzzzqq").set(auth(t.sales))).body.found).toBe(false);
    expect((await request(app).get("/api/master-data/sheets").set(auth(t.sales))).body.sheets.length).toBe(4);
    expect((await request(app).get("/api/master-data?sheet=wifi&q=gold").set(auth(t.sales))).body.rows.length).toBeGreaterThan(0);
  });
});

describe("Impor Excel dengan validasi", () => {
  const HEADER = ["sheet", "layanan", "paket", "lokasi", "mbps", "harga", "psb"];

  test("dry run melaporkan baris valid/tidak valid tanpa menulis", async () => {
    const buf = await xlsx([HEADER, ["hsi", "1S", "HSI Impor", "Bisnis", 40, 111000, 0], ["zzz", "A", "B", "", 1, 1, 0], ["hsi", "", "B", "", 1, 1, 0], ["hsi", "1S", "HSI Impor", "Bisnis", 40, 222000, 0], ["hsi", "1S", "Harga Salah", "", 1, "abc", 0]]);
    const r = await post(buf);
    expect(r.status).toBe(200);
    expect(r.body.dry_run).toBe(true);
    expect(r.body.report.error_count).toBe(4);
    expect(r.body.report.valid_rows).toBe(1);
    expect(r.body.report.errors.some(e => /duplikat/.test(e.message))).toBe(true);
    expect(db.prepare("SELECT COUNT(*) c FROM master_products WHERE paket='HSI Impor'").get().c).toBe(0);
  });

  test("commit dengan error -> 422 dan tidak ada yang tertulis (atomik)", async () => {
    const buf = await xlsx([HEADER, ["hsi", "1S", "HSI Impor", "Bisnis", 40, 111000, 0], ["zzz", "A", "B", "", 1, 1, 0]]);
    const r = await post(buf, "?dry_run=0");
    expect(r.status).toBe(422);
    expect(db.prepare("SELECT COUNT(*) c FROM master_products WHERE paket='HSI Impor'").get().c).toBe(0);
  });

  test("commit: produk baru + pembaruan harga membuat versi, harga format Rupiah terbaca", async () => {
    const existing = db.prepare("SELECT * FROM master_products WHERE sheet='hsi' AND layanan='1S' LIMIT 1").get();
    const wifi = db.prepare("SELECT * FROM master_products WHERE sheet='wifi' AND layanan='WMS Lite' LIMIT 1").get();
    const buf = await xlsx([HEADER,
      ["hsi", "1S", "HSI Impor", "Bisnis", 40, "Rp 1.234.000", 0],
      ["hsi", existing.layanan, existing.paket, existing.lokasi, existing.mbps, existing.harga + 5000, existing.psb],
      ["wifi", wifi.layanan, wifi.paket, "", wifi.mbps, wifi.harga, wifi.psb]]); // tanpa perubahan
    const r = await post(buf, "?dry_run=0");
    expect(r.status).toBe(200);
    expect(r.body.report).toMatchObject({ committed: true, to_create: 1, price_changes: 1, unchanged: 1 });
    expect(db.prepare("SELECT harga FROM master_products WHERE paket='HSI Impor'").get().harga).toBe(1234000);
    expect(db.prepare("SELECT MAX(version) v FROM product_price_versions WHERE product_id=?").get(existing.id).v).toBe(2);
    expect(db.prepare("SELECT COUNT(*) c FROM audit_logs WHERE action='product.import'").get().c).toBe(1);
  });

  test("berkas rusak / kolom wajib hilang / body kosong", async () => {
    expect((await post(Buffer.from("bukan excel"))).status).toBe(400);
    expect((await post(await xlsx([["sheet", "layanan"], ["hsi", "1S"]]))).status).toBe(400);
    expect((await request(app).post("/api/master-data/import").set(auth(t.admin)).send({})).status).toBe(400);
  });

  test("template impor dapat diunduh", async () => {
    const r = await request(app).get("/api/master-data/import/template.xlsx").set(auth(t.admin)).buffer().parse((res, cb) => { const c = []; res.on("data", d => c.push(d)); res.on("end", () => cb(null, Buffer.concat(c))); });
    expect(r.status).toBe(200);
    expect(r.body.slice(0, 2).toString()).toBe("PK");
  });
});
