#!/usr/bin/env node
/**
 * Analisis penurunan waktu penyusunan dokumen penawaran (target: turun ≥ 30%, ≥ 10 skenario).
 *   node scripts/time-analysis.js docs/uat/waktu_penyusunan.csv
 * CSV: skenario,manual_detik,sistem_detik  — diukur dengan stopwatch dari "kebutuhan diterima" sampai
 * "dokumen penawaran siap kirim", memakai skenario yang sama untuk proses manual (Rekap Harga -> Template SE) dan Sales Assist 2.0.
 */
const fs = require("fs");

function analyze(csv) {
  const rows = csv.split(/\r?\n/).map(l => l.trim()).filter(Boolean).slice(1).map(l => {
    const [skenario, manual, sistem] = l.split(",").map(x => x.trim());
    const m = Number(manual), s = Number(sistem);
    if (!(m > 0) || !(s >= 0)) throw new Error(`Baris tidak valid: ${l}`);
    return { skenario, manual: m, sistem: s, turun_pct: +((m - s) / m * 100).toFixed(1) };
  });
  const n = rows.length;
  const sumM = rows.reduce((a, r) => a + r.manual, 0), sumS = rows.reduce((a, r) => a + r.sistem, 0);
  const meanPct = n ? rows.reduce((a, r) => a + r.turun_pct, 0) / n : 0;
  return { n, rata2_turun_pct: +meanPct.toFixed(1), total_turun_pct: n ? +((sumM - sumS) / sumM * 100).toFixed(1) : 0,
    meets_target: n >= 10 && meanPct >= 30, rows };
}
module.exports = { analyze };

if (require.main === module) {
  const file = process.argv[2] || "docs/uat/waktu_penyusunan.csv";
  if (!fs.existsSync(file)) { console.error(`Berkas ${file} tidak ditemukan. Salin docs/uat/waktu_penyusunan_template.csv lalu isi dengan hasil pengukuran nyata.`); process.exit(2); }
  const r = analyze(fs.readFileSync(file, "utf8"));
  console.table(r.rows);
  console.log(`n=${r.n} | rata-rata penurunan=${r.rata2_turun_pct}% | penurunan total=${r.total_turun_pct}% | target (n>=10 & >=30%): ${r.meets_target ? "TERCAPAI" : "BELUM"}`);
}
