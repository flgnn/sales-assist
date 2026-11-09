const db = require("../db/db");

// Kamus pengetahuan Master Data (HSI, WiFi, Datin, DBT, hardware & layanan)
const MASTER_KNOWLEDGE_MAP = [
  // HSI & Variannya
  { keys: ["hsi 1s", "1s", "hsi internet saja"], sheet: "hsi", layanan: "1S", ref: "HSI • 1S" },
  { keys: ["hsi 2s", "2s", "hsi voice", "hsi + voice"], sheet: "hsi", layanan: "2S", paketLike: "%Voice%", ref: "HSI • 2S" },
  { keys: ["hsi netmonk", "netmonk", "router monitoring"], sheet: "hsi", layanan: "2S", paketLike: "%Netmonk%", ref: "HSI • 2S" },
  { keys: ["hsi oca", "oca", "call center oca"], sheet: "hsi", layanan: "2S", paketLike: "%OCA%", ref: "HSI • 2S" },
  { keys: ["hsi pijar", "pijar sekolah hsi"], sheet: "hsi", layanan: "2S", paketLike: "%PIJAR%", ref: "HSI • 2S" },
  { keys: ["hsi eazy indoor cam", "hsi cctv", "eazy indoor cam"], sheet: "hsi", layanan: "2S", paketLike: "%Eazy Indoor Cam%", ref: "HSI • 2S" },
  { keys: ["hsi iptv", "iptv"], sheet: "hsi", layanan: "2S", paketLike: "%IPTV%", ref: "HSI • 2S" },
  { keys: ["hsi mesh wifi", "mesh wifi", "mesh"], sheet: "hsi", layanan: "2S", paketLike: "%Mesh Wifi%", ref: "HSI • 2S" },
  { keys: ["hsi 3s", "3s", "hsi iptv voice"], sheet: "hsi", layanan: "3S", ref: "HSI • 3S" },
  {
    keys: [
      "hsi", "hsi bisnis", "hsi basic", "indihome bisnis", "broadband", "broadband internet", "internet cepat", "koneksi internet cepat",
      "internet murah", "wifi murah", "sharing internet", "internet", "koneksi", "cepat", "kecepatan", "pasang wifi baru",
      "pasang internet", "paket wifi", "indihome", "warkop", "rumahan", "ruko", "kantor kecil", "langganan internet",
      "akses internet", "paket hemat", "internet standar", "koneksi standar"
    ], sheet: "hsi", ref: "HSI Bisnis"
  },

  // WiFi Managed (WMS)
  { keys: ["wms standar", "wms silver", "wms gold", "wms platinum"], sheet: "wifi", layanan: "WMS Standar", ref: "Wifi Managed (WMS)" },
  { keys: ["wms fit", "wms fit gold"], sheet: "wifi", layanan: "WMS Fit", ref: "Wifi Managed (WMS)" },
  { keys: ["wms lite", "wms silver lite"], sheet: "wifi", layanan: "WMS Lite", ref: "Wifi Managed (WMS)" },
  { keys: ["wms gamer", "gamer"], sheet: "wifi", layanan: "WMS Gamer", ref: "Wifi Managed (WMS)" },
  { keys: ["wms x iot", "wms iot"], sheet: "wifi", layanan: "WMS x IoT", ref: "Wifi Managed (WMS)" },
  { keys: ["wms reseller", "voucher reseller", "wms voucher"], sheet: "wifi", layanan: "WMS Reseller", ref: "Wifi Managed (WMS)" },
  {
    keys: [
      "wifi", "access point", "hotspot", "wms", "wireless", "managed wifi", "wifi managed", "wifi voucher", "voucher wifi",
      "wifi dengan login", "wifi pake voucher", "wifi gratis", "hotspot cafe", "wifi sekolah", "tamu bisa login", "landing page",
      "portal login", "wifi ramai", "wifi restoran", "banyak user", "wifi publik", "banyak handphone", "akses point"
    ], sheet: "wifi", ref: "Wifi Managed (WMS)"
  },

  // Datin (Astinet / Metro-E / IP Transit / NeuCentrIX)
  {
    keys: [
      "astinet reguler", "astinet dedicated", "astinet", "dedicated internet", "internet dedicated", "dedicated", "premium internet",
      "ip publik", "ip public", "ip statis", "simetris", "uptime tinggi", "internet anti putus", "koneksi stabil", "upload cepat",
      "download upload sama", "internet untuk server", "internet korporat", "internet kantor pusat", "unlimited murni",
      "koneksi premium", "internet cepat sekali", "stabil tanpa lag", "anti lemot", "unbk", "ujian online", "kantor besar", "corporate internet"
    ], sheet: "datin", layanan: "Astinet", ref: "Datin • Astinet"
  },
  { keys: ["astinet fit"], sheet: "datin", layanan: "Astinet", ref: "Datin • Astinet" },
  { keys: ["astinet lite"], sheet: "datin", layanan: "Astinet", ref: "Datin • Astinet" },
  {
    keys: [
      "metro-e", "metro ethernet", "metro", "vpn", "sdwan", "sd-wan", "leased line", "private network", "point to point",
      "point to multipoint", "koneksi antar cabang", "koneksi kantor cabang", "koneksi cabang", "koneksi antar kantor", "jaringan data",
      "hubungkan kantor cabang", "koneksi antar ruko", "kirim data antar kantor", "jaringan private", "intranet", "koneksi server ke cabang",
      "vpn kantor", "sambung database", "tarik data antar cabang", "jaringan tertutup", "jaringan aman", "antar gedung", "koneksi lokal", "lokal link"
    ], sheet: "datin", layanan: "Metro-E", ref: "Datin • Metro-E"
  },
  { keys: ["ip transit", "wholesale internet", "isp uplink", "uplink global"], sheet: "datin", layanan: "IP Transit", ref: "Datin • IP Transit" },
  { keys: ["neucentrix", "ip transit neucentrix", "metro-e neucentix", "neucentrix"], sheet: "datin", layananLike: "%NeuCentrIX%", ref: "Datin • NeuCentrIX" },

  // Digital Business (DBT: CCTV, Antares Eazy, Pijar Sekolah)
  {
    keys: [
      "cctv", "ip camera", "camera", "eazycam", "eazy k5", "nvr", "dvr", "kamera", "kamera pengawas", "security camera",
      "pasang kamera", "pantau toko", "rekaman cctv", "keamanan kantor", "cctv online", "kamera pintar", "pantau lewat hp", "kamera keamanan", "cctv cafe"
    ], sheet: "dbt", layanan: "Antares Eazy", ref: "DBT • Antares Eazy"
  },
  { keys: ["cloud recording", "cloud storage cctv", "cloud cctv"], sheet: "dbt", layanan: "Cloud Antares Eazy", ref: "DBT • Cloud Antares Eazy" },
  { keys: ["ai cctv", "ai analytic", "people counting", "smoke detection", "intrusion detection", "video analytic", "employee absence"], sheet: "dbt", layanan: "AI Antares Eazy", ref: "DBT • AI Antares Eazy" },
  {
    keys: [
      "pijar sekolah", "pijar", "aplikasi sekolah", "lms sekolah", "e-learning", "platform edukasi", "belajar online", "rapor digital",
      "absensi siswa", "tugas online", "portal guru", "pembelajaran digital", "software sekolah", "ujian sekolah"
    ], sheet: "dbt", layanan: "PIJAR Sekolah", ref: "DBT • PIJAR Sekolah"
  },
  { keys: ["cloud", "server", "storage", "nas"], sheet: "dbt", layanan: "Cloud Antares Eazy", ref: "DBT • Cloud Storage" },
  { keys: ["voice", "pabx", "call center", "telepon"], sheet: "hsi", layanan: "2S", paketLike: "%Voice%", ref: "HSI • 2S" },
  { keys: ["switch", "router", "firewall"], sheet: "hsi", layanan: "2S", paketLike: "%Netmonk%", ref: "HSI • Netmonk" },
  { keys: ["iot", "sensor"], sheet: "dbt", layanan: "AI Antares Eazy", ref: "DBT • AI Antares Eazy" }
];

function extractKeywords(text) {
  const t = (text || "").toLowerCase();
  const found = [];

  MASTER_KNOWLEDGE_MAP.forEach(rule => {
    rule.keys.forEach(k => {
      if (t.includes(k)) {
        const displayKeyword = rule.layanan || rule.ref || k.toUpperCase();
        if (!found.includes(displayKeyword)) {
          found.push(displayKeyword);
        }
      }
    });
  });

  if (!found.length) {
    if (t.includes("internet") || t.includes("koneksi")) found.push("HSI / Internet");
    else found.push("Umum");
  }

  return found;
}

function inferPsbFallback(item) {
  if (!item || item.psb > 0) return item ? item.psb : 0;
  if (item.sheet === "datin") {
    if (/Metro-E/i.test(item.layanan)) return 150000;
    if (/IP Transit/i.test(item.layanan)) return 150000;
  }
  return 0;
}

/**
 * AI Matcher Engine:
 * Pengetahuan Master Data otomatis terindeks secara dinamis dari database `master_products`.
 * Semua pencarian keyword langsung mensinkronkan dan mengambil data asli dari Master Data.
 */
function analyzeNeed(text, cabangNum, targetBudget = null) {
  const keywords = extractKeywords(text);
  const t = (text || "").toLowerCase();
  const cabang = Math.max(1, cabangNum || 1);
  const notes = [];
  const items = [];
  const addedProductIds = new Set();

  // Deteksi periode dari kata kunci prompt
  let detectedPeriode = "Bulanan";
  if (
    t.includes("sekali bayar") ||
    t.includes("otc") ||
    t.includes("one time charge") ||
    t.includes("one-time") ||
    t.includes("beli putus") ||
    t.includes("non-sewa") ||
    t.includes("otc cctv")
  ) {
    detectedPeriode = "Sekali bayar";
  }

  // Extract explicit quantity mentions from the free-text kebutuhan, e.g. "20 cctv", "5 kamera", "20 buah cctv" or "cctv 20"
  const explicitQty = {}; // map sheet -> qty
  const explicitUnit = {}; // map sheet -> detected unit word (buah/pcs/unit/etc)
  // helper: parse simple Indonesian written numbers (satu, dua puluh, seratus, dll.)
  function wordsToNumber(str) {
    if (!str) return NaN;
    str = String(str).toLowerCase().replace(/-/g, ' ').replace(/\band\b/g, ' ').trim();
    const units = { nol: 0, satu: 1, se: 1, dua: 2, tiga: 3, empat: 4, lima: 5, enam: 6, tujuh: 7, delapan: 8, sembilan: 9 };
    const specials = { sepuluh: 10, sebelas: 11, seratus: 100, seribu: 1000 };
    let total = 0, current = 0;
    const parts = str.split(/\s+/);
    for (let i = 0; i < parts.length; i++) {
      const w = parts[i];
      if (specials[w] != null) { current += specials[w]; continue; }
      if (w === 'belas') { current = (current || 0) + 10; continue; }
      if (w === 'puluh') { current = (current || 1) * 10; continue; }
      if (w === 'ratus') { current = (current || 1) * 100; continue; }
      if (w === 'ribu') { current = (current || 1) * 1000; total += current; current = 0; continue; }
      if (units[w] != null) { current += units[w]; continue; }
      // try to strip common suffixes like 'nya'
      const w2 = w.replace(/nya$/, '');
      if (units[w2] != null) { current += units[w2]; continue; }
    }
    total += current;
    return total || NaN;
  }
  // common unit words that may appear between number and term
  const unitWords = ["buah", "unit", "pcs", "pc", "unitnya", "buahnya", "item", "titik", "lokasi", "site"];
  const unitPattern = `(?:${unitWords.join("|")}|x|×)?`;
  const wordsList = ["nol", "satu", "se", "dua", "tiga", "empat", "lima", "enam", "tujuh", "delapan", "sembilan", "sepuluh", "sebelas", "belas", "puluh", "ratus", "ribu", "seratus", "seribu"];
  const wordsPattern = wordsList.join("|");

  // Generic detector: given a list of terms (keywords), find an explicit quantity
  // mentioned near any of those terms anywhere in the free-text kebutuhan.
  // Supports "20 cctv", "20 buah cctv", "cctv 20", "cctv sebanyak 20",
  // numbered-list style entries like "1. Astinet 20 Mbps - 5" and simple
  // Indonesian number words ("dua puluh cctv").
  function escapeRegex(str) {
    return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function findExplicitQtyForTerms(qtyText, terms) {
    const alt = terms.map(term => escapeRegex(term).replace(/ /g, "\\s+"));
    const altGroup = alt.join("|");

    // 1) number [x|unitWords]? term  e.g. "20 x cctv", "20 buah cctv"
    let re = new RegExp("(\\d+)\\s*(?:" + unitPattern + ")?\\s*(?:" + altGroup + ")", "i");
    let m = qtyText.match(re);
    if (m && m[1]) {
      const n = parseInt(m[1].replace(/[^0-9]/g, ""), 10);
      if (!isNaN(n) && n > 0) {
        let unit = null;
        const uMatch = m[0].match(new RegExp("(?:" + unitWords.join("|") + ")", "i"));
        if (uMatch) unit = uMatch[0];
        return { qty: n, unit };
      }
    }

    // 2) term [sejumlah|sebanyak|:|-]? number  e.g. "cctv 20", "cctv sebanyak 20", "1. cctv - 20"
    re = new RegExp("(?:" + altGroup + ")\\s*(?:sejumlah|sebanyak|:|-)?\\s*(\\d+)", "i");
    m = qtyText.match(re);
    if (m && m[1]) {
      const n = parseInt(m[1].replace(/[^0-9]/g, ""), 10);
      if (!isNaN(n) && n > 0) return { qty: n, unit: null };
    }

    // 3) written-number words before term, e.g. "dua puluh cctv" or "dua puluh buah cctv"
    re = new RegExp("((?:" + wordsPattern + ")(?:\\s+(?:" + wordsPattern + "))*)\\s*(?:" + unitPattern + ")?\\s*(?:" + altGroup + ")", "i");
    m = qtyText.match(re);
    if (m && m[1]) {
      const parsed = wordsToNumber(m[1]);
      if (!isNaN(parsed) && parsed > 0) {
        let unit = null;
        const uMatch = m[0].match(new RegExp("(?:" + unitWords.join("|") + ")", "i"));
        if (uMatch) unit = uMatch[0];
        return { qty: parsed, unit };
      }
    }

    return null;
  }

  // Per-sheet quantities (kept for backward-compat notes / fallback), plus
  // per-rule quantities so every product line in the MASTER_KNOWLEDGE_MAP —
  // not just cctv/wifi/hsi — picks up the number the user wrote next to it.
  const ruleQty = new Map(); // rule -> { qty, unit }
  try {
    const qtyText = String(text || "").toLowerCase();
    const sheetTerms = {
      dbt: ["cctv", "camera", "kamera", "ip camera", "ipcam", "nvr"],
      wifi: ["wifi", "access point", "ap", "hotspot"],
      hsi: ["ont", "modem", "router", "indihome"]
    };

    Object.entries(sheetTerms).forEach(([sheet, terms]) => {
      try {
        const found = findExplicitQtyForTerms(qtyText, terms);
        if (found) {
          explicitQty[sheet] = found.qty;
          if (found.unit) explicitUnit[sheet] = found.unit;
        }
      } catch (e) {
        // ignore
      }
    });

    MASTER_KNOWLEDGE_MAP.forEach(rule => {
      try {
        const found = findExplicitQtyForTerms(qtyText, rule.keys);
        if (found) ruleQty.set(rule, found);
      } catch (e) {
        // ignore a single malformed rule and keep detecting the rest
      }
    });
  } catch (e) {
    // ignore parsing errors
  }

  function addProductToItems(prod, customRef = null, customSatuan = null, customQty = null) {
    if (!prod || addedProductIds.has(prod.id)) return;
    addedProductIds.add(prod.id);

    let displayName = "";
    if (prod.sheet === "hsi") {
      displayName = `${prod.paket} (${prod.layanan}) ${prod.mbps ? prod.mbps + " Mbps" : ""}`.trim();
    } else if (prod.sheet === "wifi") {
      displayName = `${prod.layanan} — ${prod.paket} (${prod.mbps} Mbps)`;
    } else if (prod.sheet === "datin") {
      displayName = `${prod.layanan} ${prod.mbps ? prod.mbps + " Mbps" : ""} ${prod.paket} (${prod.lokasi || "Jawa"})`.trim();
    } else {
      // dbt
      displayName = `${prod.paket} (${prod.layanan})`;
    }

    const itemRef = customRef || (prod.sheet === "wifi" ? "Wifi Managed (WMS)" : `${prod.sheet.toUpperCase()} • ${prod.layanan}`);

    // Priority for qty: number typed right next to this exact product (customQty)
    // > number typed near this product's sheet category (explicitQty) > branch count (cabang).
    // This is what makes "1, 2, 3, ... n" written alongside a product in the
    // kebutuhan text land directly in QTY instead of always defaulting to cabang.
    const resolvedQty = (customQty && customQty > 0)
      ? customQty
      : ((explicitQty[prod.sheet] && explicitQty[prod.sheet] > 0) ? explicitQty[prod.sheet] : cabang);
    // If a unit word was detected, map it to a sensible satuan
    let resolvedSatuan = customSatuan || prod.satuan_hint || "unit";
    try {
      if (explicitUnit[prod.sheet]) {
        const u = String(explicitUnit[prod.sheet]).toLowerCase();
        if (/(buah|pcs|pc)/i.test(u)) resolvedSatuan = "buah";
        else if (/(unit|site|lokasi|titik)/i.test(u)) resolvedSatuan = "unit";
      }
    } catch (e) { }

    items.push({
      id: prod.id,
      nama: displayName,
      sumber: "REKOMENDASI AI",
      harga: prod.harga || 0,
      psb: prod.psb || inferPsbFallback(prod),
      satuan: resolvedSatuan,
      qty: resolvedQty,
      periode: detectedPeriode,
      ref: itemRef,
      kategori: prod.sheet === "wifi" ? "WMS" : prod.sheet.toUpperCase(),
      jenis_layanan: prod.layanan,
      kecocokan: 95,
      reasoning: inferReasoning(prod.sheet, prod.layanan)
    });
  }

  // Hitung jumlah kategori unik yang cocok untuk pembagian budget
  const matchedSheets = new Set();
  MASTER_KNOWLEDGE_MAP.forEach(rule => {
    const matched = rule.keys.some(k => t.includes(k));
    if (matched && rule.sheet) {
      matchedSheets.add(rule.sheet);
    }
  });
  const numSheets = Math.max(1, matchedSheets.size);

  // Lakukan penjelajahan langsung terhadap MASTER_KNOWLEDGE_MAP
  let alternatifTerhematAdded = false;
  MASTER_KNOWLEDGE_MAP.forEach(rule => {
    const matched = rule.keys.some(k => t.includes(k));
    if (matched) {
      let sql = `SELECT * FROM master_products WHERE 1=1`;
      const params = [];

      if (rule.sheet) { sql += ` AND sheet = ?`; params.push(rule.sheet); }
      if (rule.layanan) { sql += ` AND layanan = ?`; params.push(rule.layanan); }
      if (rule.layananLike) { sql += ` AND layanan LIKE ?`; params.push(rule.layananLike); }
      if (rule.paketLike) { sql += ` AND paket LIKE ?`; params.push(rule.paketLike); }

      let budgetSql = sql;
      let budgetParams = [...params];
      if (targetBudget && targetBudget > 0) {
        const budgetLimitPerSheet = targetBudget / numSheets;
        const maxPrice = budgetLimitPerSheet / cabang;
        budgetSql += ` AND harga <= ?`;
        budgetParams.push(maxPrice);
        budgetSql += ` ORDER BY harga DESC, mbps DESC LIMIT 2`;
      } else {
        budgetSql += ` ORDER BY harga ASC, mbps ASC LIMIT 2`;
      }

      let rows = db.prepare(budgetSql).all(...budgetParams);

      // Fallback jika tidak ada produk yang cocok dengan budget
      if (!rows.length && targetBudget && targetBudget > 0) {
        const fallbackSql = sql + ` ORDER BY harga ASC LIMIT 1`;
        rows = db.prepare(fallbackSql).all(...params);
        if (rows.length) {
          notes.push(`Alternatif Terhemat: Produk "${rows[0].paket}" dipilih sebagai alternatif terbaik yang paling mendekati target budget.`);
          alternatifTerhematAdded = true;
        }
      }

      if (rows.length) {
        const foundQty = ruleQty.get(rule);
        rows.forEach(r => addProductToItems(r, rule.ref, null, foundQty ? foundQty.qty : null));
      }
    }
  });

  // Jika belum ada item yang cocok (misalnya prompt terlalu umum), berikan produk standar dari HSI / WMS / Astinet
  if (!items.length) {
    let wifiSql = `SELECT * FROM master_products WHERE sheet = 'wifi' AND layanan = 'WMS Standar'`;
    let wifiParams = [];
    if (targetBudget && targetBudget > 0) {
      wifiSql += ` AND harga <= ?`;
      wifiParams.push(targetBudget / cabang);
    }
    wifiSql += ` ORDER BY harga DESC LIMIT 1`;
    let defaultWifi = db.prepare(wifiSql).get(...wifiParams);
    if (!defaultWifi && targetBudget && targetBudget > 0) {
      defaultWifi = db.prepare(`SELECT * FROM master_products WHERE sheet = 'wifi' AND layanan = 'WMS Standar' ORDER BY harga ASC LIMIT 1`).get();
    }
    if (defaultWifi) addProductToItems(defaultWifi);

    let hsiSql = `SELECT * FROM master_products WHERE sheet = 'hsi' AND layanan = '1S'`;
    let hsiParams = [];
    if (targetBudget && targetBudget > 0) {
      hsiSql += ` AND harga <= ?`;
      hsiParams.push(targetBudget / cabang);
    }
    hsiSql += ` ORDER BY harga DESC LIMIT 1`;
    let defaultHsi = db.prepare(hsiSql).get(...hsiParams);
    if (!defaultHsi && targetBudget && targetBudget > 0) {
      defaultHsi = db.prepare(`SELECT * FROM master_products WHERE sheet = 'hsi' AND layanan = '1S' ORDER BY harga ASC LIMIT 1`).get();
    }
    if (defaultHsi) addProductToItems(defaultHsi);
  }

  // Evaluasi budget & catatan
  if (targetBudget && targetBudget > 0) {
    const totalEst = items.reduce((s, it) => s + (it.harga * it.qty), 0);
    if (totalEst > targetBudget) {
      if (!alternatifTerhematAdded && items.length) {
        const termurah = items.reduce((min, it) => (it.harga < min.harga ? it : min), items[0]);
        notes.push(`Alternatif Terhemat: Produk "${termurah.nama}" dipilih sebagai alternatif terbaik yang paling mendekati target budget.`);
      }
      notes.push(`Penyesuaian Budget: Total estimasi penawaran idealnya (Rp ${totalEst.toLocaleString('id-ID')} per bulan), dibandingkan dengan budget pelanggan (Rp ${Number(targetBudget).toLocaleString('id-ID')} per bulan).`);
    }
  }

  return { keywords, notes, items };
}

function inferReasoning(sheet, layanan) {
  if (sheet === "hsi") {
    return "Internet broadband ekonomis dan cepat untuk operasional bisnis harian.";
  }
  if (sheet === "wifi") {
    return "WiFi terkelola profesional untuk kemudahan akses internet karyawan & tamu/pelanggan.";
  }
  if (sheet === "datin") {
    if (layanan === "Astinet") {
      return "Internet dedicated simetris dengan SLA tinggi untuk kestabilan bisnis & server.";
    }
    if (layanan === "Metro-E") {
      return "Jaringan data private aman untuk menghubungkan antar kantor cabang.";
    }
    return "Layanan konektivitas data korporasi berkapasitas besar dan handal.";
  }
  if (sheet === "dbt") {
    if (layanan === "Antares Eazy") {
      return "Kamera pengawas pintar dengan perekaman berbasis cloud untuk keamanan 24 jam.";
    }
    if (layanan === "PIJAR Sekolah") {
      return "Platform pembelajaran digital (LMS) dan manajemen administrasi sekolah.";
    }
    return "Solusi bisnis digital Telkom untuk mendukung efisiensi operasional.";
  }
  return "Rekomendasi solusi internet sesuai dengan profil kebutuhan pelanggan.";
}

module.exports = { extractKeywords, analyzeNeed };
