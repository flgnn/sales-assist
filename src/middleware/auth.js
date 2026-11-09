const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const db = require("../db/db");

let JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  if (process.env.NODE_ENV === "production") {
    // Jangan pernah jalan di production tanpa secret eksplisit.
    throw new Error(
      "JWT_SECRET belum di-set. Set environment variable JWT_SECRET sebelum menjalankan server di production."
    );
  }
  // Dev/local: generate secret acak per-proses (bukan default yang bisa ditebak).
  // Catatan: token akan invalid setiap kali server di-restart karena secret berubah.
  JWT_SECRET = crypto.randomBytes(48).toString("hex");
  console.warn(
    "[PERINGATAN] JWT_SECRET tidak di-set — menggunakan secret acak sementara untuk sesi dev ini.\n" +
    "Set environment variable JWT_SECRET untuk hasil yang konsisten antar restart, wajib sebelum deploy ke production."
  );
}

function signToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, name: user.name, role: user.role, witel: user.witel },
    JWT_SECRET,
    { expiresIn: "12h" }
  );
}

/**
 * Autentikasi JWT. Peran (role) dibaca ulang dari database pada setiap permintaan,
 * sehingga perubahan peran oleh Admin langsung berlaku tanpa menunggu token kedaluwarsa,
 * dan akun yang sudah dihapus tidak dapat memakai token lama.
 * Token lewat query string (?token=) hanya diterima untuk GET (unduhan berkas dari browser).
 */
function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  let token = null;
  if (header.startsWith("Bearer ")) token = header.slice(7);
  else if (req.method === "GET" && req.query.token) token = String(req.query.token);
  if (!token) {
    return res.status(401).json({ error: "Token tidak ditemukan. Silakan login terlebih dahulu." });
  }
  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ error: "Token tidak valid atau sudah kedaluwarsa." });
  }
  const user = db.prepare("SELECT id, username, name, role, witel, email FROM users WHERE id = ?").get(payload.id);
  if (!user) {
    return res.status(401).json({ error: "Akun tidak ditemukan. Silakan login kembali." });
  }
  req.user = user;
  next();
}
requireAuth.isAuthGuard = true;

module.exports = { signToken, requireAuth, JWT_SECRET };
