const express = require("express");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const { OAuth2Client } = require("google-auth-library");
const db = require("../db/db");
const { signToken } = require("../middleware/auth");

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function publicUser(user) {
  return { id: user.id, username: user.username, name: user.name, role: user.role, witel: user.witel, email: user.email || null };
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function randomPlaceholderPassword() {
  // Dipakai untuk akun yang dibuat via OTP/Google (tanpa password manual).
  // Nilainya acak & tidak pernah diberitahukan, jadi tidak bisa dipakai untuk login username/password.
  return bcrypt.hashSync(crypto.randomBytes(24).toString("hex"), 10);
}

function findOrCreateUserByEmail(email, name) {
  let user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
  if (user) return user;

  const baseUsername = email.split("@")[0].replace(/[^a-z0-9._-]/gi, "").toLowerCase().slice(0, 24) || "user";
  let candidate = baseUsername;
  let suffix = 0;
  while (db.prepare("SELECT id FROM users WHERE username = ?").get(candidate)) {
    suffix += 1;
    candidate = `${baseUsername}${suffix}`;
  }

  const info = db.prepare(`
    INSERT INTO users (username, password, name, role, witel, email)
    VALUES (?, ?, ?, 'sales', ?, ?)
  `).run(candidate, randomPlaceholderPassword(), name || baseUsername, "Witel Priangan Timur", email);

  return db.prepare("SELECT * FROM users WHERE id = ?").get(info.lastInsertRowid);
}

// POST /api/auth/login
router.post("/login", (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: "username dan password wajib diisi." });
  }
  const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: "Username atau password salah." });
  }
  const token = signToken(user);
  res.json({ token, user: publicUser(user) });
});

// POST /api/auth/register
router.post("/register", (req, res) => {
  const { username, password, name, witel, email } = req.body || {};
  if (!username || !password || !name) {
    return res.status(400).json({ error: "Nama, username, dan password wajib diisi." });
  }
  const cleanUsername = String(username).trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,32}$/.test(cleanUsername)) {
    return res.status(400).json({ error: "Username 3-32 karakter, hanya huruf, angka, titik, garis bawah, atau strip." });
  }
  if (String(password).length < 6) {
    return res.status(400).json({ error: "Password minimal 6 karakter." });
  }

  let cleanEmail = null;
  if (email && String(email).trim()) {
    cleanEmail = normalizeEmail(email);
    if (!EMAIL_RE.test(cleanEmail)) {
      return res.status(400).json({ error: "Format email tidak valid." });
    }
    const emailTaken = db.prepare("SELECT id FROM users WHERE email = ?").get(cleanEmail);
    if (emailTaken) {
      return res.status(409).json({ error: "Email sudah terdaftar di akun lain." });
    }
  }

  const exists = db.prepare("SELECT id FROM users WHERE username = ?").get(cleanUsername);
  if (exists) {
    return res.status(409).json({ error: "Username sudah dipakai. Coba username lain." });
  }

  const hash = bcrypt.hashSync(password, 10);
  const info = db.prepare(`
    INSERT INTO users (username, password, name, role, witel, email)
    VALUES (?, ?, ?, 'sales', ?, ?)
  `).run(cleanUsername, hash, String(name).trim(), (witel && String(witel).trim()) || "Witel Priangan Timur", cleanEmail);

  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(info.lastInsertRowid);
  const token = signToken(user);
  res.status(201).json({ token, user: publicUser(user) });
});

// OTP endpoints removed — project no longer supports email OTP login.

// GET /api/auth/google/config — beri tahu frontend apakah Google Sign-In tersedia
router.get("/google/config", (req, res) => {
  res.json({ enabled: !!process.env.GOOGLE_CLIENT_ID, clientId: process.env.GOOGLE_CLIENT_ID || null });
});

// POST /api/auth/google — login/daftar pakai akun Google (Google Identity Services ID token)
router.post("/google", async (req, res) => {
  const { credential } = req.body || {};
  if (!credential) {
    return res.status(400).json({ error: "Token Google tidak ditemukan." });
  }
  if (!process.env.GOOGLE_CLIENT_ID) {
    return res.status(501).json({ error: "Login Google belum dikonfigurasi di server (GOOGLE_CLIENT_ID belum di-set)." });
  }

  try {
    const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
    const ticket = await client.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID
    });
    const payload = ticket.getPayload();
    if (!payload || !payload.email) {
      return res.status(401).json({ error: "Token Google tidak valid." });
    }
    if (!payload.email_verified) {
      return res.status(401).json({ error: "Email Google Anda belum terverifikasi." });
    }

    const email = normalizeEmail(payload.email);
    let user = db.prepare("SELECT * FROM users WHERE google_id = ?").get(payload.sub);
    if (!user) {
      user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
      if (user) {
        db.prepare("UPDATE users SET google_id = ? WHERE id = ?").run(payload.sub, user.id);
        user = db.prepare("SELECT * FROM users WHERE id = ?").get(user.id);
      }
    }
    if (!user) {
      const baseUsername = email.split("@")[0].replace(/[^a-z0-9._-]/gi, "").toLowerCase().slice(0, 24) || "user";
      let candidate = baseUsername;
      let suffix = 0;
      while (db.prepare("SELECT id FROM users WHERE username = ?").get(candidate)) {
        suffix += 1;
        candidate = `${baseUsername}${suffix}`;
      }
      const info = db.prepare(`
        INSERT INTO users (username, password, name, role, witel, email, google_id)
        VALUES (?, ?, ?, 'sales', ?, ?, ?)
      `).run(candidate, randomPlaceholderPassword(), payload.name || baseUsername, "Witel Priangan Timur", email, payload.sub);
      user = db.prepare("SELECT * FROM users WHERE id = ?").get(info.lastInsertRowid);
    }

    const token = signToken(user);
    res.json({ token, user: publicUser(user) });
  } catch (err) {
    console.error("[auth/google] verifikasi gagal:", err.message);
    res.status(401).json({ error: "Verifikasi login Google gagal. Coba lagi." });
  }
});

module.exports = router;
