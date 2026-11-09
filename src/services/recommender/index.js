/**
 * Fasad mesin rekomendasi: memuat model dari database (produk aktif + riwayat RAB yang disetujui),
 * meranking layanan, lalu memilih produk konkret + kuantitas untuk dijadikan item RAB.
 *
 * Mesin dipilih lewat env RECOMMENDER_ENGINE = hybrid (default) | baseline (AI Matcher versi KP).
 */
const db = require("../../db/db");
const { buildModel, rank, groupKey } = require("./hybrid");
const { tokenize } = require("./text");
const { LEXICON } = require("./lexicon");
const { findQuantity, findBandwidthMbps, detectPeriode } = require("./quantity");
const baseline = require("../aiMatcher");

const MAX_GROUPS = 3;           // jumlah layanan yang dimasukkan sebagai item
const SECONDARY_MIN_RATIO = 0.7;  // layanan ke-2/3 harus minimal 70% skor layanan teratas
const MIN_TOP_SCORE = 0.12;

let cached = null;
let cacheVersion = 0;
function invalidate() { cacheVersion += 1; cached = null; }

function loadHistory() {
  const rows = db.prepare(`
    SELECT s.id sid, s.kebutuhan, i.kategori, i.jenis_layanan, i.product_id
    FROM sessions s JOIN session_items i ON i.session_id = s.id
    WHERE (s.approval_status = 'disetujui' OR s.status = 'completed')
      AND s.kebutuhan IS NOT NULL AND TRIM(s.kebutuhan) <> ''
  `).all();
  const bySession = new Map();
  const productStmt = db.prepare("SELECT sheet, layanan FROM master_products WHERE id = ?");
  rows.forEach(r => {
    let key = null;
    if (r.product_id) {
      const p = productStmt.get(r.product_id);
      if (p) key = groupKey(p.sheet, p.layanan);
    }
    if (!key && r.kategori && r.jenis_layanan) {
      const sheet = String(r.kategori).toLowerCase() === "wms" ? "wifi" : String(r.kategori).toLowerCase();
      key = groupKey(sheet, r.jenis_layanan);
    }
    if (!key) return;
    if (!bySession.has(r.sid)) bySession.set(r.sid, { kebutuhan: r.kebutuhan, groups: new Set() });
    bySession.get(r.sid).groups.add(key);
  });
  return [...bySession.values()].map(h => ({ kebutuhan: h.kebutuhan, groups: [...h.groups] }));
}

function getModel() {
  if (cached && cached.version === cacheVersion) return cached.model;
  const products = db.prepare("SELECT * FROM master_products WHERE is_active = 1").all();
  const model = buildModel(products, loadHistory());
  cached = { version: cacheVersion, model };
  return model;
}

function displayName(prod) {
  if (prod.sheet === "hsi") return `${prod.paket} (${prod.layanan}) ${prod.mbps ? prod.mbps + " Mbps" : ""}`.trim();
  if (prod.sheet === "wifi") return `${prod.layanan} — ${prod.paket} (${prod.mbps} Mbps)`;
  if (prod.sheet === "datin") return `${prod.layanan} ${prod.mbps ? prod.mbps + " Mbps" : ""} ${prod.paket} (${prod.lokasi || "Jawa"})`.trim();
  return `${prod.paket} (${prod.layanan})`;
}

function reasoning(sheet, layanan) {
  if (sheet === "hsi") return "Internet broadband ekonomis dan cepat untuk operasional bisnis harian.";
  if (sheet === "wifi") return "WiFi terkelola profesional untuk kemudahan akses internet karyawan & tamu/pelanggan.";
  if (sheet === "datin") {
    if (layanan === "Astinet") return "Internet dedicated simetris dengan SLA tinggi untuk kestabilan bisnis & server.";
    if (/Metro-E/.test(layanan)) return "Jaringan data private aman untuk menghubungkan antar kantor cabang.";
    return "Layanan konektivitas data korporasi berkapasitas besar dan handal.";
  }
  if (layanan === "Antares Eazy") return "Kamera pengawas pintar dengan perekaman berbasis cloud untuk keamanan 24 jam.";
  if (layanan === "PIJAR Sekolah") return "Platform pembelajaran digital (LMS) dan manajemen administrasi sekolah.";
  return "Solusi bisnis digital Telkom untuk mendukung efisiensi operasional.";
}

const REGION_PREF = () => new RegExp(process.env.PREFERRED_REGION || "jabar|jawa", "i");

/** Pilih produk konkret dalam satu layanan. */
function selectProducts(group, { text, tokens, bandwidth, budgetPerGroup, cabang, limit }) {
  let rows = db.prepare("SELECT * FROM master_products WHERE sheet = ? AND layanan = ? AND is_active = 1").all(group.sheet, group.layanan);
  if (!rows.length) return { rows: [], note: null };

  // 1) kecocokan nama paket (mis. "gold", "voice", "netmonk") — token generik dibuang
  const GENERIC = new Set(["hsi", "wms", "wifi", "paket", "reguler", "standalone", "add", "on", "mbps"]);
  const tokenSet = new Set(tokens);
  const paketScore = new Map();
  rows.forEach(r => {
    if (paketScore.has(r.paket)) return;
    const pt = tokenize(r.paket).filter(t => !GENERIC.has(t));
    paketScore.set(r.paket, pt.filter(t => tokenSet.has(t)).length);
  });
  const bestPaket = Math.max(...paketScore.values());
  if (bestPaket > 0) rows = rows.filter(r => paketScore.get(r.paket) === bestPaket);

  // 2) preferensi wilayah (Priangan Timur -> Jabar/Jawa) untuk Datin
  if (group.sheet === "datin") {
    const preferred = rows.filter(r => REGION_PREF().test(r.lokasi || ""));
    if (preferred.length) rows = preferred;
    // Best Effort lebih murah dan menjadi default bila tidak disebut "interaktif"
    if (!/interaktif|qos/.test(String(text).toLowerCase())) {
      const be = rows.filter(r => /best effort/i.test(r.lokasi || "") || !/interaktif/i.test(r.lokasi || ""));
      if (be.length) rows = be;
    }
    const p2p = rows.filter(r => /p2p/i.test(r.lokasi || ""));
    if (p2p.length && !/mp2mp|multipoint|banyak titik/i.test(String(text).toLowerCase())) rows = p2p;
  }

  let note = null;
  // 3) bandwidth eksplisit: ambil yang terkecil >= permintaan, jika tidak ada ambil terbesar
  if (bandwidth) {
    const ge = rows.filter(r => r.mbps >= bandwidth);
    const target = ge.length ? Math.min(...ge.map(r => r.mbps)) : Math.max(...rows.map(r => r.mbps));
    const narrowed = rows.filter(r => r.mbps === target);
    if (narrowed.length) rows = narrowed;
  }

  // 4) budget / default termurah
  if (budgetPerGroup && budgetPerGroup > 0) {
    const maxPrice = budgetPerGroup / Math.max(1, cabang);
    const within = rows.filter(r => r.harga <= maxPrice);
    if (within.length) {
      rows = within.sort((a, b) => b.harga - a.harga || b.mbps - a.mbps);
    } else {
      rows = rows.sort((a, b) => a.harga - b.harga);
      note = `Alternatif Terhemat: Produk "${rows[0].paket}" dipilih sebagai alternatif terbaik yang paling mendekati target budget.`;
      rows = rows.slice(0, 1);
    }
  } else {
    rows = rows.sort((a, b) => a.harga - b.harga || a.mbps - b.mbps);
  }

  const seen = new Set();
  const picked = [];
  for (const r of rows) {
    const k = `${r.paket}|${r.mbps}|${r.lokasi}`;
    if (seen.has(k)) continue;
    seen.add(k);
    picked.push(r);
    if (picked.length >= limit) break;
  }
  return { rows: picked, note };
}

function inferPsb(prod) {
  if (prod.psb > 0) return prod.psb;
  if (prod.sheet === "datin" && /Metro-E|IP Transit/i.test(prod.layanan)) return 150000;
  return 0;
}

function currentVersionId(productId) {
  const v = db.prepare("SELECT id FROM product_price_versions WHERE product_id = ? ORDER BY version DESC LIMIT 1").get(productId);
  return v ? v.id : null;
}

// Persentase kecocokan yang ditampilkan: gabungan skor relatif (peringkat) dan kekuatan kecocokan absolut
// (cosine mentah), agar teks yang hanya samar mirip tidak tampil "100%".
function matchPct(g) {
  const absolute = Math.min(1, g.rawCosine / 0.5);
  return Math.max(30, Math.min(99, Math.round(100 * g.score * (0.5 + 0.5 * absolute))));
}

function analyzeHybrid(text, cabangNum, targetBudget = null) {
  const model = getModel();
  const { ranked, keywords, queryTokens } = rank(model, text);
  const cabang = Math.max(1, cabangNum || 1);
  const notes = [];
  const items = [];

  const top = ranked[0];
  const chosen = [];
  if (top && top.score >= MIN_TOP_SCORE) {
    chosen.push(top);
    ranked.slice(1, MAX_GROUPS).forEach(g => { if (g.score >= top.score * SECONDARY_MIN_RATIO && g.content > 0) chosen.push(g); });
  }

  const bandwidth = findBandwidthMbps(text);
  const periode = detectPeriode(text);
  const budgetPerGroup = targetBudget && targetBudget > 0 ? targetBudget / Math.max(1, chosen.length) : null;

  chosen.forEach((g, idx) => {
    const lex = LEXICON[g.key] || { qtyTerms: [] };
    const qty = findQuantity(text, lex.qtyTerms);
    const sel = selectProducts(g, { text, tokens: queryTokens, bandwidth, budgetPerGroup, cabang, limit: idx === 0 ? 2 : 1 });
    if (sel.note) notes.push(sel.note);
    sel.rows.forEach(prod => {
      items.push({
        id: prod.id,
        product_id: prod.id,
        price_version_id: currentVersionId(prod.id),
        nama: displayName(prod),
        sumber: "REKOMENDASI AI",
        harga: prod.harga || 0,
        psb: inferPsb(prod),
        satuan: prod.satuan_hint || "unit",
        qty: qty ? qty.qty : cabang,
        periode,
        ref: prod.sheet === "wifi" ? "Wifi Managed (WMS)" : `${prod.sheet.toUpperCase()} • ${prod.layanan}`,
        kategori: prod.sheet === "wifi" ? "WMS" : prod.sheet.toUpperCase(),
        jenis_layanan: prod.layanan,
        kecocokan: matchPct(g),
        reasoning: reasoning(prod.sheet, prod.layanan)
      });
    });
  });

  if (!items.length) {
    // Teks terlalu umum: sarankan HSI 1S termurah sebagai titik awal, ditandai kecocokan rendah.
    const fallback = selectProducts({ sheet: "hsi", layanan: "1S" }, { text, tokens: [], bandwidth, budgetPerGroup: targetBudget, cabang, limit: 1 });
    fallback.rows.forEach(prod => items.push({
      id: prod.id, product_id: prod.id, price_version_id: currentVersionId(prod.id), nama: displayName(prod),
      sumber: "REKOMENDASI AI", harga: prod.harga, psb: inferPsb(prod), satuan: "unit", qty: cabang, periode,
      ref: "HSI • 1S", kategori: "HSI", jenis_layanan: "1S", kecocokan: 30, reasoning: reasoning("hsi", "1S")
    }));
    notes.push("Kebutuhan terlalu umum untuk dicocokkan secara spesifik; HSI 1S ditampilkan sebagai titik awal. Perjelas kebutuhan lalu analisis ulang.");
  }

  if (targetBudget && targetBudget > 0) {
    const est = items.reduce((s, it) => s + it.harga * it.qty, 0);
    if (est > targetBudget) {
      notes.push(`Penyesuaian Budget: Total estimasi penawaran idealnya (Rp ${est.toLocaleString("id-ID")} per bulan), dibandingkan dengan budget pelanggan (Rp ${Number(targetBudget).toLocaleString("id-ID")} per bulan).`);
    }
  }

  return {
    engine: "hybrid",
    keywords: keywords.length ? keywords : ["Umum"],
    notes,
    items,
    ranking: ranked.slice(0, 5).map(r => ({ layanan: r.key, skor: +r.score.toFixed(3), konten: +r.content.toFixed(3), riwayat: +r.history.toFixed(3) }))
  };
}

function analyzeNeed(text, cabangNum, targetBudget = null, engine = process.env.RECOMMENDER_ENGINE || "hybrid") {
  if (engine === "baseline") {
    const r = baseline.analyzeNeed(text, cabangNum, targetBudget);
    return { engine: "baseline", ...r };
  }
  return analyzeHybrid(text, cabangNum, targetBudget);
}

module.exports = { analyzeNeed, analyzeHybrid, invalidate, getModel, loadHistory };
