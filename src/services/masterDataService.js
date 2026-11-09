/**
 * Pengelolaan master data produk: CRUD, versi harga, dan impor Excel dengan validasi.
 * Semua perubahan harga membuat baris baru di product_price_versions dan audit log (NF-07 / F-11),
 * dalam satu transaksi dengan perubahan datanya.
 */
const ExcelJS = require("exceljs");
const db = require("../db/db");
const { logAudit } = require("./audit");
const recommender = require("./recommender");
const { getUsageRecommendation } = require("../db/masterProductRecommendations");

const SHEETS = ["wifi", "hsi", "datin", "dbt"];
const IMPORT_COLUMNS = ["sheet", "layanan", "paket", "lokasi", "mbps", "harga", "psb"];

class MasterDataError extends Error {
  constructor(message, httpStatus = 400, details = null) { super(message); this.httpStatus = httpStatus; this.details = details; }
}

function naturalKey(p) {
  return [p.sheet, String(p.layanan || "").trim().toLowerCase(), String(p.paket || "").trim().toLowerCase(),
    String(p.lokasi || "").trim().toLowerCase(), Number(p.mbps || 0)].join("|");
}

function latestVersion(productId) {
  return db.prepare("SELECT * FROM product_price_versions WHERE product_id = ? ORDER BY version DESC LIMIT 1").get(productId);
}

function addVersion(productId, harga, psb, actor, reason) {
  const last = latestVersion(productId);
  const version = last ? last.version + 1 : 1;
  const info = db.prepare(`
    INSERT INTO product_price_versions (product_id, version, harga, psb, reason, changed_by) VALUES (?, ?, ?, ?, ?, ?)
  `).run(productId, version, harga, psb, reason || null, actor ? actor.id : null);
  return { id: info.lastInsertRowid, version };
}

function describe(p) { return `${p.sheet}/${p.layanan}/${p.paket}${p.lokasi ? "/" + p.lokasi : ""}/${p.mbps}Mbps`; }

function createProduct(actor, data, ip) {
  const exists = db.prepare(`
    SELECT id FROM master_products WHERE sheet = ? AND LOWER(layanan) = LOWER(?) AND LOWER(paket) = LOWER(?)
      AND LOWER(COALESCE(lokasi,'')) = LOWER(?) AND mbps = ?
  `).get(data.sheet, data.layanan, data.paket, data.lokasi || "", data.mbps || 0);
  if (exists) throw new MasterDataError("Produk dengan kombinasi layanan, paket, lokasi, dan bandwidth yang sama sudah ada.", 409);
  const tx = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO master_products (sheet, layanan, paket, lokasi, mbps, harga, psb, satuan_hint, rekomendasi_penggunaan, is_active, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, datetime('now'))
    `).run(data.sheet, data.layanan, data.paket, data.lokasi || null, data.mbps || 0, data.harga, data.psb || 0,
      data.satuan_hint || (data.sheet === "datin" ? "lokasi" : "unit"), getUsageRecommendation(data.sheet, data.layanan));
    addVersion(info.lastInsertRowid, data.harga, data.psb || 0, actor, "Produk baru");
    logAudit({ actor, action: "product.create", entityType: "product", entityId: info.lastInsertRowid, to: `${data.harga}/${data.psb || 0}`, note: describe(data), ip });
    return info.lastInsertRowid;
  });
  const id = tx();
  recommender.invalidate();
  return getProduct(id);
}

function getProduct(id) {
  const p = db.prepare("SELECT * FROM master_products WHERE id = ?").get(id);
  if (!p) return null;
  const v = latestVersion(id);
  return { ...p, price_version: v ? v.version : null, price_version_id: v ? v.id : null };
}

function updateProduct(actor, id, data, ip) {
  const cur = db.prepare("SELECT * FROM master_products WHERE id = ?").get(id);
  if (!cur) throw new MasterDataError("Produk tidak ditemukan.", 404);
  const next = {
    layanan: data.layanan ?? cur.layanan, paket: data.paket ?? cur.paket, lokasi: data.lokasi ?? cur.lokasi,
    mbps: data.mbps ?? cur.mbps, harga: data.harga ?? cur.harga, psb: data.psb ?? cur.psb,
    satuan_hint: data.satuan_hint ?? cur.satuan_hint
  };
  const priceChanged = next.harga !== cur.harga || next.psb !== cur.psb;
  const attrChanged = ["layanan", "paket", "lokasi", "mbps", "satuan_hint"].some(k => String(next[k] ?? "") !== String(cur[k] ?? ""));
  if (!priceChanged && !attrChanged) return getProduct(id);
  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE master_products SET layanan = ?, paket = ?, lokasi = ?, mbps = ?, harga = ?, psb = ?, satuan_hint = ?,
        rekomendasi_penggunaan = ?, updated_at = datetime('now') WHERE id = ?
    `).run(next.layanan, next.paket, next.lokasi, next.mbps, next.harga, next.psb, next.satuan_hint,
      getUsageRecommendation(cur.sheet, next.layanan), id);
    if (priceChanged) {
      addVersion(id, next.harga, next.psb, actor, data.reason || "Perubahan harga");
      logAudit({ actor, action: "product.price_change", entityType: "product", entityId: id,
        from: `${cur.harga}/${cur.psb}`, to: `${next.harga}/${next.psb}`, note: data.reason || describe(cur), ip });
    }
    if (attrChanged) {
      logAudit({ actor, action: "product.update", entityType: "product", entityId: id, note: describe(cur), ip });
    }
  });
  tx();
  recommender.invalidate();
  return getProduct(id);
}

/** Nonaktifkan (default) atau hapus permanen bila belum pernah dipakai RAB manapun. */
function removeProduct(actor, id, { hard = false } = {}, ip) {
  const cur = db.prepare("SELECT * FROM master_products WHERE id = ?").get(id);
  if (!cur) throw new MasterDataError("Produk tidak ditemukan.", 404);
  const used = db.prepare("SELECT COUNT(*) c FROM session_items WHERE product_id = ?").get(id).c;
  const tx = db.transaction(() => {
    if (hard) {
      if (used > 0) throw new MasterDataError(`Produk dipakai pada ${used} item RAB; hanya dapat dinonaktifkan agar RAB lama tetap dapat ditelusuri.`, 409);
      db.prepare("DELETE FROM master_products WHERE id = ?").run(id);
      logAudit({ actor, action: "product.delete", entityType: "product", entityId: id, note: describe(cur), ip });
    } else {
      db.prepare("UPDATE master_products SET is_active = 0, updated_at = datetime('now') WHERE id = ?").run(id);
      logAudit({ actor, action: "product.deactivate", entityType: "product", entityId: id, from: "aktif", to: "nonaktif", note: describe(cur), ip });
    }
  });
  tx();
  recommender.invalidate();
  return { deleted: !!hard, deactivated: !hard, used_in_items: used };
}

function reactivateProduct(actor, id, ip) {
  const cur = db.prepare("SELECT * FROM master_products WHERE id = ?").get(id);
  if (!cur) throw new MasterDataError("Produk tidak ditemukan.", 404);
  db.transaction(() => {
    db.prepare("UPDATE master_products SET is_active = 1, updated_at = datetime('now') WHERE id = ?").run(id);
    logAudit({ actor, action: "product.reactivate", entityType: "product", entityId: id, from: "nonaktif", to: "aktif", note: describe(cur), ip });
  })();
  recommender.invalidate();
  return getProduct(id);
}

function listVersions(productId) {
  return db.prepare(`
    SELECT v.*, u.name AS changed_by_name,
      (SELECT COUNT(*) FROM session_items i WHERE i.price_version_id = v.id) AS used_in_items
    FROM product_price_versions v LEFT JOIN users u ON u.id = v.changed_by
    WHERE v.product_id = ? ORDER BY v.version DESC
  `).all(productId);
}

// ---------------------------------------------------------------------
// Impor Excel
// ---------------------------------------------------------------------
function cellText(cell) {
  const v = cell && cell.value;
  if (v == null) return "";
  if (typeof v === "object") {
    if (v.richText) return v.richText.map(r => r.text).join("");
    if (v.result !== undefined) return String(v.result);
    if (v.text !== undefined) return String(v.text);
    return "";
  }
  return String(v);
}

function parseNumber(raw) {
  if (raw === "" || raw == null) return null;
  if (typeof raw === "number") return raw;
  let s = String(raw).replace(/rp\.?/gi, "").replace(/\s/g, "");
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(/,/g, ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

async function parseImport(buffer) {
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(buffer); } catch (e) { throw new MasterDataError("Berkas bukan file Excel (.xlsx) yang valid.", 400); }
  const ws = wb.worksheets[0];
  if (!ws) throw new MasterDataError("Berkas Excel tidak memiliki lembar kerja.", 400);
  const header = {};
  ws.getRow(1).eachCell((cell, col) => { header[cellText(cell).trim().toLowerCase()] = col; });
  const missing = ["sheet", "layanan", "paket", "harga"].filter(c => !header[c]);
  if (missing.length) throw new MasterDataError(`Kolom wajib tidak ditemukan pada baris 1: ${missing.join(", ")}. Gunakan template impor.`, 400);

  const rows = [], errors = [], seen = new Map();
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const get = (c) => (header[c] ? cellText(row.getCell(header[c])).trim() : "");
    if (IMPORT_COLUMNS.every(c => get(c) === "")) continue;
    const rec = { row: r, sheet: get("sheet").toLowerCase(), layanan: get("layanan"), paket: get("paket"), lokasi: get("lokasi") || null,
      mbps: parseNumber(get("mbps")) ?? 0, harga: parseNumber(get("harga")), psb: parseNumber(get("psb")) ?? 0 };
    const problems = [];
    if (!SHEETS.includes(rec.sheet)) problems.push(`sheet harus salah satu dari ${SHEETS.join("/")}`);
    if (!rec.layanan) problems.push("layanan kosong");
    if (!rec.paket) problems.push("paket kosong");
    if (rec.harga == null || rec.harga < 0) problems.push("harga harus angka >= 0");
    if (rec.mbps < 0) problems.push("mbps tidak boleh negatif");
    if (rec.psb < 0) problems.push("psb tidak boleh negatif");
    if (rec.layanan.length > 100 || rec.paket.length > 150) problems.push("layanan/paket terlalu panjang");
    const key = naturalKey(rec);
    if (!problems.length) {
      if (seen.has(key)) problems.push(`duplikat dengan baris ${seen.get(key)}`);
      else seen.set(key, r);
    }
    if (problems.length) errors.push({ row: r, message: problems.join("; ") });
    else rows.push(rec);
  }
  return { rows, errors };
}

/**
 * @param {Buffer} buffer
 * @param {{dryRun:boolean, actor:object, ip:string}} opts
 */
async function importProducts(buffer, { dryRun = true, actor, ip } = {}) {
  const { rows, errors } = await parseImport(buffer);
  const existing = new Map(db.prepare("SELECT * FROM master_products").all().map(p => [naturalKey(p), p]));
  const plan = { create: [], update: [], unchanged: 0 };
  rows.forEach(rec => {
    const cur = existing.get(naturalKey(rec));
    if (!cur) plan.create.push(rec);
    else if (cur.harga !== rec.harga || cur.psb !== rec.psb || !cur.is_active) plan.update.push({ rec, cur });
    else plan.unchanged += 1;
  });
  const report = {
    total_rows: rows.length + errors.length, valid_rows: rows.length, error_count: errors.length, errors: errors.slice(0, 100),
    to_create: plan.create.length, to_update: plan.update.length, unchanged: plan.unchanged,
    price_changes: plan.update.filter(u => u.cur.harga !== u.rec.harga || u.cur.psb !== u.rec.psb).length,
    committed: false
  };
  if (dryRun) return report;
  if (errors.length) throw new MasterDataError("Impor dibatalkan: masih ada baris tidak valid. Perbaiki lalu unggah ulang.", 422, report);

  db.transaction(() => {
    plan.create.forEach(rec => {
      const info = db.prepare(`
        INSERT INTO master_products (sheet, layanan, paket, lokasi, mbps, harga, psb, satuan_hint, rekomendasi_penggunaan, is_active, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, datetime('now'))
      `).run(rec.sheet, rec.layanan, rec.paket, rec.lokasi, rec.mbps, rec.harga, rec.psb,
        rec.sheet === "datin" ? "lokasi" : "unit", getUsageRecommendation(rec.sheet, rec.layanan));
      addVersion(info.lastInsertRowid, rec.harga, rec.psb, actor, "Impor Excel (produk baru)");
      logAudit({ actor, action: "product.create", entityType: "product", entityId: info.lastInsertRowid, to: `${rec.harga}/${rec.psb}`, note: "impor: " + describe(rec), ip });
    });
    plan.update.forEach(({ rec, cur }) => {
      const priceChanged = cur.harga !== rec.harga || cur.psb !== rec.psb;
      db.prepare("UPDATE master_products SET harga = ?, psb = ?, is_active = 1, updated_at = datetime('now') WHERE id = ?").run(rec.harga, rec.psb, cur.id);
      if (priceChanged) {
        addVersion(cur.id, rec.harga, rec.psb, actor, "Impor Excel");
        logAudit({ actor, action: "product.price_change", entityType: "product", entityId: cur.id,
          from: `${cur.harga}/${cur.psb}`, to: `${rec.harga}/${rec.psb}`, note: "impor: " + describe(cur), ip });
      }
      if (!cur.is_active) logAudit({ actor, action: "product.reactivate", entityType: "product", entityId: cur.id, from: "nonaktif", to: "aktif", note: "impor", ip });
    });
    logAudit({ actor, action: "product.import", entityType: "product", note: `dibuat ${plan.create.length}, diperbarui ${plan.update.length}, tanpa perubahan ${plan.unchanged}`, ip });
  })();
  recommender.invalidate();
  report.committed = true;
  return report;
}

async function buildImportTemplate() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Produk");
  ws.addRow(IMPORT_COLUMNS);
  ws.addRow(["hsi", "1S", "HSI", "Bisnis", 100, 599000, 0]);
  ws.addRow(["datin", "Astinet", "Reguler", "Jawa", 20, 5000000, 150000]);
  ws.getRow(1).font = { bold: true };
  ws.columns.forEach(c => { c.width = 18; });
  const notes = wb.addWorksheet("Petunjuk");
  [["Kolom wajib: sheet, layanan, paket, harga. Opsional: lokasi, mbps, psb."],
    ["sheet: wifi | hsi | datin | dbt"],
    ["Baris dengan kombinasi sheet+layanan+paket+lokasi+mbps yang sudah ada akan memperbarui harga dan membuat VERSI HARGA baru."],
    ["Gunakan pratinjau (dry run) sebelum menerapkan impor."]].forEach(r => notes.addRow(r));
  return wb;
}

module.exports = {
  MasterDataError, SHEETS, createProduct, updateProduct, removeProduct, reactivateProduct, getProduct,
  listVersions, importProducts, buildImportTemplate, parseImport, naturalKey
};
