# Hasil uji beban API

Tanggal: 2026-11-09T08:02:21.488Z  
Lingkungan: Node v22.11.0, 8 vCPU (Intel(R) Core(TM) i7-8665U CPU @ 1.90GHz), RAM 7.8 GB, DB SQLite in-memory berisi 2.134 produk; klien dan server pada mesin yang sama.

**50 pengguna konkuren, 15.3 detik, 3037 permintaan (198.3 req/s)**

| Metrik | Hasil | Target |
|---|---|---|
| p50 | 204.2 ms | - |
| p95 (semua endpoint) | 468.1 ms | < 500 ms |
| p95 (tanpa PDF) | 450.1 ms | < 500 ms |
| p99 | 1184.3 ms | - |
| Error rate | 0% | 0% |

Target: **tercapai**

| Endpoint | n | p50 (ms) | p95 (ms) | galat |
|---|---|---|---|---|
| GET /api/master-data (daftar produk) | 864 | 188.3 | 429.4 | 0 |
| GET /api/sessions (riwayat) | 672 | 335.3 | 494.5 | 0 |
| POST /api/sessions (simpan RAB) | 432 | 150.8 | 411.7 | 0 |
| POST /api/sessions/:id/analyze (rekomendasi) | 431 | 195.2 | 407.3 | 0 |
| GET /api/sessions/:id/quotation.pdf | 217 | 185.1 | 1391.5 | 0 |
| GET /api/pipeline/summary | 421 | 172.6 | 373.3 | 0 |

> Catatan: klien dan server berbagi CPU sehingga hasil ini konservatif untuk sisi server tetapi tidak mewakili jaringan nyata. Ulangi pada server demo (Docker/VPS) sebelum sidang dengan `node scripts/loadtest.js --url=https://<host>`.
