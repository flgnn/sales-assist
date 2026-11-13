# Rencana mingguan vs realisasi

| Minggu | Rencana | Realisasi di repo | Status |
|---|---|---|---|
| 1–3 | Sumber topik, proposal awal | Dokumen di luar kode | Dokumen |
| 4–5 | Proposal & target metrik | Target NF-01..NF-08 dijadikan skrip/tes terukur | Dokumen + skrip |
| 6–7 | SRS, use case, ERD, API, mockup | `docs/desain.md`; tampilan UI aktual di `public/` (mockup formal Figma tidak dibuat) | Selesai (mockup sebagai UI) |
| 8 | RBAC & persetujuan (F-04..F-06) | `rbac.js`, `approvalService.js`, `audit.js`, tes approval/rbac | Selesai |
| 8–9 | Master data & versi harga (F-10, F-11) | `masterDataService.js`, impor Excel, `product_price_versions`, `/price-trace` | Selesai |
| 9 | Rekomendasi hibrida (F-03) | `src/services/recommender/*` | Selesai |
| 10 | PDF & email (F-07, F-08) | `quotationPdf.js`, `emailService.js` (mode uji bila SMTP kosong) | Selesai; SMTP nyata belum diuji |
| 10 | Pipeline (F-09, F-12) | `pipelineService.js`, `reminderScheduler.js` | Selesai |
| 11 | Metrik rekomendasi (NF-05) | `npm run eval:recommender` → top-3 99,3% (n=141, sintetis) | Terukur, data sintetis |
| 11 | Keamanan (NF-01) | helmet/CSP, CORS whitelist, rate limit, validator; uji otomatis kontrol keamanan | Tidak ada pemindaian eksternal |
| 11 | Kualitas (NF-02) | 78 tes, cakupan ±86,7% stmt / 69% branch | Terpenuhi |
| 12 | Kinerja (NF-03) | `loadtest.js`: p95 ±333 ms @50 pengguna | Terpenuhi (mesin lokal) |
| 12 | Waktu penyusunan (NF-06) | `time-analysis.js`, templat CSV | Perlu data pengukuran nyata |
| 12 | Docker (NF-08) | Dockerfile, compose, entrypoint | Terverifikasi 7 Nov 2026 (build, container healthy, /api/health ok) |
| 13 | Sidang | Akun demo + seed idempoten, skrip eval/beban | Siap demo |
| 14 | Revisi & paket akhir | `.github/workflows/ci.yml`, README, dokumen hasil | Siap; isi laporan final manual |
