#!/usr/bin/env node
/**
 * Menghitung skor SUS (System Usability Scale, Brooke 1996) dari CSV respons UAT.
 *   node scripts/sus-score.js docs/uat/sus_responses.csv
 * CSV: responden,q1..q10 (skala 1-5). Item ganjil positif, genap negatif.
 * Skor = ((Σ(ganjil-1)) + (Σ(5-genap))) × 2.5  → 0..100. Target proposal: rata-rata ≥ 70 dengan ≥ 10 responden.
 */
const fs = require("fs");

function susScore(answers) {
  if (answers.length !== 10 || answers.some(a => !Number.isInteger(a) || a < 1 || a > 5)) throw new Error("SUS memerlukan 10 jawaban bulat 1-5.");
  const sum = answers.reduce((s, a, i) => s + (i % 2 === 0 ? a - 1 : 5 - a), 0);
  return sum * 2.5;
}

function analyze(csv) {
  const lines = csv.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const rows = lines.slice(1).map((l, i) => {
    const c = l.split(",").map(x => x.trim());
    return { responden: c[0] || `R${i + 1}`, skor: susScore(c.slice(1, 11).map(Number)) };
  });
  const n = rows.length;
  const mean = n ? rows.reduce((s, r) => s + r.skor, 0) / n : 0;
  return { n, mean: +mean.toFixed(1), min: n ? Math.min(...rows.map(r => r.skor)) : 0, max: n ? Math.max(...rows.map(r => r.skor)) : 0,
    meets_target: n >= 10 && mean >= 70, rows };
}

module.exports = { susScore, analyze };

if (require.main === module) {
  const file = process.argv[2] || "docs/uat/sus_responses.csv";
  if (!fs.existsSync(file)) { console.error(`Berkas ${file} tidak ditemukan. Isi berkas CSV dengan respons responden nyata.`); process.exit(2); }
  const r = analyze(fs.readFileSync(file, "utf8"));
  console.table(r.rows);
  console.log(`n=${r.n} | rata-rata SUS=${r.mean} | min=${r.min} | max=${r.max} | target (n>=10 & rata-rata>=70): ${r.meets_target ? "TERCAPAI" : "BELUM"}`);
}
