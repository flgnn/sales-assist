# Sales Assist 2.0 — Capstone

Aplikasi pendukung penyusunan RAB, rekomendasi produk, persetujuan, penawaran (SPH PDF + email), dan pipeline penjualan.
Pengembangan lanjutan dari Sales Assist (KP). Penulis: Muhamad Falgan Firdaus (NPM 237006145), Universitas Siliwangi.

## Menjalankan

```bash
npm install
cp .env.example .env      # isi JWT_SECRET dengan string acak panjang
npm run seed              # akun demo + master produk (idempoten)
npm start                 # http://localhost:3001
```

Docker: `docker compose up --build` (volume data persisten; seed otomatis).

## Akun demo (ubah/hapus sebelum dipakai nyata)

| Peran | Username | Password |
|---|---|---|
| Sales | akbar.trisnamulya | sales123 |
| Sales | sales2 | sales123 |
| Manajer | manager | manager123 |
| Admin | admin | admin123 |

## Peran dan alur

- **Sales**: membuat RAB, analisis rekomendasi, mengajukan persetujuan, menarik kembali, mengirim penawaran, mengelola pipeline miliknya.
- **Manajer**: menyetujui/menolak (catatan wajib saat menolak, tidak boleh memutuskan RAB sendiri), memantau pipeline.
- **Admin**: master produk (CRUD, nonaktifkan, impor Excel, riwayat versi harga), pengguna/peran, audit log. Admin tidak otomatis menyetujui RAB.

Status RAB: `draft → diajukan → disetujui | ditolak`; `ditolak → diajukan`; `diajukan → draft` (tarik kembali). RAB `diajukan/disetujui` terkunci (409 bila diedit). Setiap perubahan status ditulis ke `audit_logs` dalam transaksi yang sama.

## Variabel lingkungan
Lihat `.env.example`. Penting: `JWT_SECRET` (wajib di production), `CORS_ORIGINS`, `RECOMMENDER_ENGINE` (`hybrid`|`baseline`), `SMTP_*` (tanpa ini email berjalan **mode uji/simulasi**), `REMINDER_EMAIL`.

## Skrip

| Perintah | Fungsi |
|---|---|
| `npm test` / `npm run test:coverage` | 78 tes (Jest + Supertest), ambang cakupan 70% |
| `npm run eval:recommender` | Evaluasi rekomendasi → `docs/hasil-evaluasi-rekomendasi.*` |
| `node scripts/loadtest.js --md=docs/hasil-uji-beban.md` | Uji beban 50 pengguna konkuren |
| `node scripts/time-analysis.js <csv>` | Analisis waktu penyusunan manual vs Sales Assist |

## Dokumen
- `docs/desain.md` — use case, ERD, daftar API, diagram alur persetujuan
- `docs/rencana-vs-realisasi.md` — pemetaan rencana mingguan (1–14) ke kode dan bukti
- `docs/hasil-evaluasi-rekomendasi.md`, `docs/hasil-uji-beban.md` — hasil terukur
- `docs/uat/` — templat data pengukuran waktu penyusunan

## Catatan penting
- Dataset evaluasi rekomendasi (141 kasus) **dibuat secara sintetis** dari master data; hasilnya belum menggantikan kasus nyata dari Telkom.
- Perbandingan waktu penyusunan (≥10 skenario) hanya boleh diisi dari hasil pengukuran nyata. Build Docker sudah diverifikasi (`docker compose up --build`, `/api/health` ok).
- Pengiriman email berjalan mode uji (simulasi) sampai `SMTP_*` diisi.
- Pengujian keamanan dibatasi pada uji otomatis kontrol keamanan (helmet/CSP, CORS, rate limit, ukuran payload).
- Rotasi seluruh rahasia yang pernah ada di `.env` lama (JWT_SECRET, Google client, SMTP).

## Mengunggah ke GitHub

```bash
git init
git add .
git status                # pastikan .env, node_modules, dan data/*.db TIDAK ikut
git commit -m "Sales Assist 2.0 - Capstone"
git branch -M main
git remote add origin https://github.com/<akun>/sales-assist.git
git push -u origin main
```

Buat dulu repositori kosong di GitHub (tanpa README). `.env` dan basis data sudah diabaikan oleh `.gitignore`; gunakan `.env.example` sebagai contoh konfigurasi. GitHub Actions (`.github/workflows/ci.yml`) otomatis menjalankan tes, cakupan, evaluasi rekomendasi, dan build Docker.
