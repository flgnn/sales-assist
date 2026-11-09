const db = require("../db/db");

/**
 * Catat kejadian penting ke audit_logs.
 * Dipanggil di dalam transaksi yang sama dengan perubahan datanya, sehingga
 * perubahan status tidak pernah terjadi tanpa jejak audit (NF-07: 100% tercatat).
 */
function logAudit({ actor, action, entityType, entityId = null, from = null, to = null, note = null, ip = null }) {
  const info = db.prepare(`
    INSERT INTO audit_logs (actor_id, actor_name, actor_role, action, entity_type, entity_id, from_value, to_value, note, ip)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    actor ? actor.id : null,
    actor ? (actor.name || actor.username) : "sistem",
    actor ? actor.role : "system",
    action,
    entityType,
    entityId,
    from == null ? null : String(from),
    to == null ? null : String(to),
    note,
    ip
  );
  return info.lastInsertRowid;
}

function listAudit({ entityType, entityId, action, actorId, limit = 100, offset = 0 } = {}) {
  let where = "WHERE 1=1";
  const params = [];
  if (entityType) { where += " AND entity_type = ?"; params.push(entityType); }
  if (entityId) { where += " AND entity_id = ?"; params.push(entityId); }
  if (action) { where += " AND action LIKE ?"; params.push(`${action}%`); }
  if (actorId) { where += " AND actor_id = ?"; params.push(actorId); }
  const total = db.prepare(`SELECT COUNT(*) c FROM audit_logs ${where}`).get(...params).c;
  const rows = db.prepare(`SELECT * FROM audit_logs ${where} ORDER BY id DESC LIMIT ? OFFSET ?`)
    .all(...params, Math.min(limit, 500), offset);
  return { total, rows };
}

module.exports = { logAudit, listAudit };
