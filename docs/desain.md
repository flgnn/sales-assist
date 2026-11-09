# Desain Sales Assist 2.0 (Minggu 6–7)

## Use case
```mermaid
flowchart LR
  S([Sales]) --> UC1[Buat & simpan RAB]
  S --> UC2[Analisis rekomendasi]
  S --> UC3[Ajukan / tarik kembali]
  S --> UC4[Buat SPH PDF & kirim email]
  S --> UC5[Kelola peluang pipeline]
  M([Manajer]) --> UC6[Setujui / tolak + catatan]
  M --> UC7[Pantau pipeline]
  A([Admin]) --> UC8[Master produk & impor Excel]
  A --> UC9[Riwayat versi harga]
  A --> UC10[Kelola peran pengguna]
  A --> UC11[Lihat audit log]
```

## ERD
```mermaid
erDiagram
  users ||--o{ sessions : memiliki
  sessions ||--o{ session_items : berisi
  master_products ||--o{ product_price_versions : berversi
  master_products ||--o{ session_items : product_id
  product_price_versions ||--o{ session_items : price_version_id
  sessions ||--o{ quotation_deliveries : dikirim
  sessions ||--o{ opportunities : session_id
  users ||--o{ opportunities : owner
  opportunities ||--o{ opportunity_events : riwayat
  users ||--o{ audit_logs : aktor
  users { int id string username string role }
  sessions { int id string approval_status string recommender_engine }
  session_items { int id int product_id int price_version_id }
  master_products { int id int is_active }
  product_price_versions { int id int product_id }
  audit_logs { int id string action string entity }
  opportunities { int id string stage string lost_reason }
```

## Alur persetujuan
```mermaid
stateDiagram-v2
  [*] --> draft
  draft --> diajukan: submit
  diajukan --> draft: recall (sales)
  diajukan --> disetujui: manajer
  diajukan --> ditolak: manajer + catatan ≥5 huruf
  ditolak --> diajukan: ajukan ulang
  disetujui --> disetujui: finalize (nomor RAB, idempoten)
```

## Alur pipeline
prospek → penawaran | kalah; penawaran → negosiasi | menang | kalah; negosiasi → penawaran | menang | kalah. Menang/kalah final; kalah wajib `lost_reason`. Win rate = menang/(menang+kalah).

## Daftar API (prefiks `/api`)
| Area | Endpoint |
|---|---|
| auth | POST login, register, google; GET google/config |
| sessions | POST/GET `/`; GET/PUT/DELETE `/:id`; POST `/:id/analyze`, `/items`, `/clone`; POST `/:id/submit`, `/recall`, `/decision`, `/approve`; GET `/:id/audit`, `/price-trace`, `/quotation.pdf`, `/deliveries`, `/rab.xlsx`; POST `/:id/send-quotation` |
| approvals | GET `/` (antrean manajer) |
| master-data | GET/POST `/`; GET/PUT/DELETE `/:id`; GET `/:id/versions`; POST `/:id/reactivate`, `/import` (dry_run); GET `/import/template.xlsx` |
| pipeline | GET `/`, `/summary`, `/reminders`; POST `/`, `/:id/stage`; PUT/DELETE `/:id` |
| audit, users | GET `/audit`; GET `/users`, PUT `/users/:id/role` |

## Rekomendasi hibrida
Skor = 0,75·TF-IDF(konten layanan, normalisasi Indonesia) + 0,25·kNN riwayat RAB disetujui; tanpa riwayat → konten saja. Baseline KP (`aiMatcher.js`) dibekukan untuk pembanding.
