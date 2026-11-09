/**
 * Deteksi kuantitas, bandwidth, dan periode dari teks kebutuhan bebas.
 * Diperbaiki dari versi KP: angka yang diikuti satuan non-kuantitas (Mbps, hari, kamar, orang, ...)
 * tidak lagi dianggap qty (mis. "Astinet 20 Mbps" tidak menjadi qty 20).
 */
const UNIT_WORDS = ["buah", "unit", "pcs", "pc", "item", "titik", "lokasi", "site"];
const NON_QTY_FOLLOW = "(?!\\s*(?:mbps|mb|gbps|gb|hari|kamar|orang|user|pengguna|karyawan|siswa|pc|komputer|extension|ekstensi|cabang|kantor|lantai|gedung|sekolah|toko|voucher|%))";

const UNITS = { nol: 0, satu: 1, se: 1, dua: 2, tiga: 3, empat: 4, lima: 5, enam: 6, tujuh: 7, delapan: 8, sembilan: 9 };
const SPECIALS = { sepuluh: 10, sebelas: 11, seratus: 100, seribu: 1000 };

function wordsToNumber(str) {
  if (!str) return NaN;
  const parts = String(str).toLowerCase().replace(/-/g, " ").trim().split(/\s+/);
  let total = 0, current = 0, lastUnit = 0;
  for (const w of parts) {
    if (SPECIALS[w] != null) { current += SPECIALS[w]; lastUnit = 0; continue; }
    if (w === "belas") { current += 10; lastUnit = 0; continue; }
    if (w === "puluh") { current += lastUnit ? lastUnit * 9 : 10; lastUnit = 0; continue; }          // "dua puluh": 2 -> 20
    if (w === "ratus") { current += lastUnit ? lastUnit * 99 : 100; lastUnit = 0; continue; }        // "dua ratus": 2 -> 200
    if (w === "ribu") { current = (current || 1) * 1000; total += current; current = 0; lastUnit = 0; continue; }
    if (UNITS[w] != null) { current += UNITS[w]; lastUnit = UNITS[w]; }
  }
  total += current;
  return total || NaN;
}

function esc(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

/** Cari kuantitas eksplisit di dekat salah satu term. Mengembalikan { qty, unit } atau null. */
function findQuantity(text, terms) {
  if (!terms || !terms.length) return null;
  const t = String(text || "").toLowerCase();
  const alt = terms.map(x => esc(x).replace(/ /g, "\\s+")).join("|");
  const unitAlt = UNIT_WORDS.join("|");

  // 1) "20 buah cctv", "20 x cctv", "20 cctv"
  let m = t.match(new RegExp(`(\\d+)\\s*(${unitAlt}|x|×)?\\s*(?:${alt})`, "i"));
  if (m) {
    const n = parseInt(m[1], 10);
    if (n > 0) return { qty: n, unit: m[2] && /^[a-z]+$/.test(m[2]) ? m[2] : null };
  }
  // 2) "cctv 20", "cctv sebanyak 20", "cctv: 20" — tapi bukan "astinet 20 mbps"
  m = t.match(new RegExp(`(?:${alt})\\s*(?:sejumlah|sebanyak|:|-)\\s*(\\d+)${NON_QTY_FOLLOW}`, "i"));
  if (m) {
    const n = parseInt(m[1], 10);
    if (n > 0) return { qty: n, unit: null };
  }
  // 3) angka dalam kata: "dua puluh cctv"
  const words = Object.keys(UNITS).concat(Object.keys(SPECIALS), ["belas", "puluh", "ratus", "ribu"]).join("|");
  m = t.match(new RegExp(`((?:${words})(?:\\s+(?:${words}))*)\\s*(?:${unitAlt})?\\s*(?:${alt})`, "i"));
  if (m) {
    const n = wordsToNumber(m[1]);
    if (n > 0) return { qty: n, unit: null };
  }
  return null;
}

/** Bandwidth yang disebut eksplisit, dalam Mbps ("100 Mbps", "1 Gbps", "500mb"). */
function findBandwidthMbps(text) {
  const t = String(text || "").toLowerCase();
  const g = t.match(/(\d+(?:[.,]\d+)?)\s*(?:gbps|giga|gb\b)/);
  if (g) return Math.round(parseFloat(g[1].replace(",", ".")) * 1000);
  const m = t.match(/(\d+(?:[.,]\d+)?)\s*(?:mbps|mb\b|mega)/);
  if (m) return Math.round(parseFloat(m[1].replace(",", ".")));
  return null;
}

function detectPeriode(text) {
  const t = String(text || "").toLowerCase();
  return /(sekali bayar|\botc\b|one[- ]time|beli putus|non-sewa)/.test(t) ? "Sekali bayar" : "Bulanan";
}

module.exports = { findQuantity, findBandwidthMbps, detectPeriode, wordsToNumber };
