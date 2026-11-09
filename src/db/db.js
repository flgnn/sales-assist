const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const { getUsageRecommendation } = require("./masterProductRecommendations");

// DB_PATH dapat di-override lewat environment (dipakai Docker dan pengujian otomatis; ':memory:' untuk Jest).
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "..", "..", "data", "sales_assist.db");
const db = new Database(DB_PATH);
const RAB_OUTPUT_DIR = path.join(__dirname, "..", "..", "data", "rab_output");

// NOTE: intentionally do NOT auto-create `rab_output` to avoid automatic persistence of generated RAB files.
// If you need the folder for manual archival later, create it manually.

if (DB_PATH !== ":memory:") db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,      -- di-hash dengan bcryptjs (lihat src/db/seed.js dan src/routes/auth.js)
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'sales',
  witel TEXT NOT NULL DEFAULT 'Witel Priangan Timur',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);



CREATE TABLE IF NOT EXISTS master_products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sheet TEXT NOT NULL,          -- wifi | hsi | datin | dbt
  layanan TEXT,
  paket TEXT,
  lokasi TEXT,
  mbps REAL,
  harga REAL NOT NULL DEFAULT 0,   -- MRC / harga bulanan (Wifi/HSI/DBT) atau MRC (Datin)
  psb REAL NOT NULL DEFAULT 0,     -- biaya instalasi / one-time
  satuan_hint TEXT,
  rekomendasi_penggunaan TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_master_sheet ON master_products(sheet);
CREATE INDEX IF NOT EXISTS idx_master_layanan ON master_products(layanan);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  nama_pelanggan TEXT NOT NULL,
  industri TEXT,
  cabang TEXT,
  cabang_num INTEGER DEFAULT 1,
  witel TEXT,
  kebutuhan TEXT,
  status TEXT NOT NULL DEFAULT 'draft', -- draft | analyzed | reviewed | approved | completed
  keywords_json TEXT DEFAULT '[]',
  notes_json TEXT DEFAULT '[]',
  rab_nomor TEXT,
  rab_tanggal TEXT,
  rab_archive_path TEXT,
  rab_archive_name TEXT,
  rab_archived_at TEXT,
  is_bookmarked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS session_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  nama TEXT NOT NULL,
  sumber TEXT NOT NULL DEFAULT 'MANUAL', -- REKOMENDASI AI | DIEDIT SALES | MANUAL
  harga REAL NOT NULL DEFAULT 0,
  psb REAL NOT NULL DEFAULT 0,
  satuan TEXT DEFAULT 'unit',
  qty INTEGER NOT NULL DEFAULT 1,
  periode TEXT NOT NULL DEFAULT 'Bulanan', -- Bulanan | Sekali bayar
  lokasi TEXT DEFAULT '',
  ref TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_items_session ON session_items(session_id);
`);

function ensureColumn(tableName, columnName, definition) {
  try {
    db.prepare(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`).run();
  } catch (err) {
    if (!/duplicate column name/i.test(err.message)) {
      throw err;
    }
  }
}

ensureColumn("users", "email", "TEXT");
ensureColumn("users", "google_id", "TEXT");
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email IS NOT NULL;`);
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id) WHERE google_id IS NOT NULL;`);

ensureColumn("sessions", "rab_archive_path", "TEXT");
ensureColumn("sessions", "rab_archive_name", "TEXT");
ensureColumn("sessions", "rab_archived_at", "TEXT");
ensureColumn("sessions", "is_bookmarked", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("sessions", "budget", "REAL DEFAULT NULL");
ensureColumn("session_items", "psb", "REAL NOT NULL DEFAULT 0");
ensureColumn("session_items", "lokasi", "TEXT DEFAULT ''");
ensureColumn("session_items", "kecocokan", "REAL DEFAULT NULL");
ensureColumn("session_items", "diskon_psb", "REAL NOT NULL DEFAULT 0");
ensureColumn("session_items", "diskon_satuan", "REAL NOT NULL DEFAULT 0");
ensureColumn("session_items", "periode_bulan", "INTEGER NOT NULL DEFAULT 12");
ensureColumn("session_items", "kategori", "TEXT DEFAULT 'HSI'");
ensureColumn("session_items", "jenis_layanan", "TEXT DEFAULT ''");
ensureColumn("session_items", "reasoning", "TEXT DEFAULT ''");
ensureColumn("master_products", "rekomendasi_penggunaan", "TEXT NOT NULL DEFAULT ''");

// ---------------------------------------------------------------------
// Sales Assist 2.0 — skema baru (peran, persetujuan, audit, versi harga,
// pengiriman penawaran, pipeline penjualan)
// ---------------------------------------------------------------------
ensureColumn("master_products", "is_active", "INTEGER NOT NULL DEFAULT 1");
ensureColumn("master_products", "updated_at", "TEXT");

// Persetujuan berjenjang: draft -> diajukan -> disetujui | ditolak
ensureColumn("sessions", "approval_status", "TEXT NOT NULL DEFAULT 'draft'");
ensureColumn("sessions", "submitted_at", "TEXT");
ensureColumn("sessions", "decided_by", "INTEGER");
ensureColumn("sessions", "decided_at", "TEXT");
ensureColumn("sessions", "decision_note", "TEXT");
ensureColumn("sessions", "recommender_engine", "TEXT");

// Keterlacakan harga: setiap item RAB menunjuk produk + versi harga acuannya
ensureColumn("session_items", "product_id", "INTEGER");
ensureColumn("session_items", "price_version_id", "INTEGER");

db.exec(`
CREATE TABLE IF NOT EXISTS app_meta (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id INTEGER,
  actor_name TEXT,
  actor_role TEXT,
  action TEXT NOT NULL,            -- mis. session.submit, session.approve, product.price_change
  entity_type TEXT NOT NULL,       -- session | product | opportunity | user | quotation
  entity_id INTEGER,
  from_value TEXT,
  to_value TEXT,
  note TEXT,
  ip TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);

CREATE TABLE IF NOT EXISTS product_price_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES master_products(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  harga REAL NOT NULL DEFAULT 0,
  psb REAL NOT NULL DEFAULT 0,
  reason TEXT,
  changed_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(product_id, version)
);
CREATE INDEX IF NOT EXISTS idx_ppv_product ON product_price_versions(product_id);

CREATE TABLE IF NOT EXISTS quotation_deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  to_email TEXT NOT NULL,
  subject TEXT,
  status TEXT NOT NULL,            -- sent | simulated | failed
  error TEXT,
  message_id TEXT,
  sent_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_qd_session ON quotation_deliveries(session_id);

CREATE TABLE IF NOT EXISTS opportunities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER NOT NULL REFERENCES users(id),
  session_id INTEGER REFERENCES sessions(id) ON DELETE SET NULL,
  nama_pelanggan TEXT NOT NULL,
  judul TEXT,
  nilai REAL NOT NULL DEFAULT 0,
  stage TEXT NOT NULL DEFAULT 'prospek',   -- prospek | penawaran | negosiasi | menang | kalah
  lost_reason TEXT,
  next_followup_at TEXT,                    -- YYYY-MM-DD
  followup_note TEXT,
  notes TEXT,
  closed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_opp_owner ON opportunities(owner_id);
CREATE INDEX IF NOT EXISTS idx_opp_stage ON opportunities(stage);

CREATE TABLE IF NOT EXISTS opportunity_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  opportunity_id INTEGER NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  from_stage TEXT,
  to_stage TEXT NOT NULL,
  note TEXT,
  actor_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

ensureColumn("opportunities", "reminder_sent_on", "TEXT");

const updateRecommendations = db.prepare(`
  UPDATE master_products SET rekomendasi_penggunaan = ? WHERE id = ?
`);
db.prepare("SELECT id, sheet, layanan FROM master_products").all().forEach(product => {
  updateRecommendations.run(getUsageRecommendation(product.sheet, product.layanan), product.id);
});

function parsePrice(value) {
  if (value == null) return 0;
  if (typeof value === "number") return value;
  const text = String(value);
  const match = text.match(/[0-9]+(?:[.,][0-9]{1,3})*/);
  if (!match) return 0;
  const num = match[0].replace(/\./g, "").replace(/,/g, ".");
  return parseFloat(num) || 0;
}

function inferPsbFallback(sheet, layanan) {
  if (sheet !== "datin" || !layanan) return 0;
  if (/Metro-E/i.test(layanan)) return 150000;
  if (/IP Transit/i.test(layanan)) return 150000;
  return 0;
}

function normalizeMasterProductPsbs() {
  const seedPath = path.join(__dirname, "..", "..", "data", "master_data_seed.json");
  if (!fs.existsSync(seedPath)) return;
  const raw = JSON.parse(fs.readFileSync(seedPath, "utf8"));
  const update = db.prepare(`
    UPDATE master_products
    SET psb = ?
    WHERE sheet = ? AND layanan = ? AND paket = ? AND COALESCE(lokasi, '') = ? AND mbps = ? AND psb = 0
  `);

  const sources = [
    { sheet: "wifi", rows: raw.wifi || [], lokasi: null },
    { sheet: "hsi", rows: raw.hsi || [], lokasi: (r) => r.jenis || null },
    { sheet: "datin", rows: raw.datin || [], lokasi: (r) => r.lokasi || null },
    { sheet: "dbt", rows: raw.dbt || [], lokasi: null }
  ];

  sources.forEach(source => {
    source.rows.forEach(r => {
      const sourcePsb = parsePrice(r.psb);
      const fallbackPsb = inferPsbFallback(source.sheet, r.layanan);
      const psb = sourcePsb || fallbackPsb;
      if (!psb) return;
      const lokasi = typeof source.lokasi === "function" ? source.lokasi(r) : source.lokasi;
      const mbps = r.mbps || 0;
      update.run(psb, source.sheet, r.layanan || "", r.paket || "", lokasi || "", mbps);
    });
  });
}

function getMeta(key) {
  const row = db.prepare("SELECT value FROM app_meta WHERE key = ?").get(key);
  return row ? row.value : null;
}
function setMeta(key, value) {
  db.prepare("INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, String(value));
}

// Normalisasi PSB dari berkas seed hanya dijalankan sekali. Sebelumnya dijalankan setiap start,
// sehingga PSB yang sengaja diubah Admin menjadi 0 akan kembali ke nilai seed.
if (!getMeta("psb_normalized")) {
  normalizeMasterProductPsbs();
  setMeta("psb_normalized", "1");
}

/**
 * Pastikan setiap produk memiliki minimal satu versi harga (v1).
 * Dipanggil saat start dan setelah seeding / impor.
 */
function ensurePriceVersions() {
  return db.prepare(`
    INSERT INTO product_price_versions (product_id, version, harga, psb, reason, changed_by)
    SELECT id, 1, harga, psb, 'Versi awal (seed / migrasi)', NULL
    FROM master_products
    WHERE id NOT IN (SELECT product_id FROM product_price_versions)
  `).run().changes;
}
ensurePriceVersions();

// Migrasi satu kali: RAB lama yang sudah berstatus completed dianggap telah disetujui (approve satu pihak versi KP).
if (!getMeta("legacy_approval_backfill")) {
  db.prepare("UPDATE sessions SET approval_status = 'disetujui' WHERE status = 'completed' AND approval_status = 'draft'").run();
  setMeta("legacy_approval_backfill", "1");
}

db.getMeta = getMeta;
db.setMeta = setMeta;
db.ensurePriceVersions = ensurePriceVersions;
module.exports = db;
