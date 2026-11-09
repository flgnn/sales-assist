const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const db = require("./db");
const { getUsageRecommendation } = require("./masterProductRecommendations");
const args = process.argv.slice(2);
const FORCE_SEED = args.includes("--force") || args.includes("-f");

// Akun demo untuk tiga peran Sales Assist 2.0. Idempotent: hanya menambah akun yang belum ada,
// sehingga database KP yang sudah berisi akun lama tetap aman. GANTI password ini sebelum deployment nyata.
const DEMO_USERS = [
  { username: "akbar.trisnamulya", password: "sales123", name: "Akbar Trisnamulya Putra", role: "sales" },
  { username: "sales2", password: "sales123", name: "Sales Demo 2", role: "sales" },
  { username: "manager", password: "manager123", name: "Manajer Witel Priangan Timur", role: "manager" },
  { username: "admin", password: "admin123", name: "Admin Witel Priangan Timur", role: "admin" }
];

function seedUsers() {
  const exists = db.prepare("SELECT id FROM users WHERE username = ?");
  const insert = db.prepare(`
    INSERT INTO users (username, password, name, role, witel)
    VALUES (?, ?, ?, ?, ?)
  `);
  let added = 0;
  DEMO_USERS.forEach(u => {
    if (exists.get(u.username)) return;
    insert.run(u.username, bcrypt.hashSync(u.password, 10), u.name, u.role, "Witel Priangan Timur");
    added += 1;
  });
  console.log(added ? `Seed users OK (${added} akun baru; password demo sudah di-hash).` : "Semua akun demo sudah ada, lewati seeding user.");
}

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

function seedMasterProducts(force = false) {
  const existing = db.prepare("SELECT COUNT(*) c FROM master_products").get();
  if (existing.c > 0 && !force) {
    console.log("master_products sudah ada, lewati seeding (gunakan --force untuk re-seed).");
    return;
  }
  if (existing.c > 0 && force) {
    db.prepare("DELETE FROM product_price_versions").run();
    db.prepare("DELETE FROM master_products").run();
    console.log("master_products lama dihapus karena --force. Memulai reseeding...");
  }
  const seedPath = path.join(__dirname, "..", "..", "data", "master_data_seed.json");
  const raw = JSON.parse(fs.readFileSync(seedPath, "utf8"));

  const insert = db.prepare(`
    INSERT INTO master_products (sheet, layanan, paket, lokasi, mbps, harga, psb, satuan_hint, rekomendasi_penggunaan)
    VALUES (@sheet, @layanan, @paket, @lokasi, @mbps, @harga, @psb, @satuan_hint, @rekomendasi_penggunaan)
  `);

  const insertMany = db.transaction((rows) => {
    for (const r of rows) insert.run(r);
  });

  const rows = [];
  (raw.wifi || []).forEach(r => rows.push({
    sheet: "wifi", layanan: r.layanan || "", paket: r.paket || "", lokasi: null,
    mbps: r.mbps || 0, harga: r.harga || 0, psb: parsePrice(r.psb), satuan_hint: "unit", rekomendasi_penggunaan: getUsageRecommendation("wifi", r.layanan)
  }));
  (raw.hsi || []).forEach(r => rows.push({
    sheet: "hsi", layanan: r.layanan || "", paket: r.paket || "", lokasi: r.jenis || null,
    mbps: r.mbps || 0, harga: r.harga || 0, psb: parsePrice(r.psb), satuan_hint: "unit", rekomendasi_penggunaan: getUsageRecommendation("hsi", r.layanan)
  }));
  (raw.datin || []).forEach(r => {
    const sourcePsb = parsePrice(r.psb);
    rows.push({
      sheet: "datin", layanan: r.layanan || "", paket: r.paket || "", lokasi: r.lokasi || null,
      mbps: r.mbps || 0, harga: r.mrc || 0, psb: sourcePsb || inferPsbFallback("datin", r.layanan), satuan_hint: "lokasi", rekomendasi_penggunaan: getUsageRecommendation("datin", r.layanan)
    });
  });
  (raw.dbt || []).forEach(r => rows.push({
    sheet: "dbt", layanan: r.layanan || "", paket: r.paket || "", lokasi: null,
    mbps: r.mbps || 0, harga: r.harga || 0, psb: parsePrice(r.psb), satuan_hint: "unit", rekomendasi_penggunaan: getUsageRecommendation("dbt", r.layanan)
  }));

  insertMany(rows);
  console.log(`Seed master_products OK (${rows.length} baris dari Rekap Harga Layanan Telkom).`);
}

module.exports = { seedUsers, seedMasterProducts, DEMO_USERS };

if (require.main === module) {
  seedUsers();
  seedMasterProducts(FORCE_SEED);
  db.ensurePriceVersions();
  console.log("Seeding selesai.");
}
