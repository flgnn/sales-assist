/**
 * Normalisasi teks bahasa Indonesia untuk mesin rekomendasi.
 *  1. huruf kecil, buang tanda baca
 *  2. pemetaan frasa/istilah ke istilah kanonis (singkatan, ejaan lain, sinonim domain)
 *  3. buang stopword
 *  4. stemming ringan (imbuhan umum) — hanya bila stem tetap >= 4 huruf
 */

// Frasa -> istilah kanonis. Frasa yang lebih panjang diproses lebih dulu.
const PHRASE_MAP = [
  ["wi-fi", "wifi"], ["wi fi", "wifi"], ["hot spot", "hotspot"], ["access point", "accesspoint"], ["akses point", "accesspoint"],
  ["point to multipoint", "p2mp"], ["point to point", "p2p"], ["multi point", "p2mp"], ["layer 2", "layer2"], ["layer dua", "layer2"],
  ["leased line", "leasedline"], ["metro ethernet", "metroe"], ["metro-e", "metroe"], ["metro e", "metroe"], ["metroe", "metroe"],
  ["dual homing", "dualhoming"], ["dual-homing", "dualhoming"], ["high availability", "redundan"], ["jalur cadangan", "redundan"],
  ["jalur redundan", "redundan"], ["dua jalur", "redundan"], ["fail over", "failover"],
  ["ip transit", "iptransit"], ["ip publik", "ippublik"], ["ip public", "ippublik"], ["ip statis", "ippublik"], ["ip static", "ippublik"],
  ["internet global", "global"], ["uplink internet", "uplink"], ["wholesale internet", "wholesale"],
  ["data center", "datacenter"], ["pusat data", "datacenter"], ["co location", "colocation"], ["co-location", "colocation"],
  ["neu centrix", "neucentrix"], ["neucentix", "neucentrix"], ["neu centix", "neucentrix"], ["neucentrix", "neucentrix"],
  ["big pipe", "bigpipe"], ["bigpipe", "bigpipe"],
  ["internet dedicated", "dedicated"], ["dedicated internet", "dedicated"], ["anti putus", "stabil"], ["tidak putus", "stabil"],
  ["tanpa lag", "stabil"], ["uptime tinggi", "stabil"],
  ["upload sama dengan download", "simetris"], ["upload sama", "simetris"], ["upload besar", "simetris"], ["download upload sama", "simetris"],
  ["internet korporat", "korporat"], ["internet premium", "korporat"], ["koneksi premium", "korporat"],
  ["antar kantor", "antarkantor"], ["antar cabang", "antarkantor"], ["antar gedung", "antarkantor"], ["antar toko", "antarkantor"],
  ["antar fakultas", "antarkantor"], ["antar lokasi", "antarkantor"], ["antar data center", "antarkantor"],
  ["kantor cabang", "cabang"], ["kantor perwakilan", "cabang"], ["jaringan private", "privat"], ["jaringan tertutup", "privat"],
  ["jaringan data", "jaringandata"], ["sambungan data", "jaringandata"], ["koneksi data", "jaringandata"], ["koneksi lokal", "jaringandata"],
  ["tanpa lewat internet publik", "privat"], ["internet publik", "internetpublik"],
  ["triple play", "tripleplay"], ["tv kabel", "iptv"], ["tv berlangganan", "iptv"], ["tayangan televisi", "iptv"], ["televisi", "iptv"],
  ["tv", "iptv"], ["usee tv", "iptv"], ["telepon rumah", "voice"], ["telepon kantor", "voice"], ["nomor telepon", "voice"], ["fixed line", "voice"],
  ["telepon", "voice"], ["telpon", "voice"], ["telp", "voice"], ["pabx", "voice"], ["extension", "voice"], ["ekstensi", "voice"],
  ["call center", "callcenter"], ["contact center", "callcenter"], ["whatsapp", "chatwa"], ["chatbot", "chatwa"],
  ["mesh wifi", "meshwifi"], ["wifi mesh", "meshwifi"], ["sinyal merata", "meshwifi"], ["dead zone", "deadzone"], ["blank spot", "deadzone"],
  ["kamera pengawas", "cctv"], ["kamera keamanan", "cctv"], ["kamera pintar", "cctv"], ["ip camera", "cctv"], ["ipcam", "cctv"],
  ["security camera", "cctv"], ["kamera", "cctv"], ["camera", "cctv"], ["eazy cam", "eazycam"], ["eazycam", "eazycam"],
  ["eazy k5", "eazyk5"], ["antares eazy", "antares"], ["pantau lewat hp", "pantaujarak"], ["pantau jarak jauh", "pantaujarak"],
  ["lewat hp", "pantaujarak"], ["lewat smartphone", "pantaujarak"], ["di smartphone", "pantaujarak"],
  ["cloud recording", "cloudrecording"], ["penyimpanan rekaman", "cloudrecording"], ["rekaman tersimpan online", "cloudrecording"],
  ["tersimpan online", "cloudrecording"], ["cloud storage", "cloudrecording"], ["rekaman cctv", "rekaman"],
  ["people counting", "peoplecounting"], ["hitung pengunjung", "peoplecounting"], ["menghitung jumlah pengunjung", "peoplecounting"],
  ["orang masuk keluar", "peoplecounting"], ["kerumunan", "crowd"], ["crowd detection", "crowd"], ["video analytic", "videoanalytic"],
  ["analitik video", "videoanalytic"], ["analytic", "videoanalytic"], ["analitik", "videoanalytic"], ["ai", "ai"],
  ["deteksi asap", "asapapi"], ["deteksi api", "asapapi"], ["smoke detection", "asapapi"], ["asap dan api", "asapapi"],
  ["deteksi penyusup", "intrusi"], ["intrusion detection", "intrusi"], ["penyusup", "intrusi"],
  ["employee absence", "absensikaryawan"], ["absensi karyawan", "absensikaryawan"], ["kendaraan keluar masuk", "kendaraan"],
  ["pijar sekolah", "pijar"], ["rapor digital", "raporsiswa"], ["absensi siswa", "raporsiswa"], ["e-learning", "elearning"], ["e learning", "elearning"],
  ["lms", "elearning"], ["belajar online", "elearning"], ["ujian online", "ujianonline"], ["ujian sekolah", "ujianonline"], ["unbk", "ujianonline"],
  ["portal guru", "portalguru"], ["tugas online", "portalguru"], ["administrasi sekolah", "adminsekolah"], ["software sekolah", "adminsekolah"],
  ["aplikasi sekolah", "adminsekolah"], ["manajemen kelas", "adminsekolah"], ["belajar mengajar", "elearning"], ["pembelajaran digital", "elearning"],
  ["rt rw net", "rtrwnet"], ["rt/rw net", "rtrwnet"], ["voucher wifi", "voucherwifi"], ["wifi voucher", "voucherwifi"], ["jual voucher", "voucherjual"],
  ["menjual voucher", "voucherjual"], ["berjualan voucher", "voucherjual"], ["wifi per jam", "voucherjual"], ["akses wifi per voucher", "voucherjual"],
  ["usaha voucher", "voucherjual"], ["bisnis reseller", "reseller"],
  ["gaming house", "gaming"], ["game online", "gaming"], ["esports", "gaming"], ["e-sports", "gaming"], ["rental playstation", "gaming"],
  ["latensi rendah", "pinglag"], ["ping stabil", "pinglag"], ["lag rendah", "pinglag"], ["ping rendah", "pinglag"],
  ["smart building", "smartbuilding"], ["internet of things", "iot"], ["industri 4.0", "iot"], ["wifi terkelola", "wifimanaged"],
  ["wifi managed", "wifimanaged"], ["managed wifi", "wifimanaged"], ["dikelola telkom", "dikelola"], ["dikelola penuh", "dikelola"],
  ["dikelola vendor", "dikelola"], ["landing page", "portalwifi"], ["portal login", "portalwifi"], ["tamu bisa login", "portalwifi"],
  ["wifi publik", "wifipublik"], ["wifi kampus", "wifipublik"], ["area tunggu", "wifipublik"], ["wifi pelanggan", "wifipelanggan"],
  ["wifi pengunjung", "wifipelanggan"], ["wifi tamu", "wifipelanggan"],
  ["internet bisnis", "hsibisnis"], ["hsi bisnis", "hsibisnis"], ["indihome bisnis", "hsibisnis"], ["internet biasa", "hsibisnis"],
  ["internet esensial", "hsibisnis"], ["internet murah", "murah"], ["harga terjangkau", "murah"], ["anggaran terbatas", "murah"],
  ["paling ekonomis", "murah"], ["paling murah", "murah"], ["harga menengah", "menengah"],
  ["tanpa tambahan", "internetsaja"], ["internet saja", "internetsaja"], ["hanya akses internet", "internetsaja"], ["cukup internet saja", "internetsaja"],
  ["tidak perlu telepon", "internetsaja"], ["tanpa telepon", "internetsaja"], ["tanpa layanan", "internetsaja"],
  ["call center oca", "callcenter"], ["oca", "callcenter"], ["netmonk", "netmonk"], ["monitoring router", "netmonk"], ["jaringan terpantau", "netmonk"],
  ["monitoring jaringan", "netmonk"], ["sekali bayar", "otc"], ["beli putus", "otc"], ["one time charge", "otc"],
  ["sistem informasi", "sisteminfo"], ["server pusat", "serverpusat"], ["database terpusat", "serverpusat"]
].sort((a, b) => b[0].length - a[0].length);

const CANONICAL = new Set(PHRASE_MAP.map(([, to]) => to));

const STOPWORDS = new Set((
  "yang dan di ke dari untuk pada dengan atau ini itu juga akan agar supaya bisa dapat sudah belum masih sangat lebih " +
  "kami kita saya anda mereka butuh membutuhkan perlu memerlukan ingin mau minta meminta pasang memasang punya ada adalah " +
  "dalam oleh serta tetapi namun karena sehingga jika bila saat ketika sebuah suatu para per setiap tiap hanya cukup " +
  "pelanggan perusahaan kantor tempat usaha layanan paket produk sambil secara tanpa lewat melalui via sistem cara " +
  "tidak tak bukan ya lah kah pun nya dua tiga empat lima satu unit buah mbps gbps mb gb bulan bulanan tahun harian"
).split(/\s+/));

// Sufiks/prefiks umum; hanya dipakai bila hasil stem >= 4 huruf.
const SUFFIXES = ["kan", "nya", "lah", "an", "i"];
const PREFIXES = ["meng", "meny", "mem", "men", "me", "ber", "ter", "di", "ke", "se", "pe", "per"];

function stem(word) {
  if (word.length < 6) return word;
  let w = word;
  for (const s of SUFFIXES) {
    if (w.endsWith(s) && w.length - s.length >= 4) { w = w.slice(0, -s.length); break; }
  }
  for (const p of PREFIXES) {
    if (w.startsWith(p) && w.length - p.length >= 4) { w = w.slice(p.length); break; }
  }
  return w;
}

function applyPhrases(text) {
  let t = ` ${text} `;
  for (const [from, to] of PHRASE_MAP) {
    const re = new RegExp(`(?<![a-z0-9])${from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z0-9])`, "g");
    t = t.replace(re, ` ${to} `);
  }
  return t;
}

/** Kembalikan array token ternormalisasi (kanonis + stem), tanpa stopword. */
function tokenize(text) {
  const lowered = String(text || "").toLowerCase().replace(/[“”"']/g, " ");
  const mapped = applyPhrases(lowered);
  const tokens = mapped
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const out = [];
  for (const tok of tokens) {
    if (/^\d+$/.test(tok)) continue;        // angka murni ditangani modul kuantitas/bandwidth
    if (STOPWORDS.has(tok)) continue;
    if (tok.length < 2) continue;
    out.push(CANONICAL.has(tok) ? tok : stem(tok));
  }
  return out;
}

module.exports = { tokenize, stem, applyPhrases, STOPWORDS, PHRASE_MAP };
