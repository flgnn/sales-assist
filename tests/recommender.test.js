const { bootstrap, tokens, auth, request } = require("./helpers");
const { tokenize } = require("../src/services/recommender/text");
const { TfidfIndex } = require("../src/services/recommender/tfidf");
const { findQuantity, findBandwidthMbps, detectPeriode, wordsToNumber } = require("../src/services/recommender/quantity");

let app, db, t, reco;
beforeAll(async () => { ({ app, db } = bootstrap()); t = await tokens(app); reco = require("../src/services/recommender"); });

describe("Normalisasi teks", () => {
  test("sinonim/singkatan dipetakan ke istilah kanonis", () => {
    expect(tokenize("Kamera pengawas dan CCTV")).toEqual(expect.arrayContaining(["cctv"]));
    expect(tokenize("Wi-Fi hot spot")).toEqual(expect.arrayContaining(["wifi", "hotspot"]));
    expect(tokenize("Metro Ethernet / metro-e")).toEqual(["metroe", "metroe"]);
    expect(tokenize("tv kabel + telpon")).toEqual(["iptv", "voice"]);
  });
  test("stopword & angka dibuang, stem ringan", () => {
    expect(tokenize("kami butuh 10 unit")).toEqual([]);
    expect(tokenize("pembelajaran")).not.toContain("pembelajaran");
    expect(tokenize("")).toEqual([]);
    expect(tokenize(null)).toEqual([]);
  });
});

describe("TF-IDF", () => {
  test("dokumen yang berbagi istilah langka lebih mirip", () => {
    const idx = new TfidfIndex([["kucing", "makan", "ikan"], ["anjing", "makan", "tulang"], ["mobil", "balap"]]);
    const { scores } = idx.scores(["kucing", "ikan"]);
    expect(scores[0]).toBeGreaterThan(scores[1]);
    expect(scores[2]).toBe(0);
    expect(idx.idf("tidakada")).toBe(0);
  });
});

describe("Kuantitas / bandwidth / periode", () => {
  test("angka + satuan, kata, dan bukan Mbps", () => {
    expect(findQuantity("pasang 10 cctv di toko", ["cctv"])).toEqual({ qty: 10, unit: null });
    expect(findQuantity("20 buah cctv", ["cctv"]).qty).toBe(20);
    expect(findQuantity("dua puluh cctv", ["cctv"]).qty).toBe(20);
    expect(findQuantity("cctv sebanyak 8", ["cctv"]).qty).toBe(8);
    expect(findQuantity("Astinet 20 Mbps", ["astinet"])).toBeNull(); // perbaikan bug KP
    expect(findQuantity("tidak ada angka", ["cctv"])).toBeNull();
    expect(findQuantity("x", [])).toBeNull();
    expect(wordsToNumber("seratus dua puluh")).toBe(120);
  });
  test("bandwidth & periode", () => {
    expect(findBandwidthMbps("butuh 100 Mbps")).toBe(100);
    expect(findBandwidthMbps("1 Gbps")).toBe(1000);
    expect(findBandwidthMbps("tanpa angka")).toBeNull();
    expect(detectPeriode("beli putus kamera")).toBe("Sekali bayar");
    expect(detectPeriode("sewa bulanan")).toBe("Bulanan");
  });
});

describe("Mesin hibrida", () => {
  test("peringkat layanan benar + keterlacakan produk + kuantitas", () => {
    const r = reco.analyzeNeed("Toko swalayan ingin pasang 10 CCTV online yang bisa dipantau lewat HP", 3);
    expect(r.engine).toBe("hybrid");
    expect(r.ranking[0].layanan).toBe("dbt|Antares Eazy");
    expect(r.items[0]).toMatchObject({ jenis_layanan: "Antares Eazy", qty: 10, sumber: "REKOMENDASI AI" });
    expect(r.items[0].product_id).toBeGreaterThan(0);
    expect(r.items[0].price_version_id).toBeGreaterThan(0);
    expect(r.items.every(i => i.kecocokan >= 30 && i.kecocokan <= 99)).toBe(true);
  });
  test("bandwidth eksplisit dipakai memilih produk", () => {
    const r = reco.analyzeNeed("Kantor pusat butuh Astinet 100 Mbps internet dedicated dengan IP publik", 1);
    expect(r.items[0].nama).toMatch(/100 Mbps/);
  });
  test("budget: memilih di bawah pagu atau memberi catatan alternatif terhemat", () => {
    const r = reco.analyzeNeed("Kantor pusat butuh Astinet internet dedicated", 1, 1000);
    expect(r.notes.join(" ")).toMatch(/Terhemat|Budget/);
    const ok = reco.analyzeNeed("Warung butuh internet bisnis murah", 1, 700000);
    expect(ok.items.every(i => i.harga <= 700000)).toBe(true);
  });
  test("teks terlalu umum -> fallback berkecocokan rendah", () => {
    const r = reco.analyzeNeed("halo", 1);
    expect(r.items).toHaveLength(1);
    expect(r.items[0].kecocokan).toBe(30);
    expect(r.notes[0]).toMatch(/terlalu umum/);
  });
  test("engine baseline (versi KP) tetap tersedia untuk pembanding", () => {
    const r = reco.analyzeNeed("pasang cctv 5 buah", 1, null, "baseline");
    expect(r.engine).toBe("baseline");
    expect(r.items.length).toBeGreaterThan(0);
  });
  test("sinyal riwayat: RAB disetujui memengaruhi rekomendasi berikutnya", async () => {
    const { makeApprovedSession } = require("./helpers");
    await makeApprovedSession(app, t, { kebutuhan: "Toko swalayan ingin pasang 10 CCTV online yang bisa dipantau lewat HP" });
    reco.invalidate();
    expect(reco.loadHistory().length).toBeGreaterThanOrEqual(1);
    const r = reco.analyzeNeed("Toko swalayan baru butuh CCTV online dipantau lewat HP", 1);
    expect(r.ranking[0].riwayat).toBeGreaterThan(0);
  });
  test("master data nonaktif tidak direkomendasikan", () => {
    db.prepare("UPDATE master_products SET is_active = 0 WHERE layanan = 'PIJAR Sekolah'").run();
    reco.invalidate();
    const r = reco.analyzeNeed("SMA swasta ingin aplikasi sekolah rapor digital", 1);
    expect(r.items.every(i => i.jenis_layanan !== "PIJAR Sekolah")).toBe(true);
    db.prepare("UPDATE master_products SET is_active = 1 WHERE layanan = 'PIJAR Sekolah'").run();
    reco.invalidate();
  });
  test("endpoint analyze menyimpan engine & ranking", async () => {
    const c = await request(app).post("/api/sessions").set(auth(t.sales)).send({ nama_pelanggan: "PT R", kebutuhan: "Hotel butuh wifi managed untuk tamu" });
    const a = await request(app).post(`/api/sessions/${c.body.session.id}/analyze`).set(auth(t.sales)).send({});
    expect(a.body.engine).toBe("hybrid");
    expect(a.body.ranking.length).toBeGreaterThan(0);
    expect(db.prepare("SELECT recommender_engine e FROM sessions WHERE id=?").get(c.body.session.id).e).toBe("hybrid");
  });
});
