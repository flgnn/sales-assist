const express = require("express");
const db = require("../db/db");
const { requireAuth } = require("../middleware/auth");
const { requirePermission, ROLES } = require("../middleware/rbac");
const { validate } = require("../middleware/validate");
const { logAudit } = require("../services/audit");

const router = express.Router();

// GET /api/users — daftar pengguna (Admin)
router.get("/", requireAuth, requirePermission("user:manage"), (req, res) => {
  const users = db.prepare("SELECT id, username, name, role, witel, email, created_at FROM users ORDER BY id").all();
  res.json({ users, roles: ROLES });
});

// PUT /api/users/:id/role — ubah peran (Admin). Tercatat di audit log.
router.put("/:id/role", requireAuth, requirePermission("user:manage"), validate({
  role: { type: "string", required: true, enum: ROLES }
}), (req, res) => {
  const target = db.prepare("SELECT id, username, role FROM users WHERE id = ?").get(req.params.id);
  if (!target) return res.status(404).json({ error: "Pengguna tidak ditemukan." });
  if (target.id === req.user.id) return res.status(409).json({ error: "Admin tidak dapat mengubah perannya sendiri." });
  if (target.role === req.body.role) return res.json({ user: target });
  db.transaction(() => {
    db.prepare("UPDATE users SET role = ? WHERE id = ?").run(req.body.role, target.id);
    logAudit({ actor: req.user, action: "user.role_change", entityType: "user", entityId: target.id, from: target.role, to: req.body.role, note: target.username, ip: req.ip });
  })();
  res.json({ user: db.prepare("SELECT id, username, name, role, witel, email FROM users WHERE id = ?").get(target.id) });
});

module.exports = router;
