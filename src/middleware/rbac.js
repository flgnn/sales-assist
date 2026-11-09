/**
 * Role-Based Access Control (RBAC) Sales Assist 2.0.
 * Hak akses dipetakan ke PERAN, bukan ke pengguna individual.
 *
 *   sales   : membuat & mengajukan RAB miliknya, mengirim penawaran, mengelola pipeline miliknya
 *   manager : meninjau semua RAB, menyetujui / menolak, melihat pipeline & audit log seluruh tim
 *   admin   : mengelola master data, harga, dan pengguna; membaca audit log
 */
const PERMISSIONS = {
  sales: [
    "session:create", "session:own", "session:submit", "quotation:send",
    "pipeline:own", "master:read", "recommend:use"
  ],
  manager: [
    "session:read_all", "session:decide", "pipeline:read_all", "pipeline:own",
    "audit:read", "master:read", "dashboard:team"
  ],
  admin: [
    "session:read_all", "master:read", "master:write", "user:manage",
    "audit:read", "pipeline:read_all", "dashboard:team"
  ]
};

const ROLES = Object.keys(PERMISSIONS);

function can(role, permission) {
  return (PERMISSIONS[role] || []).includes(permission);
}

/** Middleware: wajib punya salah satu permission. Harus dipasang SETELAH requireAuth. */
function requirePermission(...permissions) {
  const mw = (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "Token tidak ditemukan. Silakan login terlebih dahulu." });
    if (!permissions.some(p => can(req.user.role, p))) {
      return res.status(403).json({ error: "Anda tidak memiliki hak akses untuk tindakan ini." });
    }
    next();
  };
  mw.permissions = permissions;
  return mw;
}

module.exports = { PERMISSIONS, ROLES, can, requirePermission };
