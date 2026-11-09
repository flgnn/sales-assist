#!/usr/bin/env node
/**
 * Uji beban API (target proposal: p95 < 500 ms pada 50 pengguna konkuren).
 *
 *   node scripts/loadtest.js [--url=http://localhost:3001] [--users=50] [--seconds=15] [--user=akbar.trisnamulya --pass=sales123] [--md=docs/hasil-uji-beban.md]
 *
 * Tanpa --url, skrip menjalankan server sendiri (DB in-memory + seed) di port acak sehingga hasilnya
 * dapat direproduksi. Catat spesifikasi mesin pada laporan; hasil bergantung pada perangkat keras.
 * Pengujian ini sah dijalankan hanya pada sistem milik sendiri / berizin.
 */
const fs = require("fs");
const os = require("os");

const args = Object.fromEntries(process.argv.slice(2).map(a => { const m = a.match(/^--([^=]+)=?(.*)$/); return m ? [m[1], m[2] === "" ? true : m[2]] : [a, true]; }));
const USERS = parseInt(args.users, 10) || 50;
const SECONDS = parseInt(args.seconds, 10) || 15;

async function startLocal() {
  process.env.DB_PATH = ":memory:"; process.env.NODE_ENV = "test"; process.env.JWT_SECRET = "loadtest";
  const log = console.log; console.log = () => {};
  const db = require("../src/db/db");
  const { seedUsers, seedMasterProducts } = require("../src/db/seed");
  seedUsers(); seedMasterProducts(false); db.ensurePriceVersions();
  console.log = log;
  const { createApp } = require("../src/app");
  const server = createApp().listen(0);
  await new Promise(r => server.once("listening", r));
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
}

const pct = (arr, p) => arr.length ? arr[Math.min(arr.length - 1, Math.floor(arr.length * p))] : 0;

async function main() {
  const local = args.url ? null : await startLocal();
  const base = args.url || local.url;
  const user = args.user || "akbar.trisnamulya", pass = args.pass || "sales123";
  const login = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: user, password: pass }) });
  if (!login.ok) throw new Error("Login uji beban gagal: " + login.status);
  const token = (await login.json()).token;
  const H = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  const sess = await (await fetch(`${base}/api/sessions`, { method: "POST", headers: H, body: JSON.stringify({ nama_pelanggan: "PT Beban", kebutuhan: "Hotel butuh wifi managed dan 10 cctv", cabang: "2" }) })).json();
  const sid = sess.session.id;
  await fetch(`${base}/api/sessions/${sid}/analyze`, { method: "POST", headers: H, body: "{}" });
  // Sesi terpisah (tidak diubah selama uji) untuk PDF: pratinjau berulang atas RAB yang sama memakai cache.
  const pdfSess = await (await fetch(`${base}/api/sessions`, { method: "POST", headers: H, body: JSON.stringify({ nama_pelanggan: "PT PDF", kebutuhan: "Hotel butuh wifi managed dan 10 cctv", cabang: "2" }) })).json();
  const pdfSid = pdfSess.session.id;
  await fetch(`${base}/api/sessions/${pdfSid}/analyze`, { method: "POST", headers: H, body: "{}" });

  const SCENARIOS = [
    { name: "GET /api/master-data (daftar produk)", weight: 4, run: () => fetch(`${base}/api/master-data?sheet=hsi&limit=50`, { headers: H }) },
    { name: "GET /api/sessions (riwayat)", weight: 3, run: () => fetch(`${base}/api/sessions`, { headers: H }) },
    { name: "POST /api/sessions (simpan RAB)", weight: 2, run: () => fetch(`${base}/api/sessions`, { method: "POST", headers: H, body: JSON.stringify({ nama_pelanggan: "PT Uji", kebutuhan: "internet bisnis" }) }) },
    { name: "POST /api/sessions/:id/analyze (rekomendasi)", weight: 2, run: () => fetch(`${base}/api/sessions/${sid}/analyze`, { method: "POST", headers: H, body: "{}" }) },
    { name: "GET /api/sessions/:id/quotation.pdf", weight: 1, run: async () => { const r = await fetch(`${base}/api/sessions/${pdfSid}/quotation.pdf`, { headers: H }); await r.arrayBuffer(); return r; } },
    { name: "GET /api/pipeline/summary", weight: 2, run: () => fetch(`${base}/api/pipeline/summary`, { headers: H }) }
  ];
  const bag = SCENARIOS.flatMap(s => Array(s.weight).fill(s));
  const stats = new Map(SCENARIOS.map(s => [s.name, { lat: [], err: 0 }]));
  const all = [];
  let errors = 0, total = 0;
  const end = Date.now() + SECONDS * 1000;

  async function worker(i) {
    let k = i;
    while (Date.now() < end) {
      const sc = bag[k++ % bag.length];
      const t0 = performance.now();
      let ok = false;
      try { const r = await sc.run(); ok = r.status < 400; if (!r.bodyUsed) await r.arrayBuffer().catch(() => {}); } catch (e) { ok = false; }
      const ms = performance.now() - t0;
      const st = stats.get(sc.name);
      st.lat.push(ms); all.push(ms); total++;
      if (!ok) { st.err++; errors++; }
    }
  }
  const t0 = Date.now();
  await Promise.all(Array.from({ length: USERS }, (_, i) => worker(i)));
  const elapsed = (Date.now() - t0) / 1000;
  all.sort((a, b) => a - b);
  const summary = { users: USERS, seconds: +elapsed.toFixed(1), requests: total, rps: +(total / elapsed).toFixed(1), error_rate_pct: +(errors * 100 / total).toFixed(2),
    p50: +pct(all, 0.5).toFixed(1), p95: +pct(all, 0.95).toFixed(1), p99: +pct(all, 0.99).toFixed(1) };
  // Endpoint alur kritis (daftar produk, simpan RAB, rekomendasi, riwayat, pipeline) dilaporkan terpisah dari pembuatan PDF
  // yang memang CPU-intensif. Keduanya ditampilkan; target proposal dinilai pada keseluruhan permintaan.
  const critical = [...stats.entries()].filter(([n]) => !/quotation\.pdf/.test(n)).flatMap(([, s]) => s.lat).sort((a, b) => a - b);
  summary.p95_tanpa_pdf = +pct(critical, 0.95).toFixed(1);
  summary.meets_target = summary.p95 < 500 && summary.error_rate_pct === 0;

  const rows = [...stats.entries()].map(([name, s]) => { s.lat.sort((a, b) => a - b); return { name, n: s.lat.length, p50: +pct(s.lat, 0.5).toFixed(1), p95: +pct(s.lat, 0.95).toFixed(1), err: s.err }; });
  console.log(`\nUji beban: ${USERS} pengguna konkuren, ${summary.seconds}s`);
  console.log(summary);
  console.table(rows);
  if (args.md) {
    const cpu = os.cpus();
    fs.writeFileSync(args.md, `# Hasil uji beban API\n\nTanggal: ${new Date().toISOString()}  \nLingkungan: Node ${process.version}, ${cpu.length} vCPU (${cpu[0].model}), RAM ${(os.totalmem() / 2 ** 30).toFixed(1)} GB, DB SQLite in-memory berisi 2.134 produk; klien dan server pada mesin yang sama.\n\n**${USERS} pengguna konkuren, ${summary.seconds} detik, ${summary.requests} permintaan (${summary.rps} req/s)**\n\n| Metrik | Hasil | Target |\n|---|---|---|\n| p50 | ${summary.p50} ms | - |\n| p95 (semua endpoint) | ${summary.p95} ms | < 500 ms |\n| p95 (tanpa PDF) | ${summary.p95_tanpa_pdf} ms | < 500 ms |\n| p99 | ${summary.p99} ms | - |\n| Error rate | ${summary.error_rate_pct}% | 0% |\n\nTarget: **${summary.meets_target ? "tercapai" : "belum tercapai"}**\n\n| Endpoint | n | p50 (ms) | p95 (ms) | galat |\n|---|---|---|---|---|\n${rows.map(r => `| ${r.name} | ${r.n} | ${r.p50} | ${r.p95} | ${r.err} |`).join("\n")}\n\n> Catatan: klien dan server berbagi CPU sehingga hasil ini konservatif untuk sisi server tetapi tidak mewakili jaringan nyata. Ulangi pada server demo (Docker/VPS) sebelum sidang dengan \`node scripts/loadtest.js --url=https://<host>\`.\n`);
  }
  if (local) local.close();
  process.exit(summary.meets_target ? 0 : 1);
}
main().catch(e => { console.error(e); process.exit(2); });
