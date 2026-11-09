# Hasil evaluasi mesin rekomendasi

Tanggal: 2026-11-02T12:47:22.352Z  
Split: all (141 kasus), riwayat: validasi silang 5-fold

| Metode | Top-1 | Top-3 | MRR |
|---|---|---|---|
| Baseline KP (rule-based) | 34.0% | 53.2% | 0.435 |
| TF-IDF + normalisasi | 92.2% | 99.3% | 0.959 |
| Hibrida (+ riwayat RAB) | 93.6% | 99.3% | 0.966 |

Selisih top-3 hibrida terhadap baseline: **46.1 poin persentase**. Target (top-3 ≥ 85% dan naik ≥ 10 poin): **tercapai**.

## Kasus gagal (hibrida, di luar top-3)

- K122 — label `hsi|1S`, prediksi `hsi|3S`, `hsi|2S`, `datin|IP Transit`: internet kantor
