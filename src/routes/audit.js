const express = require("express");
const { requireAuth } = require("../middleware/auth");
const { requirePermission } = require("../middleware/rbac");
const { validate } = require("../middleware/validate");
const { listAudit } = require("../services/audit");

const router = express.Router();

// GET /api/audit?entity_type=session&entity_id=3&action=session.&limit=50
router.get("/", requireAuth, requirePermission("audit:read"), validate({
  entity_type: { type: "string", enum: ["session", "product", "opportunity", "user", "quotation"] },
  entity_id: { type: "integer", min: 1 },
  action: { type: "string", maxLength: 60 },
  actor_id: { type: "integer", min: 1 },
  limit: { type: "integer", min: 1, max: 500 },
  offset: { type: "integer", min: 0 }
}, "query"), (req, res) => {
  const q = req.validatedQuery;
  res.json(listAudit({ entityType: q.entity_type, entityId: q.entity_id, action: q.action, actorId: q.actor_id, limit: q.limit || 100, offset: q.offset || 0 }));
});

module.exports = router;
