const express = require("express");
const db = require("../db/db");
const { requireAuth } = require("../middleware/auth");
const { requirePermission } = require("../middleware/rbac");
const { computeTotals } = require("../services/excelService");

const router = express.Router();

// GET /api/approvals?status=diajukan — antrean peninjauan RAB (Manajer / Admin)
router.get("/", requireAuth, requirePermission("session:read_all"), (req, res) => {
  const allowed = ["diajukan", "disetujui", "ditolak", "all"];
  const status = allowed.includes(req.query.status) ? req.query.status : "diajukan";
  const rows = db.prepare(`
    SELECT s.id, s.nama_pelanggan, s.industri, s.witel, s.status, s.approval_status, s.submitted_at, s.decided_at,
           s.decision_note, s.rab_nomor, u.name AS sales_name, d.name AS decided_by_name
    FROM sessions s JOIN users u ON u.id = s.user_id LEFT JOIN users d ON d.id = s.decided_by
    ${status === "all" ? "WHERE s.approval_status <> 'draft'" : "WHERE s.approval_status = ?"}
    ORDER BY COALESCE(s.submitted_at, s.updated_at) DESC LIMIT 200
  `).all(...(status === "all" ? [] : [status]));
  const itemStmt = db.prepare("SELECT * FROM session_items WHERE session_id = ?");
  rows.forEach(r => { r.total = Math.round(computeTotals(itemStmt.all(r.id)).grand); });
  res.json({ approvals: rows });
});

module.exports = router;
