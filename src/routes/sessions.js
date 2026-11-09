const fs = require("fs");
const path = require("path");
const express = require("express");
const db = require("../db/db");
const { requireAuth } = require("../middleware/auth");
const { requirePermission, can } = require("../middleware/rbac");
const { validate } = require("../middleware/validate");
const { analyzeNeed } = require("../services/recommender");
const { buildRabWorkbook, computeTotals } = require("../services/excelService");
const approval = require("../services/approvalService");
const { logAudit, listAudit } = require("../services/audit");
const { buildQuotationPdf } = require("../services/quotationPdf");
const { sendQuotationEmail } = require("../services/emailService");
const pipeline = require("../services/pipelineService");

const router = express.Router();

/**
 * Akses sesi: pemilik boleh membaca & menulis; Manajer/Admin hanya boleh MEMBACA RAB orang lain.
 * Pengguna lain mendapat 404 (keberadaan RAB tidak dibocorkan).
 */
// Akses sesi: pemilik boleh membaca & menulis; Manajer/Admin hanya membaca (peninjauan).
function getSessionOr404(req, res, { write = false } = {}) {
  const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(req.params.id);
  if (session) {
    if (session.user_id === req.user.id) return session;
    if (can(req.user.role, "session:read_all")) {
      if (!write) return session;
      res.status(403).json({ error: "Hanya pemilik RAB yang dapat mengubahnya." });
      return null;
    }
  }
  res.status(404).json({ error: "Sesi tidak ditemukan." });
  return null;
}

// Sesi yang sedang diajukan / sudah disetujui terkunci dari perubahan.
function guardEditable(session, res) {
  try { approval.assertEditable(session); return true; } catch (err) {
    res.status(err.httpStatus || 409).json({ error: err.message });
    return false;
  }
}

const OWN = requirePermission("session:own");
const getOwnedSession = (req, res) => getSessionOr404(req, res, { write: true });

// Urutkan daftar sesi berdasarkan kolom apa pun (ascending/descending)
const SORTABLE_FIELDS = ["nama_pelanggan", "rab_nomor", "industri", "witel", "status", "total_biaya", "created_at", "updated_at"];
function sortSessions(list, sortBy, sortDir) {
  const field = SORTABLE_FIELDS.includes(sortBy) ? sortBy : "updated_at";
  const dir = sortDir === "asc" ? 1 : -1;
  const getVal = (s) => {
    switch (field) {
      case "total_biaya": return s.total_biaya || 0;
      case "created_at": return new Date(s.created_at).getTime() || 0;
      case "updated_at": return new Date(s.updated_at).getTime() || 0;
      default: return (s[field] || "").toString().toLowerCase();
    }
  };
  return list.sort((a, b) => {
    const va = getVal(a), vb = getVal(b);
    if (va < vb) return -1 * dir;
    if (va > vb) return 1 * dir;
    return 0;
  });
}

// Terjemahkan parameter legacy `sort` (dropdown lama) atau `sortBy`/`sortDir` (klik kolom) jadi field+arah yang konsisten
function resolveSort(query) {
  const { sort, sortBy, sortDir } = query;
  if (sortBy) return { field: sortBy, dir: sortDir === "asc" ? "asc" : "desc" };
  if (sort === "total_desc") return { field: "total_biaya", dir: "desc" };
  if (sort === "total_asc") return { field: "total_biaya", dir: "asc" };
  if (sort === "oldest") return { field: "created_at", dir: "asc" };
  return { field: "updated_at", dir: "desc" };
}

function getItems(sessionId) {
  return db.prepare("SELECT * FROM session_items WHERE session_id = ? ORDER BY sort_order, id").all(sessionId);
}

function touchSession(id) {
  db.prepare("UPDATE sessions SET updated_at = datetime('now') WHERE id = ?").run(id);
}

function sanitizeFileStem(value) {
  return String(value || "RAB")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || "RAB";
}

// Susun nama file RAB dari: nama pelanggan/perusahaan, industri, dan nomor RAB.
// Contoh: "PT_Maju_Sentosa_Perbankan_RAB_2026_0123-7.xlsx"
function buildRabFileName(session) {
  const parts = [session.nama_pelanggan, session.industri, session.rab_nomor]
    .filter(v => v != null && String(v).trim() !== "")
    .map(sanitizeFileStem);
  const stem = parts.length ? parts.join("_") : sanitizeFileStem(`Session-${session.id}`);
  return `${stem}.xlsx`;
}

function getArchiveDir() {
  return path.join(__dirname, "..", "..", "data", "rab_output");
}

function ensureArchiveDir() {
  fs.mkdirSync(getArchiveDir(), { recursive: true });
  return getArchiveDir();
}

async function saveRabArchive(session, items, options = { persist: true }) {
  const workbook = await buildRabWorkbook({
    customerName: session.nama_pelanggan,
    items,
    rabMeta: { nomor: session.rab_nomor, tanggal: session.rab_tanggal, budget: session.budget }
  });

  const fileName = buildRabFileName(session);
  if (options && options.persist) {
    const archiveDir = ensureArchiveDir();
    const archivePath = path.join(archiveDir, fileName);
    await workbook.xlsx.writeFile(archivePath);
    return {
      archivePath: path.relative(path.join(__dirname, "..", ".."), archivePath).replace(/\\/g, "/"),
      archiveName: fileName
    };
  }

  // If not persisting, return workbook in-memory (caller may stream it)
  return { archivePath: null, archiveName: null, workbook, archiveName: fileName };
}

function getSessionArchiveFile(session) {
  if (!session.rab_archive_path) return null;
  return path.resolve(__dirname, "..", "..", session.rab_archive_path);
}

// ---------------------------------------------------------------------
// POST /api/sessions — buat sesi baru (Step 1: Input kebutuhan pelanggan)
// ---------------------------------------------------------------------
router.post("/", requireAuth, requirePermission("session:create"), (req, res) => {
  const { nama_pelanggan, industri, cabang, witel, kebutuhan, budget } = req.body || {};
  if (!nama_pelanggan || !kebutuhan) {
    return res.status(400).json({ error: "nama_pelanggan dan kebutuhan wajib diisi." });
  }
  const cabangMatch = String(cabang || "").match(/\d+/);
  const cabangNum = cabangMatch ? parseInt(cabangMatch[0], 10) : 1;
  const budgetVal = budget ? parseFloat(budget) : null;

  const info = db.prepare(`
    INSERT INTO sessions (user_id, nama_pelanggan, industri, cabang, cabang_num, witel, kebutuhan, budget, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft')
  `).run(req.user.id, nama_pelanggan, industri || null, cabang || null, cabangNum, witel || req.user.witel, kebutuhan, budgetVal);

  const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(info.lastInsertRowid);
  res.status(201).json({ session, items: [] });
});

// ---------------------------------------------------------------------
// GET /api/sessions — riwayat sesi milik sales yang login (search, sort, filter witel, pagination)
// ---------------------------------------------------------------------
router.get("/", requireAuth, (req, res) => {
  const { q, witel, sort = "latest", page = 1, limit = 10 } = req.query;

  let query = "SELECT id, nama_pelanggan, industri, witel, status, rab_nomor, is_bookmarked, created_at, updated_at FROM sessions WHERE user_id = ?";
  const params = [req.user.id];

  if (witel && witel.trim() && witel.toLowerCase() !== "semua" && witel.toLowerCase() !== "all") {
    query += " AND LOWER(witel) LIKE ?";
    params.push(`%${witel.trim().toLowerCase()}%`);
  }

  const rows = db.prepare(query + " ORDER BY updated_at DESC").all(...params);

  // Hitung total biaya per sesi
  let withTotals = rows.map((s) => {
    const items = getItems(s.id);
    const totals = computeTotals(items);
    return { ...s, total_biaya: totals.grand };
  });

  // Filter kata kunci q (nama_pelanggan, industri, witel, rab_nomor)
  if (q && q.trim()) {
    const keyword = q.trim().toLowerCase();
    withTotals = withTotals.filter((s) =>
      (s.nama_pelanggan && s.nama_pelanggan.toLowerCase().includes(keyword)) ||
      (s.industri && s.industri.toLowerCase().includes(keyword)) ||
      (s.witel && s.witel.toLowerCase().includes(keyword)) ||
      (s.rab_nomor && s.rab_nomor.toLowerCase().includes(keyword))
    );
  }

  // Sorting: total_desc, total_asc, latest, oldest (legacy) atau sortBy+sortDir (klik kolom tabel)
  const { field: sortField, dir: sortDir } = resolveSort(req.query);
  sortSessions(withTotals, sortField, sortDir);

  // Pagination
  const total = withTotals.length;
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.max(1, parseInt(limit, 10) || 10);
  const totalPages = Math.ceil(total / limitNum) || 1;
  const startIndex = (pageNum - 1) * limitNum;
  const paginatedSessions = withTotals.slice(startIndex, startIndex + limitNum);

  res.json({
    sessions: paginatedSessions,
    pagination: {
      total,
      page: pageNum,
      limit: limitNum,
      totalPages
    }
  });
});

// ---------------------------------------------------------------------
// GET /api/sessions/bookmarks — daftar bookmark RAB milik user
// ---------------------------------------------------------------------
router.get("/bookmarks", requireAuth, (req, res) => {
  const { q, witel, sort = "latest", page = 1, limit = 10 } = req.query;

  let query = "SELECT id, nama_pelanggan, industri, witel, status, rab_nomor, rab_tanggal, is_bookmarked, created_at, updated_at FROM sessions WHERE user_id = ? AND is_bookmarked = 1";
  const params = [req.user.id];

  if (witel && witel.trim() && witel.toLowerCase() !== "semua" && witel.toLowerCase() !== "all") {
    query += " AND LOWER(witel) LIKE ?";
    params.push(`%${witel.trim().toLowerCase()}%`);
  }

  const rows = db.prepare(query + " ORDER BY updated_at DESC").all(...params);

  let withTotals = rows.map((s) => {
    const items = getItems(s.id);
    const totals = computeTotals(items);
    return { ...s, total_biaya: totals.grand };
  });

  if (q && q.trim()) {
    const keyword = q.trim().toLowerCase();
    withTotals = withTotals.filter((s) =>
      (s.nama_pelanggan && s.nama_pelanggan.toLowerCase().includes(keyword)) ||
      (s.industri && s.industri.toLowerCase().includes(keyword)) ||
      (s.witel && s.witel.toLowerCase().includes(keyword)) ||
      (s.rab_nomor && s.rab_nomor.toLowerCase().includes(keyword))
    );
  }

  const { field: sortField, dir: sortDir } = resolveSort(req.query);
  sortSessions(withTotals, sortField, sortDir);

  const total = withTotals.length;
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.max(1, parseInt(limit, 10) || 10);
  const totalPages = Math.ceil(total / limitNum) || 1;
  const startIndex = (pageNum - 1) * limitNum;
  const paginatedBookmarks = withTotals.slice(startIndex, startIndex + limitNum);

  res.json({
    bookmarks: paginatedBookmarks,
    pagination: {
      total,
      page: pageNum,
      limit: limitNum,
      totalPages
    }
  });
});

// ---------------------------------------------------------------------
// GET /api/sessions/dashboard/summary — ringkasan untuk beranda dashboard & analytics
// ---------------------------------------------------------------------
router.get("/dashboard/summary", requireAuth, (req, res) => {
  const { witel, start_date, end_date } = req.query;

  let query = "SELECT id, nama_pelanggan, industri, cabang, witel, status, rab_nomor, is_bookmarked, created_at, updated_at, rab_archive_name FROM sessions WHERE user_id = ?";
  const params = [req.user.id];

  if (witel && witel.trim() && witel.toLowerCase() !== "semua" && witel.toLowerCase() !== "all") {
    query += " AND LOWER(witel) LIKE ?";
    params.push(`%${witel.trim().toLowerCase()}%`);
  }

  // Filter rentang tanggal (berdasarkan tanggal sesi dibuat) — dipakai oleh filter tanggal di dashboard
  // supaya pie chart, bar chart, dan donut chart semuanya terfilter serentak.
  if (start_date && start_date.trim()) {
    query += " AND date(created_at) >= date(?)";
    params.push(start_date.trim());
  }
  if (end_date && end_date.trim()) {
    query += " AND date(created_at) <= date(?)";
    params.push(end_date.trim());
  }

  const sessions = db.prepare(query + " ORDER BY updated_at DESC").all(...params);

  const withTotals = sessions.map((s) => {
    const items = getItems(s.id);
    const totals = computeTotals(items);
    return { ...s, total_biaya: totals.grand };
  });

  const totalDocs = withTotals.length;
  const totalNilai = withTotals.reduce((sum, s) => sum + (s.total_biaya || 0), 0);
  const rataRata = totalDocs ? totalNilai / totalDocs : 0;
  const totalBookmarks = withTotals.filter((s) => s.is_bookmarked).length;

  // Distribusi produk — kelompokkan semua item dari seluruh sesi berdasarkan kategori (ref/layanan)
  const categoryTotals = {};
  const serviceStats = {};
  withTotals.forEach((s) => {
    const items = getItems(s.id);
    items.forEach((it) => {
      let label = (it.ref || "").split("•")[0].trim();
      if (!label || label.toLowerCase() === "input manual") label = "Lainnya";
      categoryTotals[label] = (categoryTotals[label] || 0) + (it.qty || 0);

      if (!serviceStats[label]) serviceStats[label] = { qty: 0, total_nilai: 0 };
      const contractMonths = it.periode === "Bulanan" ? 12 : 1;
      const itemPrice = ((it.harga || 0) * (it.qty || 1) * contractMonths) + ((it.psb || 0) * (it.qty || 1));
      serviceStats[label].qty += (it.qty || 1);
      serviceStats[label].total_nilai += itemPrice;
    });
  });
  const totalQty = Object.values(categoryTotals).reduce((a, b) => a + b, 0);
  const productDistribution = Object.entries(categoryTotals)
    .map(([label, qty]) => ({ label, qty, percent: totalQty ? Math.round((qty / totalQty) * 1000) / 10 : 0 }))
    .sort((a, b) => b.qty - a.qty);

  const serviceBreakdown = Object.entries(serviceStats)
    .map(([label, data]) => ({ label, qty: data.qty, total_nilai: data.total_nilai }))
    .sort((a, b) => b.total_nilai - a.total_nilai);

  // Details per kategori untuk filter interaktif Bar Chart
  const categoryDetails = {};
  withTotals.forEach((s) => {
    const items = getItems(s.id);
    items.forEach((it) => {
      let label = (it.ref || "").split("•")[0].trim();
      if (!label || label.toLowerCase() === "input manual") label = "Lainnya";

      if (!categoryDetails[label]) categoryDetails[label] = [];

      const contractMonths = it.periode === "Bulanan" ? 12 : 1;
      const itemPrice = ((it.harga || 0) * (it.qty || 1) * contractMonths) + ((it.psb || 0) * (it.qty || 1));

      categoryDetails[label].push({
        session_id: s.id,
        nama_pelanggan: s.nama_pelanggan,
        rab_nomor: s.rab_nomor || "-",
        nama_produk: it.nama,
        qty: it.qty || 1,
        total_biaya: itemPrice,
        witel: s.witel || "-"
      });
    });
  });

  Object.keys(categoryDetails).forEach(cat => {
    categoryDetails[cat].sort((a, b) => (b.total_biaya || 0) - (a.total_biaya || 0));
  });

  // Data Bar Chart: Top Project Values
  const projectValues = withTotals
    .slice()
    .sort((a, b) => (b.total_biaya || 0) - (a.total_biaya || 0))
    .map((s) => ({
      id: s.id,
      nama_pelanggan: s.nama_pelanggan,
      rab_nomor: s.rab_nomor || "-",
      total_biaya: s.total_biaya || 0,
      witel: s.witel || "-"
    }));

  // Group by date (sales trend)
  const trendMap = {};
  const sortedSessions = sessions.slice().sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  
  const formatDate = (dateStr) => {
    if (!dateStr) return "";
    const d = new Date(dateStr);
    const months = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
    return `${d.getDate()} ${months[d.getMonth()]}`;
  };

  const uniqueDates = [];
  sortedSessions.forEach(s => {
    const dStr = s.created_at.split(" ")[0]; // YYYY-MM-DD
    if (!uniqueDates.includes(dStr)) {
      uniqueDates.push(dStr);
    }
  });

  const categories = ["Datin", "HSI", "Wifi Managed (WMS)", "DBT", "Lainnya"];
  
  // Initialize map
  uniqueDates.forEach(d => {
    trendMap[d] = {};
    categories.forEach(cat => {
      trendMap[d][cat] = 0;
    });
  });

  // Populate data
  sortedSessions.forEach(s => {
    const dStr = s.created_at.split(" ")[0];
    const items = getItems(s.id);
    items.forEach(it => {
      let label = (it.ref || "").split("•")[0].trim();
      if (!label || label.toLowerCase() === "input manual") label = "Lainnya";
      if (!categories.includes(label)) label = "Lainnya";
      trendMap[dStr][label] += (it.qty || 1);
    });
  });

  const serviceTrend = {
    dates: uniqueDates.map(formatDate),
    categories: categories,
    series: categories.reduce((acc, cat) => {
      acc[cat] = uniqueDates.map(d => trendMap[d][cat]);
      return acc;
    }, {})
  };

  res.json({
    stats: {
      total_dokumen: totalDocs,
      total_nilai_solusi: totalNilai,
      rata_rata_nilai: rataRata,
      total_bookmarks: totalBookmarks
    },
    product_distribution: productDistribution,
    project_values: projectValues,
    service_breakdown: serviceBreakdown,
    service_trend: serviceTrend,
    category_details: categoryDetails,
    recent: withTotals.slice(0, 5)
  });
});

// ---------------------------------------------------------------------
// PUT /api/sessions/:id/bookmark — toggle bookmark sesi
// ---------------------------------------------------------------------
router.put("/:id/bookmark", requireAuth, requirePermission("session:own"), (req, res) => {
  const session = getOwnedSession(req, res);
  if (!session) return;

  const nextValue = session.is_bookmarked ? 0 : 1;
  db.prepare(`
    UPDATE sessions
    SET is_bookmarked = ?, updated_at = datetime('now')
    WHERE id = ? AND user_id = ?
  `).run(nextValue, session.id, req.user.id);

  const updated = db.prepare("SELECT * FROM sessions WHERE id = ?").get(session.id);
  res.json({ session: updated, bookmarked: !!nextValue });
});

// ---------------------------------------------------------------------
// GET /api/sessions/archives — daftar arsip RAB yang tersimpan di server
// ---------------------------------------------------------------------
router.get("/archives", requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT id, nama_pelanggan, rab_nomor, rab_tanggal, rab_archive_path, rab_archive_name, rab_archived_at
    FROM sessions
    WHERE user_id = ? AND rab_archive_path IS NOT NULL
    ORDER BY rab_archived_at DESC, id DESC
  `).all(req.user.id);

  res.json({
    archives: rows.map((row) => ({
      session_id: row.id,
      nama_pelanggan: row.nama_pelanggan,
      rab_nomor: row.rab_nomor,
      rab_tanggal: row.rab_nomor,
      archive_name: row.rab_archive_name,
      archived_at: row.rab_archived_at,
      download_url: `/api/sessions/archives/${row.id}/download`
    }))
  });
});

// ---------------------------------------------------------------------
// GET /api/sessions/archives/:sessionId/download — unduh arsip RAB dari server
// ---------------------------------------------------------------------
router.get("/archives/:sessionId/download", requireAuth, (req, res) => {
  const session = db.prepare("SELECT * FROM sessions WHERE id = ? AND user_id = ?").get(req.params.sessionId, req.user.id);
  if (!session) return res.status(404).json({ error: "Sesi tidak ditemukan." });
  if (!session.rab_archive_path) return res.status(404).json({ error: "Arsip RAB belum tersedia untuk sesi ini." });

  const archivePath = getSessionArchiveFile(session);
  if (!archivePath || !fs.existsSync(archivePath)) {
    return res.status(404).json({ error: "File arsip RAB tidak ditemukan di server." });
  }

  res.download(archivePath, session.rab_archive_name || `RAB_${session.id}.xlsx`);
});

// ---------------------------------------------------------------------
// GET /api/sessions/:id — detail sesi + item + totals
// ---------------------------------------------------------------------
router.get("/:id", requireAuth, (req, res) => {
  const session = getSessionOr404(req, res);
  if (!session) return;
  const items = getItems(session.id);
  const totals = computeTotals(items);
  res.json({
    is_owner: session.user_id === req.user.id,
    session: { ...session, keywords: JSON.parse(session.keywords_json), notes: JSON.parse(session.notes_json) },
    items,
    totals
  });
});

// ---------------------------------------------------------------------
// POST /api/sessions/:id/clone — duplikat sesi lama menjadi riwayat baru
// ---------------------------------------------------------------------
router.post("/:id/clone", requireAuth, requirePermission("session:own"), (req, res) => {
  const source = getOwnedSession(req, res);
  if (!source) return;

  const cloneTx = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO sessions (
        user_id, nama_pelanggan, industri, cabang, cabang_num, witel, kebutuhan,
        status, keywords_json, notes_json, rab_nomor, rab_tanggal,
        rab_archive_path, rab_archive_name, rab_archived_at, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, NULL, NULL, NULL, NULL, NULL, datetime('now'), datetime('now'))
    `).run(
      req.user.id,
      source.nama_pelanggan,
      source.industri,
      source.cabang,
      source.cabang_num,
      source.witel,
      source.kebutuhan,
      source.keywords_json,
      source.notes_json
    );

    const clonedSession = db.prepare("SELECT * FROM sessions WHERE id = ?").get(info.lastInsertRowid);
    const items = getItems(source.id);

    const insertItem = db.prepare(`
      INSERT INTO session_items (
        session_id, nama, sumber, harga, psb, satuan, qty, periode, lokasi, ref, sort_order, kecocokan,
        kategori, jenis_layanan, product_id, price_version_id
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    items.forEach((it, idx) => {
      insertItem.run(
        clonedSession.id,
        it.nama,
        it.sumber,
        it.harga,
        it.psb || 0,
        it.satuan,
        it.qty,
        it.periode,
        it.lokasi || "",
        it.ref,
        idx,
        it.kecocokan ?? null,
        it.kategori || "HSI",
        it.jenis_layanan || "",
        it.product_id || null,
        it.price_version_id || null
      );
    });

    return { session: clonedSession, items: getItems(clonedSession.id) };
  });

  const result = cloneTx();
  res.status(201).json({
    session: {
      ...result.session,
      keywords: JSON.parse(result.session.keywords_json || "[]"),
      notes: JSON.parse(result.session.notes_json || "[]")
    },
    items: result.items,
    totals: computeTotals(result.items)
  });
});

// ---------------------------------------------------------------------
// PUT /api/sessions/:id — update data sesi (mis. step 1)
// ---------------------------------------------------------------------
router.put("/:id", requireAuth, requirePermission("session:own"), (req, res) => {
  const session = getOwnedSession(req, res);
  if (!session) return;
  if (!guardEditable(session, res)) return;

  const { nama_pelanggan, industri, cabang, witel, kebutuhan, budget } = req.body || {};
  if (!nama_pelanggan || !kebutuhan) {
    return res.status(400).json({ error: "nama_pelanggan dan kebutuhan wajib diisi." });
  }

  const cabangMatch = String(cabang || "").match(/\d+/);
  const cabangNum = cabangMatch ? parseInt(cabangMatch[0], 10) : 1;
  const budgetVal = budget ? parseFloat(budget) : null;

  db.prepare(`
    UPDATE sessions
    SET nama_pelanggan = ?, industri = ?, cabang = ?, cabang_num = ?, witel = ?, kebutuhan = ?, budget = ?, updated_at = datetime('now')
    WHERE id = ? AND user_id = ?
  `).run(nama_pelanggan, industri || null, cabang || null, cabangNum, witel || req.user.witel, kebutuhan, budgetVal, session.id, req.user.id);

  const updated = db.prepare("SELECT * FROM sessions WHERE id = ?").get(session.id);
  res.json({ session: updated });
});

// ---------------------------------------------------------------------
// POST /api/sessions/:id/analyze — Step 2+4: AI baca kebutuhan & cocokkan produk
// ---------------------------------------------------------------------
router.post("/:id/analyze", requireAuth, requirePermission("session:own"), (req, res) => {
  const session = getOwnedSession(req, res);
  if (!session) return;
  if (!guardEditable(session, res)) return;

  const targetBudget = req.body.budget ? parseFloat(req.body.budget) : (session.budget ? parseFloat(session.budget) : null);
  if (targetBudget != null && !isNaN(targetBudget)) {
    db.prepare("UPDATE sessions SET budget = ? WHERE id = ?").run(targetBudget, session.id);
  }

  const { keywords, notes, items, engine, ranking } = analyzeNeed(session.kebutuhan, session.cabang_num, targetBudget);

  const insertItem = db.prepare(`
    INSERT INTO session_items (session_id, nama, sumber, harga, psb, satuan, qty, periode, lokasi, ref, sort_order, kecocokan, kategori, jenis_layanan, reasoning, product_id, price_version_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const existingItems = db.prepare("SELECT nama FROM session_items WHERE session_id = ? AND sumber = 'MANUAL'").all(session.id);
  const existingNames = new Set(existingItems.map(x => x.nama.toLowerCase().trim()));

  const insertAll = db.transaction((list) => {
    db.prepare("DELETE FROM session_items WHERE session_id = ? AND sumber IN ('REKOMENDASI AI', 'DIEDIT SALES')").run(session.id);
    
    const maxSort = db.prepare("SELECT COALESCE(MAX(sort_order), 0) as m FROM session_items WHERE session_id = ?").get(session.id);
    let startIdx = maxSort.m + 1;

    list.forEach((it) => {
      const cleanName = it.nama.toLowerCase().trim();
      if (existingNames.has(cleanName)) {
        return; // skip duplicate recommendation
      }
      existingNames.add(cleanName);
      insertItem.run(session.id, it.nama, it.sumber, it.harga, it.psb || 0, it.satuan, it.qty, it.periode, it.lokasi || "", it.ref, startIdx++, it.kecocokan ?? null, it.kategori || "HSI", it.jenis_layanan || "", it.reasoning || "", it.product_id || null, it.price_version_id || null);
    });
  });
  insertAll(items);

  db.prepare(`
    UPDATE sessions SET status = 'analyzed', keywords_json = ?, notes_json = ?, recommender_engine = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(JSON.stringify(keywords), JSON.stringify(notes), engine || null, session.id);

  const savedItems = getItems(session.id);
  res.json({ engine, keywords, notes, ranking, items: savedItems, totals: computeTotals(savedItems) });
});

// ---------------------------------------------------------------------
// POST /api/sessions/:id/items — tambah produk manual (Step 5)
// ---------------------------------------------------------------------
router.post("/:id/items", requireAuth, requirePermission("session:own"), (req, res) => {
  const session = getOwnedSession(req, res);
  if (!session) return;
  if (!guardEditable(session, res)) return;
  const { nama, harga, satuan, qty, periode, lokasi, ref, kategori, jenis_layanan, product_id } = req.body || {};
  if (!nama) return res.status(400).json({ error: "nama produk wajib diisi." });
  if (harga != null && (!Number.isFinite(Number(harga)) || Number(harga) < 0)) return res.status(400).json({ error: "harga harus angka >= 0." });
  if (qty != null && (!Number.isFinite(Number(qty)) || Number(qty) < 1)) return res.status(400).json({ error: "qty minimal 1." });

  // Bila item dipilih dari master data, simpan acuan produk + versi harga terkini (keterlacakan harga).
  let productId = null, versionId = null;
  if (product_id) {
    const prod = db.prepare("SELECT id FROM master_products WHERE id = ?").get(product_id);
    if (prod) {
      productId = prod.id;
      const v = db.prepare("SELECT id FROM product_price_versions WHERE product_id = ? ORDER BY version DESC LIMIT 1").get(prod.id);
      versionId = v ? v.id : null;
    }
  }

  const info = db.prepare(`
    INSERT INTO session_items (session_id, nama, sumber, harga, psb, satuan, qty, periode, lokasi, ref, sort_order, kategori, jenis_layanan, product_id, price_version_id)
    VALUES (?, ?, 'MANUAL', ?, ?, ?, ?, ?, ?, ?,
      (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM session_items WHERE session_id = ?), ?, ?, ?, ?)
  `).run(session.id, String(nama).slice(0, 300), harga || 0, req.body.psb || 0, satuan || "unit", qty || 1, periode || "Bulanan", lokasi || "", ref || "Lainnya", session.id, kategori || "HSI", jenis_layanan || "", productId, versionId);

  touchSession(session.id);
  const item = db.prepare("SELECT * FROM session_items WHERE id = ?").get(info.lastInsertRowid);
  res.status(201).json({ item });
});

// ---------------------------------------------------------------------
// PUT /api/sessions/:id/items/:itemId — edit qty/harga/periode/nama/lokasi
// ---------------------------------------------------------------------
router.put("/:id/items/:itemId", requireAuth, requirePermission("session:own"), (req, res) => {
  const session = getOwnedSession(req, res);
  if (!session) return;
  if (!guardEditable(session, res)) return;

  const item = db.prepare("SELECT * FROM session_items WHERE id = ? AND session_id = ?")
    .get(req.params.itemId, session.id);
  if (!item) return res.status(404).json({ error: "Item tidak ditemukan." });

  const { nama, harga, psb, satuan, qty, periode, lokasi, ref, diskon_psb, diskon_satuan, periode_bulan, kategori, jenis_layanan } = req.body || {};
  // Jika item berasal dari rekomendasi AI dan diubah, tandai "DIEDIT SALES"
  const sumberBaru = item.sumber === "REKOMENDASI AI" ? "DIEDIT SALES" : item.sumber;

  db.prepare(`
    UPDATE session_items SET
      nama = COALESCE(?, nama),
      harga = COALESCE(?, harga),
      psb = COALESCE(?, psb),
      satuan = COALESCE(?, satuan),
      qty = COALESCE(?, qty),
      periode = COALESCE(?, periode),
      lokasi = COALESCE(?, lokasi),
      ref = COALESCE(?, ref),
      diskon_psb = COALESCE(?, diskon_psb),
      diskon_satuan = COALESCE(?, diskon_satuan),
      periode_bulan = COALESCE(?, periode_bulan),
      kategori = COALESCE(?, kategori),
      jenis_layanan = COALESCE(?, jenis_layanan),
      sumber = ?
    WHERE id = ?
  `).run(
    nama ?? null,
    harga ?? null,
    psb ?? null,
    satuan ?? null,
    qty ?? null,
    periode ?? null,
    lokasi ?? null,
    ref ?? null,
    diskon_psb ?? null,
    diskon_satuan ?? null,
    periode_bulan ?? null,
    kategori ?? null,
    jenis_layanan ?? null,
    sumberBaru,
    item.id
  );

  touchSession(session.id);
  const updated = db.prepare("SELECT * FROM session_items WHERE id = ?").get(item.id);
  res.json({ item: updated });
});

// ---------------------------------------------------------------------
// DELETE /api/sessions/:id/items/:itemId
// ---------------------------------------------------------------------
router.delete("/:id/items/:itemId", requireAuth, requirePermission("session:own"), (req, res) => {
  const session = getOwnedSession(req, res);
  if (!session) return;
  if (!guardEditable(session, res)) return;
  const result = db.prepare("DELETE FROM session_items WHERE id = ? AND session_id = ?")
    .run(req.params.itemId, session.id);
  if (result.changes === 0) return res.status(404).json({ error: "Item tidak ditemukan." });
  touchSession(session.id);
  res.json({ deleted: true });
});

// ---------------------------------------------------------------------
// DELETE /api/sessions/:id — hapus seluruh sesi (riwayat)
// ---------------------------------------------------------------------
router.delete("/:id", requireAuth, requirePermission("session:own"), (req, res) => {
  const session = getOwnedSession(req, res);
  if (!session) return;
  if (!approval.isEditable(session)) {
    return res.status(409).json({ error: `RAB berstatus "${session.approval_status}" tidak dapat dihapus agar jejak audit tetap utuh.` });
  }

  // Hapus file arsip jika ada
  try {
    const archivePath = getSessionArchiveFile(session);
    if (archivePath && fs.existsSync(archivePath)) {
      fs.unlinkSync(archivePath);
    }
  } catch (err) {
    console.error("Gagal menghapus file arsip RAB:", err.message);
    // lanjutkan penghapusan sesi meski penghapusan file gagal
  }

  const result = db.prepare("DELETE FROM sessions WHERE id = ? AND user_id = ?").run(session.id, req.user.id);
  if (result.changes === 0) return res.status(404).json({ error: "Sesi tidak ditemukan atau tidak dapat dihapus." });

  logAudit({ actor: req.user, action: "session.delete", entityType: "session", entityId: session.id, from: session.approval_status, note: session.nama_pelanggan, ip: req.ip });
  res.json({ deleted: true });
});

// ---------------------------------------------------------------------
// POST /api/sessions/:id/approve — Step 6: simulasi "Power Automate"
// (validasi, hitung PPN 11%, susun nomor RAB)
// ---------------------------------------------------------------------
router.post("/:id/approve", requireAuth, OWN, async (req, res) => {
  const session = getSessionOr404(req, res, { write: true });
  if (!session) return;
  if (session.approval_status !== "disetujui") {
    return res.status(409).json({ error: "RAB belum disetujui Manajer. Ajukan untuk persetujuan terlebih dahulu." });
  }
  const items = getItems(session.id);
  if (!items.length) {
    return res.status(400).json({ error: "Tabel rekomendasi masih kosong. Tambahkan minimal satu produk." });
  }
  const totals = computeTotals(items);
  const downloadUrl = `/api/sessions/archives/${session.id}/download`;

  // Idempoten: RAB yang sudah diterbitkan tidak diberi nomor baru.
  if (session.status === "completed" && session.rab_nomor) {
    return res.json({ status: "completed", rab_nomor: session.rab_nomor, rab_tanggal: session.rab_tanggal, totals,
      archive: { filename: buildRabFileName(session), download_url: downloadUrl } });
  }

  const now = new Date();
  const nomorTanggal = now.toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
  const [nomorY, nomorM, nomorD] = nomorTanggal.split("-").map(Number);
  const nomor = `RAB/${nomorY}/${String(nomorM * 31 + nomorD).padStart(4, "0")}-${session.id}`;
  const tanggalWib = now.toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta", day: "2-digit", month: "long", year: "numeric" });
  const jamWib = now.toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  const tanggal = `${tanggalWib}, ${jamWib} WIB`;

  try {
    const archive = await saveRabArchive({ ...session, rab_nomor: nomor, rab_tanggal: tanggal }, items, { persist: false });
    db.transaction(() => {
      db.prepare(`
        UPDATE sessions SET status = 'completed', rab_nomor = ?, rab_tanggal = ?, rab_archived_at = datetime('now'), updated_at = datetime('now')
        WHERE id = ?
      `).run(nomor, tanggal, session.id);
      logAudit({ actor: req.user, action: "session.finalize", entityType: "session", entityId: session.id, from: session.status, to: "completed", note: nomor, ip: req.ip });
    })();
    res.json({ status: "completed", rab_nomor: nomor, rab_tanggal: tanggal, totals,
      archive: { filename: archive.archiveName, download_url: downloadUrl } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Gagal menyimpan arsip RAB: " + err.message });
  }
});

// ---------------------------------------------------------------------
// Persetujuan berjenjang (Sales 2.0)
// ---------------------------------------------------------------------
function runApproval(res, fn) {
  try { return res.json({ session: fn() }); } catch (err) {
    if (err instanceof approval.ApprovalError) return res.status(err.httpStatus).json({ error: err.message });
    throw err;
  }
}

// POST /api/sessions/:id/submit — Sales mengajukan RAB (draft/ditolak -> diajukan)
router.post("/:id/submit", requireAuth, requirePermission("session:submit"), (req, res) => {
  const session = getSessionOr404(req, res, { write: true });
  if (!session) return;
  runApproval(res, () => approval.submit(session, req.user, req.ip));
});

// POST /api/sessions/:id/recall — Sales menarik pengajuan (diajukan -> draft)
router.post("/:id/recall", requireAuth, requirePermission("session:submit"), (req, res) => {
  const session = getSessionOr404(req, res, { write: true });
  if (!session) return;
  runApproval(res, () => approval.recall(session, req.user, req.ip));
});

// POST /api/sessions/:id/decision — Manajer menyetujui / menolak
router.post("/:id/decision", requireAuth, requirePermission("session:decide"), validate({
  decision: { type: "string", required: true, enum: ["approve", "reject"] },
  note: { type: "string", maxLength: 500 }
}), (req, res) => {
  const session = getSessionOr404(req, res); // Manajer boleh membaca sesi siapa pun; aturan lain di service
  if (!session) return;
  runApproval(res, () => approval.decide(session, req.user, req.body.decision, req.body.note, req.ip));
});

// GET /api/sessions/:id/audit — riwayat audit satu RAB
router.get("/:id/audit", requireAuth, (req, res) => {
  const session = getSessionOr404(req, res);
  if (!session) return;
  res.json(listAudit({ entityType: "session", entityId: session.id, limit: 200 }));
});

// GET /api/sessions/:id/price-trace — penelusuran tiap item ke versi harga acuannya (F-11)
router.get("/:id/price-trace", requireAuth, (req, res) => {
  const session = getSessionOr404(req, res);
  if (!session) return;
  const rows = getItems(session.id).map(it => {
    if (!it.product_id || !it.price_version_id) {
      return { item_id: it.id, nama: it.nama, tracked: false, harga_rab: it.harga, psb_rab: it.psb };
    }
    const ref = db.prepare("SELECT * FROM product_price_versions WHERE id = ?").get(it.price_version_id);
    const cur = db.prepare("SELECT * FROM product_price_versions WHERE product_id = ? ORDER BY version DESC LIMIT 1").get(it.product_id);
    return {
      item_id: it.id, nama: it.nama, tracked: true, product_id: it.product_id,
      harga_rab: it.harga, psb_rab: it.psb,
      versi_acuan: ref ? ref.version : null, harga_acuan: ref ? ref.harga : null, psb_acuan: ref ? ref.psb : null,
      versi_terkini: cur ? cur.version : null, harga_terkini: cur ? cur.harga : null,
      harga_berubah_sejak_rab: !!(ref && cur && cur.version > ref.version),
      diedit_sales: !!(ref && (ref.harga !== it.harga || ref.psb !== it.psb))
    };
  });
  res.json({ items: rows });
});

// ---------------------------------------------------------------------
// Dokumen penawaran PDF + email
// ---------------------------------------------------------------------
function quotationContext(session) {
  const items = getItems(session.id);
  const sales = db.prepare("SELECT id, name, email FROM users WHERE id = ?").get(session.user_id);
  const approver = session.decided_by ? db.prepare("SELECT id, name FROM users WHERE id = ?").get(session.decided_by) : null;
  return { session, items, sales, approver };
}

// Cache PDF terbatas (LRU sederhana). Kunci memuat isi item + status, sehingga perubahan apa pun membuat PDF baru.
const pdfCache = new Map();
const PDF_CACHE_MAX = 100;
async function getQuotationPdf(ctx) {
  const { session, items } = ctx;
  const key = [session.id, session.updated_at, session.approval_status, session.rab_nomor, session.decided_by, session.nama_pelanggan,
    items.map(i => [i.id, i.nama, i.qty, i.harga, i.psb, i.diskon_psb, i.diskon_satuan, i.periode_bulan, i.jenis_layanan].join(":")).join("|")].join("#");
  if (pdfCache.has(key)) { const v = pdfCache.get(key); pdfCache.delete(key); pdfCache.set(key, v); return v; }
  const pdf = await buildQuotationPdf(ctx);
  pdfCache.set(key, pdf);
  if (pdfCache.size > PDF_CACHE_MAX) pdfCache.delete(pdfCache.keys().next().value);
  return pdf;
}

// GET /api/sessions/:id/quotation.pdf — pratinjau/unduh SPH (berwatermark DRAFT sebelum disetujui)
router.get("/:id/quotation.pdf", requireAuth, async (req, res) => {
  const session = getSessionOr404(req, res);
  if (!session) return;
  const ctx = quotationContext(session);
  if (!ctx.items.length) return res.status(400).json({ error: "RAB belum memiliki item." });
  try {
    const pdf = await getQuotationPdf(ctx);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `${req.query.download === "1" ? "attachment" : "inline"}; filename="SPH_${sanitizeFileStem(session.nama_pelanggan)}.pdf"`);
    res.send(pdf);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Gagal membuat PDF penawaran." });
  }
});

// POST /api/sessions/:id/send-quotation — kirim SPH via email (hanya RAB yang sudah disetujui & diterbitkan)
router.post("/:id/send-quotation", requireAuth, requirePermission("quotation:send"), validate({
  to: { type: "email", required: true },
  subject: { type: "string", maxLength: 200 },
  message: { type: "string", maxLength: 2000 }
}), async (req, res) => {
  const session = getSessionOr404(req, res, { write: true });
  if (!session) return;
  if (session.approval_status !== "disetujui" || session.status !== "completed") {
    return res.status(409).json({ error: "Penawaran hanya dapat dikirim setelah RAB disetujui Manajer dan diterbitkan (nomor RAB tersedia)." });
  }
  const ctx = quotationContext(session);
  let pdf;
  try { pdf = await getQuotationPdf(ctx); } catch (err) {
    return res.status(500).json({ error: "Gagal membuat PDF penawaran." });
  }
  const totals = computeTotals(ctx.items);
  const subject = req.body.subject || `Surat Penawaran Harga ${session.rab_nomor} — ${session.nama_pelanggan}`;
  const text = (req.body.message ||
    `Yth. ${session.nama_pelanggan},\n\nTerlampir Surat Penawaran Harga layanan Telkom (${session.rab_nomor}) dengan total ` +
    `Rp ${Math.round(totals.grand).toLocaleString("id-ID")} (termasuk PPN 11%).\n\nHormat kami,\n${ctx.sales ? ctx.sales.name : "Telkom Witel Priangan Timur"}`).replace(/\\n/g, "\n");
  const result = await sendQuotationEmail({
    to: req.body.to, subject, text, pdfBuffer: pdf, filename: `SPH_${sanitizeFileStem(session.nama_pelanggan)}.pdf`,
    replyTo: ctx.sales && ctx.sales.email ? ctx.sales.email : undefined
  });

  const info = db.prepare(`
    INSERT INTO quotation_deliveries (session_id, to_email, subject, status, error, message_id, sent_by) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(session.id, req.body.to, subject, result.status, result.error || null, result.messageId || null, req.user.id);
  logAudit({ actor: req.user, action: "quotation.send", entityType: "quotation", entityId: session.id, to: result.status, note: `${req.body.to}${result.error ? " — " + result.error : ""}`, ip: req.ip });

  let opportunity = null;
  if (result.status !== "failed") {
    try { opportunity = pipeline.onQuotationSent(session.id, req.user); } catch (e) { /* pipeline opsional */ }
  }
  const body = { delivery: { id: info.lastInsertRowid, status: result.status, mode: result.mode, error: result.error || null, to: req.body.to }, opportunity };
  res.status(result.status === "failed" ? 502 : 200).json(result.status === "failed" ? { error: `Pengiriman email gagal: ${result.error}`, ...body } : body);
});

// GET /api/sessions/:id/deliveries — status pengiriman
router.get("/:id/deliveries", requireAuth, (req, res) => {
  const session = getSessionOr404(req, res);
  if (!session) return;
  res.json({ deliveries: db.prepare("SELECT * FROM quotation_deliveries WHERE session_id = ? ORDER BY id DESC").all(session.id) });
});

// ---------------------------------------------------------------------
// GET /api/sessions/:id/rab.xlsx — Step 7: unduh RAB terisi di Template SE asli
// ---------------------------------------------------------------------
router.get("/:id/rab.xlsx", requireAuth, async (req, res) => {
  const session = getSessionOr404(req, res);
  if (!session) return;
  if (session.status !== "completed") {
    return res.status(400).json({ error: 'Sesi belum diterbitkan (status harus "completed"). Ajukan persetujuan lalu proses RAB terlebih dahulu.' });
  }
  const items = getItems(session.id);
  try {
    const wbResult = await saveRabArchive(session, items, { persist: false });
    const workbook = wbResult.workbook;
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${wbResult.archiveName || buildRabFileName(session)}"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Gagal membuat file RAB: " + err.message });
  }
});

module.exports = router;
