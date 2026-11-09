const express = require("express");
const db = require("../db/db");
const { requireAuth } = require("../middleware/auth");
const { requirePermission, can } = require("../middleware/rbac");
const { validate } = require("../middleware/validate");
const svc = require("../services/masterDataService");

const router = express.Router();
const READ = requirePermission("master:read");
const WRITE = requirePermission("master:write");

function handle(res, fn) {
  return Promise.resolve().then(fn).catch(err => {
    if (err instanceof svc.MasterDataError) return res.status(err.httpStatus).json({ error: err.message, ...(err.details ? { report: err.details } : {}) });
    throw err;
  });
}

const productSchema = {
  sheet: { type: "string", enum: svc.SHEETS },
  layanan: { type: "string", maxLength: 100 },
  paket: { type: "string", maxLength: 150 },
  lokasi: { type: "string", maxLength: 150 },
  mbps: { type: "number", min: 0, max: 1e6 },
  harga: { type: "number", min: 0, max: 1e12 },
  psb: { type: "number", min: 0, max: 1e12 },
  satuan_hint: { type: "string", maxLength: 20 },
  reason: { type: "string", maxLength: 200 }
};
const withRequired = (...names) => Object.fromEntries(Object.entries(productSchema).map(([k, v]) => [k, names.includes(k) ? { ...v, required: true } : v]));

// GET /api/master-data/sheets — ringkasan kategori & jumlah baris
router.get("/sheets", requireAuth, READ, (req, res) => {
  const rows = db.prepare("SELECT sheet, COUNT(*) as total FROM master_products WHERE is_active = 1 GROUP BY sheet ORDER BY sheet").all();
  res.json({ sheets: rows });
});

// GET /api/master-data/lookup?nama=astinet — cari 1 produk paling cocok (auto-isi harga saat input manual)
router.get("/lookup", requireAuth, READ, (req, res) => {
  const nama = (req.query.nama || "").trim();
  if (!nama) return res.json({ found: false });
  const cols = "id, sheet, layanan, paket, lokasi, mbps, harga, psb, satuan_hint, rekomendasi_penggunaan";
  const exact = db.prepare(`
    SELECT ${cols} FROM master_products WHERE is_active = 1 AND (LOWER(layanan) = LOWER(?) OR LOWER(paket) = LOWER(?))
    ORDER BY harga ASC LIMIT 1
  `).get(nama, nama);
  if (exact) return res.json({ found: true, matchType: "exact", product: exact });
  const partial = db.prepare(`
    SELECT ${cols} FROM master_products
    WHERE is_active = 1 AND (LOWER(layanan) LIKE LOWER(?) OR LOWER(paket) LIKE LOWER(?) OR LOWER(lokasi) LIKE LOWER(?))
    ORDER BY LENGTH(layanan) ASC LIMIT 1
  `).get(`%${nama}%`, `%${nama}%`, `%${nama}%`);
  if (partial) return res.json({ found: true, matchType: "partial", product: partial });
  res.json({ found: false });
});

// GET /api/master-data/import/template.xlsx — template impor (Admin)
router.get("/import/template.xlsx", requireAuth, WRITE, async (req, res) => {
  const wb = await svc.buildImportTemplate();
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", 'attachment; filename="template_impor_produk.xlsx"');
  await wb.xlsx.write(res);
  res.end();
});

// POST /api/master-data/import?dry_run=1 — body: berkas .xlsx mentah (application/octet-stream)
router.post("/import", requireAuth, WRITE,
  express.raw({ type: () => true, limit: "10mb" }),
  (req, res) => {
    if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: "Berkas Excel (.xlsx) wajib dikirim sebagai body." });
    const dryRun = req.query.dry_run !== "0" && req.query.dry_run !== "false";
    return handle(res, async () => {
      const report = await svc.importProducts(req.body, { dryRun, actor: req.user, ip: req.ip });
      res.json({ dry_run: dryRun, report });
    });
  });

// GET /api/master-data?sheet=wifi&q=titanium&limit=50&offset=0[&include_inactive=1 (Admin)]
router.get("/", requireAuth, READ, (req, res) => {
  const sheet = req.query.sheet || null;
  const q = (req.query.q || "").trim();
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 300);
  const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
  const includeInactive = req.query.include_inactive === "1" && can(req.user.role, "master:write");

  let where = includeInactive ? "WHERE 1=1" : "WHERE m.is_active = 1";
  const params = [];
  if (sheet) { where += " AND m.sheet = ?"; params.push(sheet); }
  if (q) {
    where += " AND (m.layanan LIKE ? OR m.paket LIKE ? OR m.lokasi LIKE ?)";
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  const total = db.prepare(`SELECT COUNT(*) c FROM master_products m ${where}`).get(...params).c;

  // Saat ada pencarian, utamakan hasil yang namanya DIAWALI kata kunci.
  const orderClause = q
    ? `ORDER BY CASE WHEN LOWER(m.layanan) LIKE LOWER(?) THEN 0 WHEN LOWER(m.paket) LIKE LOWER(?) THEN 1 ELSE 2 END, m.layanan, m.mbps`
    : "ORDER BY m.layanan, m.mbps";
  const orderParams = q ? [`${q}%`, `${q}%`] : [];

  const rows = db.prepare(`
    SELECT m.id, m.sheet, m.layanan, m.paket, m.lokasi, m.mbps, m.harga, m.psb, m.satuan_hint, m.rekomendasi_penggunaan, m.is_active,
      (SELECT MAX(version) FROM product_price_versions v WHERE v.product_id = m.id) AS price_version
    FROM master_products m ${where} ${orderClause} LIMIT ? OFFSET ?
  `).all(...params, ...orderParams, limit, offset);

  res.json({ total, limit, offset, rows });
});

router.post("/", requireAuth, WRITE, validate(withRequired("sheet", "layanan", "paket", "harga")), (req, res) =>
  handle(res, () => res.status(201).json({ product: svc.createProduct(req.user, req.body, req.ip) })));

router.get("/:id", requireAuth, READ, (req, res) => {
  const p = svc.getProduct(req.params.id);
  if (!p || (!p.is_active && !can(req.user.role, "master:write"))) return res.status(404).json({ error: "Produk tidak ditemukan." });
  res.json({ product: p });
});

router.get("/:id/versions", requireAuth, READ, (req, res) => {
  const p = svc.getProduct(req.params.id);
  if (!p) return res.status(404).json({ error: "Produk tidak ditemukan." });
  res.json({ product: p, versions: svc.listVersions(p.id) });
});

router.put("/:id", requireAuth, WRITE, validate(productSchema), (req, res) => {
  const { sheet, ...data } = req.body; // kategori (sheet) produk tidak dapat dipindah
  return handle(res, () => res.json({ product: svc.updateProduct(req.user, Number(req.params.id), data, req.ip) }));
});

router.post("/:id/reactivate", requireAuth, WRITE, (req, res) =>
  handle(res, () => res.json({ product: svc.reactivateProduct(req.user, Number(req.params.id), req.ip) })));

// DELETE /api/master-data/:id[?hard=1] — nonaktifkan; hard hanya bila belum dipakai RAB
router.delete("/:id", requireAuth, WRITE, (req, res) =>
  handle(res, () => res.json(svc.removeProduct(req.user, Number(req.params.id), { hard: req.query.hard === "1" }, req.ip))));

module.exports = router;
