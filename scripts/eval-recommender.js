#!/usr/bin/env node
/**
 * Evaluasi mesin rekomendasi (baseline KP vs hibrida) pada kasus uji berlabel.
 *
 *   node scripts/eval-recommender.js [--split=dev|test|all] [--alpha=0.75] [--beta=0.25] [--json=out.json] [--md=out.md] [--verbose]
 *
 * Metrik: top-1, top-3 accuracy, MRR. Label = layanan (sheet|layanan) kebutuhan utama.
 * Sinyal riwayat memakai validasi silang 5-fold (riwayat = kasus di fold lain dengan label emasnya
 * sebagai "layanan yang pernah dipilih"), sehingga kasus yang dinilai tidak pernah terlihat di riwayatnya.
 */
process.env.DB_PATH = process.env.DB_PATH || ":memory:";
const fs = require("fs");
const path = require("path");
const db = require("../src/db/db");
const { seedMasterProducts } = require("../src/db/seed");
const { buildModel, rank } = require("../src/services/recommender/hybrid");
const { analyzeNeed: baselineAnalyze } = require("../src/services/aiMatcher");

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true];
}));
const split = args.split || "all";
const alpha = args.alpha !== undefined ? parseFloat(args.alpha) : undefined;
const beta = args.beta !== undefined ? parseFloat(args.beta) : undefined;

if (db.prepare("SELECT COUNT(*) c FROM master_products").get().c === 0) seedMasterProducts(false);
const products = db.prepare("SELECT * FROM master_products WHERE is_active = 1").all();

const dataset = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "eval", "test_cases.json"), "utf8"));
const all = dataset.cases;
const selected = all.filter(c => split === "all" || c.split === split);

const FOLDS = 5;
const foldOf = (idx) => idx % FOLDS;

function metrics(rows) {
  const n = rows.length;
  const top1 = rows.filter(r => r.rank === 1).length / n;
  const top3 = rows.filter(r => r.rank > 0 && r.rank <= 3).length / n;
  const mrr = rows.reduce((s, r) => s + (r.rank > 0 ? 1 / r.rank : 0), 0) / n;
  return { n, top1, top3, mrr };
}

function baselineRank(c) {
  const { items } = baselineAnalyze(c.text, 1, null);
  const order = [];
  items.forEach(it => {
    const k = `${String(it.kategori).toLowerCase() === "wms" ? "wifi" : String(it.kategori).toLowerCase()}|${it.jenis_layanan}`;
    if (!order.includes(k)) order.push(k);
  });
  const pos = order.indexOf(c.expected);
  return { rank: pos >= 0 ? pos + 1 : 0, predicted: order.slice(0, 3) };
}

const baselineRows = [], contentRows = [], hybridRows = [];
const failures = [];
all.forEach((c, idx) => {
  if (!selected.includes(c)) return;
  const b = baselineRank(c);
  baselineRows.push({ id: c.id, ...b });

  // content-only (beta = 0)
  const contentModel = buildModel(products, [], { alpha: 1, beta: 0 });
  const cr = rank(contentModel, c.text);
  const cpos = cr.ranked.findIndex(x => x.key === c.expected);
  contentRows.push({ id: c.id, rank: cpos >= 0 ? cpos + 1 : 0 });

  // hibrida: riwayat = kasus pada fold lain (leave-fold-out)
  const history = all.filter((o, j) => foldOf(j) !== foldOf(idx)).map(o => ({ kebutuhan: o.text, groups: [o.expected] }));
  const opts = {};
  if (alpha !== undefined) opts.alpha = alpha;
  if (beta !== undefined) opts.beta = beta;
  const hm = buildModel(products, history, opts);
  const hr = rank(hm, c.text);
  const hpos = hr.ranked.findIndex(x => x.key === c.expected);
  hybridRows.push({ id: c.id, rank: hpos >= 0 ? hpos + 1 : 0, predicted: hr.ranked.slice(0, 3).map(x => x.key) });
  if (hpos < 0 || hpos >= 3) failures.push({ id: c.id, text: c.text, expected: c.expected, got: hr.ranked.slice(0, 3).map(x => x.key), rank: hpos + 1 });
});

const mb = metrics(baselineRows), mc = metrics(contentRows), mh = metrics(hybridRows);
const pct = (x) => (x * 100).toFixed(1) + "%";
const result = {
  generated_at: new Date().toISOString(),
  split, cases: selected.length, folds: FOLDS,
  weights: { alpha: alpha ?? 0.75, beta: beta ?? 0.25 },
  baseline_kp: mb, content_only: mc, hybrid: mh,
  delta_top3_pp: +((mh.top3 - mb.top3) * 100).toFixed(1),
  target: { top3: 0.85, delta_pp: 10 },
  meets_target: mh.top3 >= 0.85 && (mh.top3 - mb.top3) * 100 >= 10,
  failures_hybrid_top3: failures
};

console.log(`\nEvaluasi rekomendasi — split=${split}, n=${selected.length}`);
console.log("                     Top-1     Top-3     MRR");
console.log(`Baseline KP         ${pct(mb.top1).padStart(7)}  ${pct(mb.top3).padStart(7)}  ${mb.mrr.toFixed(3)}`);
console.log(`TF-IDF saja         ${pct(mc.top1).padStart(7)}  ${pct(mc.top3).padStart(7)}  ${mc.mrr.toFixed(3)}`);
console.log(`Hibrida (+riwayat)  ${pct(mh.top1).padStart(7)}  ${pct(mh.top3).padStart(7)}  ${mh.mrr.toFixed(3)}`);
console.log(`Selisih top-3 hibrida vs baseline: ${result.delta_top3_pp} poin persentase | target (>=85% & >=+10pp) tercapai: ${result.meets_target}`);
if (args.verbose) failures.forEach(f => console.log(` ✗ ${f.id} [${f.expected}] -> ${f.got.join(", ")} :: ${f.text}`));
if (args.json) fs.writeFileSync(args.json, JSON.stringify(result, null, 2));
if (args.md) {
  const md = `# Hasil evaluasi mesin rekomendasi\n\nTanggal: ${result.generated_at}  \nSplit: ${split} (${selected.length} kasus), riwayat: validasi silang ${FOLDS}-fold\n\n| Metode | Top-1 | Top-3 | MRR |\n|---|---|---|---|\n| Baseline KP (rule-based) | ${pct(mb.top1)} | ${pct(mb.top3)} | ${mb.mrr.toFixed(3)} |\n| TF-IDF + normalisasi | ${pct(mc.top1)} | ${pct(mc.top3)} | ${mc.mrr.toFixed(3)} |\n| Hibrida (+ riwayat RAB) | ${pct(mh.top1)} | ${pct(mh.top3)} | ${mh.mrr.toFixed(3)} |\n\nSelisih top-3 hibrida terhadap baseline: **${result.delta_top3_pp} poin persentase**. Target (top-3 ≥ 85% dan naik ≥ 10 poin): **${result.meets_target ? "tercapai" : "belum tercapai"}**.\n\n## Kasus gagal (hibrida, di luar top-3)\n\n${failures.length ? failures.map(f => `- ${f.id} — label \`${f.expected}\`, prediksi ${f.got.map(g => "`" + g + "`").join(", ")}: ${f.text}`).join("\n") : "Tidak ada."}\n`;
  fs.writeFileSync(args.md, md);
}
process.exit(0);
