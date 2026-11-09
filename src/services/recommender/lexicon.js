/**
 * Lexicon domain per kelompok layanan (sheet|layanan).
 * Teks ini ditambahkan pada dokumen TF-IDF sebuah layanan bersama nama layanan, nama paket, dan
 * kolom rekomendasi_penggunaan dari master data. Istilah ditulis dari karakteristik produk di
 * katalog/Rekap Harga dan bahasa Sales lapangan — bukan disalin dari kasus uji.
 *
 * qtyTerms: kata benda yang biasanya diberi angka kuantitas ("10 cctv", "20 access point").
 */
const LEXICON = {
  "hsi|1S": {
    terms: "internet bisnis hsi bisnis hsi basic indihome bisnis internet saja langganan internet koneksi internet murah " +
      "umkm ruko warung toko kecil kantor kecil usaha kecil startup kasir komputer admin akses internet esensial sederhana " +
      "tanpa tambahan internetsaja hsibisnis murah broadband fiber 1s",
    qtyTerms: ["hsi", "indihome", "ont", "modem"]
  },
  "hsi|2S": {
    terms: "hsi plus layanan tambahan voice telepon netmonk monitoring router callcenter oca chatwa iptv mesh meshwifi " +
      "eazy indoor cam pijar sekolah bundling add on 2s internet dan telepon internet dan tv dua layanan extension kantor cabang " +
      "call center whatsapp",
    qtyTerms: ["hsi", "voice", "ekstensi", "mesh"]
  },
  "hsi|3S": {
    terms: "tripleplay triple play tiga layanan internet iptv voice tv telepon internet lengkap hotel kamar tamu penginapan " +
      "villa kos eksklusif televisi bundling hsi iptv voice 3s paket lengkap",
    qtyTerms: ["hsi", "kamar"]
  },
  "wifi|WMS Standar": {
    terms: "wifi managed wifimanaged dikelola telkom accesspoint banyak access point portal login wifi publik hotel mall kafe " +
      "kampus bandara coworking cakupan luas tanpa deadzone tamu pengunjung karyawan wms standar silver gold platinum titanium " +
      "diamond crown voucher login hotspot kapasitas besar pengguna bersamaan",
    qtyTerms: ["accesspoint", "wifi", "hotspot"]
  },
  "wifi|WMS Fit": {
    terms: "wms fit gold goldplus paket fit wifi terkelola harga menengah wifimanaged dikelola telkom 75 mbps toko ritel " +
      "perpustakaan kantor desa pusat kebugaran biaya terjangkau menengah",
    qtyTerms: ["accesspoint", "wifi"]
  },
  "wifi|WMS Lite": {
    terms: "wms lite silver lite silver plus lite gold lite platinum lite wifi terkelola ekonomis murah sederhana kecil " +
      "usaha kecil warung barbershop salon kedai kopi toko kelontong hotspot murah wifimanaged dikelola telkom",
    qtyTerms: ["accesspoint", "wifi", "hotspot"]
  },
  "wifi|WMS Gamer": {
    terms: "wms gamer gaming warnet game online gamer esports latensi rendah pinglag ping lag stabil turnamen playstation " +
      "rental pc gaming house koneksi gaming komunitas",
    qtyTerms: ["pc", "komputer", "wifi"]
  },
  "wifi|WMS x IoT": {
    terms: "wms iot internet of things sensor perangkat cerdas smartbuilding smart building industri pabrik mesin otomatis " +
      "gudang scanner pertanian pintar greenhouse peternakan kontrol otomatis monitoring perangkat wifi industri",
    qtyTerms: ["sensor", "perangkat", "accesspoint"]
  },
  "wifi|WMS Reseller": {
    terms: "wms reseller voucher wifi voucherwifi voucherjual jual voucher rtrwnet rt rw net warung wifi berjualan akses wifi " +
      "per jam kos penghuni bayar reseller usaha hotspot desa warga pedagang terminal pasar pengguna voucher bisnis wifi",
    qtyTerms: ["voucher"]
  },
  "datin|Astinet": {
    terms: "astinet dedicated internet dedicated simetris ippublik ip publik uptime sla stabil korporat premium server " +
      "kantor pusat data center bank perbankan pabrik besar fintech ecommerce pemda ujianonline unbk bandwidth tetap " +
      "tanpa lag upload download sama internet kantor besar astinet reguler fit lite 1000 mbps rumah sakit besar kampus akademik " +
      "media streaming",
    qtyTerms: ["astinet", "lokasi", "kantor", "site"]
  },
  "datin|IP Transit": {
    terms: "iptransit ip transit isp internet service provider uplink global wholesale carrier operator telekomunikasi " +
      "backbone peering bgp routing transit domestik global penyelenggara jasa internet akses langsung internet global " +
      "kapasitas besar pelanggan broadband",
    qtyTerms: ["iptransit", "lokasi"]
  },
  "datin|IP Transit NeuCentrIX": {
    terms: "iptransit neucentrix datacenter colocation hosting cloud provider content provider rack server lokasi data center " +
      "transit internet global optimasi neucentrix",
    qtyTerms: ["iptransit", "lokasi"]
  },
  "datin|Metro-E": {
    terms: "metroe metro ethernet metro-e leasedline p2p p2mp layer2 privat jaringan privat jaringandata antarkantor cabang " +
      "vpn point to point kantor perwakilan sambung database serverpusat sisteminfo intranet tidak lewat internet publik " +
      "bank daerah retail toko cabang pemerintah dinas hubungkan sinkron mp2mp",
    qtyTerms: ["metroe", "cabang", "lokasi", "site"]
  },
  "datin|Metro-E Dual Homing": {
    terms: "metroe dualhoming dual homing redundan failover cadangan availability ketersediaan tinggi qos handal jalur " +
      "ganda dua jalur bank nasional asuransi instansi vital pembayaran transaksi pusat data pemerintah keandalan " +
      "antarkantor jaringandata link putus",
    qtyTerms: ["metroe", "lokasi", "site"]
  },
  "datin|Metro-E NeuCentIX": {
    terms: "metroe neucentrix datacenter colocation bigpipe big pipe 10 gbps ethernet rack server antar data center " +
      "cloud provider kantor pusat link ethernet neucentrix",
    qtyTerms: ["metroe", "lokasi", "site"]
  },
  "dbt|Antares Eazy": {
    terms: "antares eazy cctv ip camera kamera eazycam eazyk5 indoor outdoor nvr dvr rekaman pantaujarak keamanan " +
      "pengawas sewa otc sekali bayar beli putus titik kamera toko gudang kos sekolah dapur kasir etalase monitoring pantau",
    qtyTerms: ["cctv", "eazycam", "eazyk5", "titik"]
  },
  "dbt|Cloud Antares Eazy": {
    terms: "cloudrecording cloud recording penyimpanan rekaman rekaman cloud storage cctv basic plus protect 7 hari 14 hari " +
      "30 hari tersimpan online tanpa nvr lokal langganan cloud rekaman aman tidak hilang antares",
    qtyTerms: ["cctv", "kamera", "channel"]
  },
  "dbt|AI Antares Eazy": {
    terms: "ai videoanalytic video analytic peoplecounting people counting asapapi deteksi asap api intrusi penyusup " +
      "absensikaryawan crowd kerumunan kendaraan kepadatan real time track in out analitik kamera pintar pengunjung " +
      "menghitung deteksi otomatis antares ai",
    qtyTerms: ["cctv", "kamera", "titik"]
  },
  "dbt|PIJAR Sekolah": {
    terms: "pijar sekolah sekolah siswa guru murid kelas raporsiswa rapor digital elearning lms ujianonline portalguru " +
      "adminsekolah pendidikan yayasan pesantren sma smp smk dinas pendidikan standalone add on bundling hsi pembelajaran digital " +
      "belajar mengajar ekosistem digital",
    qtyTerms: ["sekolah"]
  }
};

module.exports = { LEXICON };
