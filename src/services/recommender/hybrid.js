/**
 * Mesin rekomendasi hibrida Sales Assist 2.0.
 *
 * Sinyal:
 *   1) Konten  : TF-IDF + normalisasi istilah bahasa Indonesia, query = teks kebutuhan,
 *                dokumen = satu dokumen per layanan (nama layanan + paket + rekomendasi_penggunaan + lexicon domain)
 *   2) Riwayat : kemiripan teks kebutuhan dengan RAB terdahulu (k tetangga terdekat) yang memilih layanan tersebut
 *
 *   skor(g) = ALPHA * (cos_tfidf(g) / max cos) + BETA * skor_riwayat(g)
 *
 * Bobot ALPHA/BETA dipilih dari kasus uji "dev" (lihat scripts/eval-recommender.js).
 * Modul ini murni (tidak menyentuh database) agar dapat dievaluasi secara offline dan diuji unit.
 */
const { tokenize } = require("./text");
const { TfidfIndex } = require("./tfidf");
const { LEXICON } = require("./lexicon");

const DEFAULTS = { alpha: 0.75, beta: 0.25, neighbors: 5, minHistorySim: 0.15 };

function groupKey(sheet, layanan) { return `${sheet}|${layanan}`; }

/**
 * @param {Array} products   baris master_products (aktif)
 * @param {Array} history    [{ kebutuhan: string, groups: ['hsi|1S', ...] }]
 */
function buildModel(products, history = [], options = {}) {
  const cfg = { ...DEFAULTS, ...options };
  const groups = new Map();
  products.forEach(p => {
    const key = groupKey(p.sheet, p.layanan);
    if (!groups.has(key)) groups.set(key, { key, sheet: p.sheet, layanan: p.layanan, paket: new Set(), usage: new Set() });
    const g = groups.get(key);
    if (p.paket) g.paket.add(p.paket);
    if (p.rekomendasi_penggunaan) g.usage.add(p.rekomendasi_penggunaan);
  });
  const groupList = [...groups.values()];
  const docs = groupList.map(g => {
    const lex = LEXICON[g.key] || { terms: "" };
    const text = [g.layanan, g.sheet === "wifi" ? "wifi" : "", [...g.paket].join(" "), [...g.usage].join(" "), lex.terms, lex.terms].join(" ");
    return tokenize(text);
  });

  const histTokens = history.map(h => tokenize(h.kebutuhan));
  // idf dihitung dari korpus gabungan (dokumen layanan + riwayat) agar kedua sinyal berbagi ruang istilah.
  const index = new TfidfIndex([...docs, ...histTokens]);
  const groupVecs = index.vectors.slice(0, docs.length);
  const histVecs = index.vectors.slice(docs.length);

  return { cfg, groupList, groupVecs, histVecs, history, index };
}

function rank(model, text) {
  const { cfg, groupList, groupVecs, histVecs, history, index } = model;
  const qTokens = tokenize(text);
  const q = index.vectorize(qTokens);

  const cos = groupVecs.map(v => TfidfIndex.cosine(q, v));
  const maxCos = Math.max(...cos, 1e-9);

  // Sinyal riwayat: bobot kemiripan tetangga terdekat yang memilih layanan g.
  const hist = new Map();
  let hasHistory = false;
  if (histVecs.length) {
    const sims = histVecs.map((v, i) => ({ i, s: TfidfIndex.cosine(q, v) }))
      .filter(x => x.s >= cfg.minHistorySim)
      .sort((a, b) => b.s - a.s)
      .slice(0, cfg.neighbors);
    const total = sims.reduce((s, x) => s + x.s, 0);
    if (total > 0) {
      hasHistory = true;
      sims.forEach(({ i, s }) => {
        history[i].groups.forEach(g => hist.set(g, (hist.get(g) || 0) + s / total / history[i].groups.length));
      });
    }
  }

  const ranked = groupList.map((g, i) => {
    const content = cos[i] / maxCos;
    const hs = hist.get(g.key) || 0;
    // Tanpa tetangga riwayat yang cukup mirip, tidak ada bukti riwayat: skor = sinyal konten saja
    // (bobot riwayat tidak "hilang" sehingga skor teratas tidak terpotong di alpha).
    const score = !hasHistory ? content : (maxCos > 1e-6 ? cfg.alpha * content + cfg.beta * hs : cfg.beta * hs);
    return { key: g.key, sheet: g.sheet, layanan: g.layanan, score, content, history: hs, rawCosine: cos[i] };
  }).sort((a, b) => b.score - a.score || b.rawCosine - a.rawCosine);

  // Istilah query yang paling berkontribusi pada layanan teratas (untuk ditampilkan sebagai "keywords").
  let keywords = [];
  if (ranked.length && ranked[0].rawCosine > 0) {
    const topIdx = groupList.findIndex(g => g.key === ranked[0].key);
    const gv = groupVecs[topIdx];
    keywords = [...q.entries()]
      .map(([t, w]) => [t, w * (gv.get(t) || 0)])
      .filter(([, c]) => c > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([t]) => t);
  }
  return { ranked, keywords, queryTokens: qTokens };
}

module.exports = { buildModel, rank, groupKey, DEFAULTS };
