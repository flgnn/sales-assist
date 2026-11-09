require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const path = require("path");

const authRoutes = require("./routes/auth");
const masterDataRoutes = require("./routes/masterData");
const sessionsRoutes = require("./routes/sessions");
const approvalsRoutes = require("./routes/approvals");
const pipelineRoutes = require("./routes/pipeline");
const auditRoutes = require("./routes/audit");
const usersRoutes = require("./routes/users");

function parseOrigins() {
  return (process.env.CORS_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);
}

function createApp() {
  const app = express();
  const isTest = process.env.NODE_ENV === "test";
  app.set("trust proxy", process.env.TRUST_PROXY ? Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY : false);
  app.disable("x-powered-by");

  // Header keamanan (helmet). CSP mengizinkan Google Identity Services dan Google Fonts yang dipakai antarmuka.
  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "script-src": ["'self'", "https://accounts.google.com"],
        "frame-src": ["'self'", "https://accounts.google.com"],
        "connect-src": ["'self'", "https://accounts.google.com"],
        "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://accounts.google.com"],
        "font-src": ["'self'", "https://fonts.gstatic.com"],
        "img-src": ["'self'", "data:", "https://*.googleusercontent.com"],
        "object-src": ["'self'"],            // pratinjau PDF penawaran
        "frame-ancestors": ["'self'"],
        "upgrade-insecure-requests": null
      }
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "same-site" }
  }));

  // CORS whitelist: tanpa CORS_ORIGINS hanya same-origin (tidak ada header CORS). Tidak pernah "*".
  const origins = parseOrigins();
  app.use(cors({
    origin(origin, cb) {
      if (!origin) return cb(null, true);          // curl / same-origin tanpa header Origin
      return cb(null, origins.includes(origin));
    },
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"]
  }));

  // Pembatasan laju. Dimatikan saat uji otomatis kecuali RATE_LIMIT_FORCE=1.
  const skip = () => isTest && process.env.RATE_LIMIT_FORCE !== "1";
  const apiLimiter = rateLimit({
    windowMs: 60 * 1000, limit: Number(process.env.RATE_LIMIT_MAX) || 600, standardHeaders: "draft-7", legacyHeaders: false, skip,
    message: { error: "Terlalu banyak permintaan. Coba lagi sebentar lagi." }
  });
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, limit: Number(process.env.AUTH_RATE_LIMIT_MAX) || 20, standardHeaders: "draft-7", legacyHeaders: false, skip,
    message: { error: "Terlalu banyak percobaan login. Coba lagi dalam beberapa menit." }
  });
  const logLimiter = rateLimit({ windowMs: 60 * 1000, limit: 10, standardHeaders: "draft-7", legacyHeaders: false, skip });

  app.use(express.json({ limit: "1mb" }));
  app.use(express.static(path.join(__dirname, "..", "public")));

  app.get("/api/health", (req, res) => {
    res.json({ ok: true, service: "sales-assist-backend", version: require("../package.json").version, time: new Date().toISOString() });
  });

  // Log galat frontend: dibatasi laju & ukuran agar tidak bisa dipakai membanjiri log server.
  app.post("/api/log-error", logLimiter, (req, res) => {
    const b = req.body || {};
    console.error("[FRONTEND ERROR]:", JSON.stringify({ msg: String(b.msg || "").slice(0, 300), url: String(b.url || "").slice(0, 200), lineNo: b.lineNo, stack: String(b.stack || "").slice(0, 800) }));
    res.sendStatus(204);
  });

  app.use("/api", apiLimiter);
  app.use("/api/auth/login", authLimiter);
  app.use("/api/auth/register", authLimiter);
  app.use("/api/auth/google", authLimiter);

  app.use("/api/auth", authRoutes);
  app.use("/api/master-data", masterDataRoutes);
  app.use("/api/sessions", sessionsRoutes);
  app.use("/api/approvals", approvalsRoutes);
  app.use("/api/pipeline", pipelineRoutes);
  app.use("/api/audit", auditRoutes);
  app.use("/api/users", usersRoutes);

  app.use((req, res) => {
    res.status(404).json({ error: "Endpoint tidak ditemukan." });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err && err.type === "entity.parse.failed") return res.status(400).json({ error: "Format JSON tidak valid." });
    if (err && err.type === "entity.too.large") return res.status(413).json({ error: "Ukuran permintaan terlalu besar." });
    console.error(err);
    res.status(500).json({ error: "Terjadi kesalahan pada server." });
  });

  return app;
}

module.exports = { createApp };
