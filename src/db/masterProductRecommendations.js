function getUsageRecommendation(sheet, layanan) {
  const service = String(layanan || "").toLowerCase();

  if (sheet === "wifi") {
    if (service.includes("gamer")) return "Untuk gaming house atau individu yang membutuhkan koneksi dengan latensi sangat rendah.";
    if (service.includes("iot")) return "Untuk integrasi jaringan WiFi dengan perangkat cerdas (IoT) di lingkungan industri atau smart building.";
    if (service.includes("standar")) return "Untuk pelanggan yang ingin menyerahkan pengelolaan infrastruktur WiFi kepada Telkom agar fokus pada bisnis utama (Managed WiFi Standard).";
    if (service.includes("fit")) return "Untuk pelanggan yang ingin menyerahkan pengelolaan infrastruktur WiFi kepada Telkom agar fokus pada bisnis utama (Managed WiFi Fit).";
    if (service.includes("lite")) return "Untuk pelanggan yang ingin menyerahkan pengelolaan infrastruktur WiFi kepada Telkom agar fokus pada bisnis utama (Managed WiFi Lite).";
    return "Untuk area dengan cakupan sinyal luas seperti kafe, hotel, atau kantor guna menghilangkan dead zone melalui beberapa node.";
  }

  if (sheet === "hsi") {
    if (service === "1s") return "Untuk pelaku usaha kecil atau startup yang membutuhkan koneksi internet bisnis esensial dengan biaya lebih efisien (HSI Bisnis Basic).";
    return "Untuk UMKM menengah ke atas atau instansi yang memprioritaskan bandwidth, rasio upload/download 1:1, dan FUP sangat besar (HSI Bisnis).";
  }

  if (sheet === "datin") {
    if (service === "astinet") return "Untuk korporasi yang membutuhkan koneksi internet dedicated dengan performa tinggi dan stabilitas terjamin.";
    if (service.includes("metro-e dual")) return "Untuk perusahaan atau instansi nasional yang membutuhkan keamanan tinggi, QoS andal, high availability, dan jalur redundan.";
    if (service.includes("metro-e") && /neucentix|neucentrix/.test(service)) return "Untuk pelanggan Data Center neuCentrix yang membutuhkan paket Metro Ethernet khusus dengan enhancement Big Pipe hingga 10 Gbps.";
    if (service === "metro-e") return "Untuk jaringan data kapasitas tinggi berbasis IP/Ethernet dengan topologi P2P, P2MP, atau MP2MP.";
    if (service.includes("ip transit") && /neucentix|neucentrix/.test(service)) return "Untuk koneksi internet global dengan optimasi khusus di lokasi Data Center neuCentrix.";
    if (service.includes("ip transit")) return "Untuk ISP, carrier, atau perusahaan besar yang membutuhkan akses langsung ke backbone internet global dengan ketersediaan tinggi.";
    return "Untuk layanan konektivitas dedicated yang membutuhkan performa tinggi dan stabilitas terjamin.";
  }

  if (sheet === "dbt") {
    if (service.includes("pijar")) return "Untuk institusi pendidikan yang membutuhkan ekosistem digital lengkap untuk proses belajar mengajar.";
    if (service.includes("antares")) return "Untuk bisnis yang ingin melakukan digitalisasi melalui pemantauan jarak jauh (IPcam) dan manajemen data berbasis cloud.";
    if (service.includes("oca")) return "Untuk perusahaan yang ingin mengelola komunikasi pelanggan secara terintegrasi melalui WhatsApp, chatbot, API, dan kanal lainnya.";
    if (service.includes("bigbox")) return "Untuk perusahaan yang mengelola data dalam jumlah besar dan membutuhkan analitik untuk pengambilan keputusan strategis.";
  }

  return "Sesuai kebutuhan bisnis dan karakteristik layanan.";
}

module.exports = { getUsageRecommendation };