const express = require("express");
const db = require("../db/db");
const { requireAuth } = require("../middleware/auth");
const { requirePermission, can } = require("../middleware/rbac");
const { validate } = require("../middleware/validate");
const svc = require("../services/pipelineService");
const { logAudit } = require("../services/audit");

const router = express.Router();
const READ = requirePermission("pipeline:own", "pipeline:read_all");
const WRITE = requirePermission("pipeline:own");

function handle(res, fn) {
  try { return fn(); } catch (err) {
    if (err instanceof svc.PipelineError) return res.status(err.httpStatus).json({ error: err.message });
    throw err;
  }
}

function loadReadable(req, res) {
  const opp = svc.getOpportunity(req.params.id);
  if (!opp || (opp.owner_id !== req.user.id && !can(req.user.role, "pipeline:read_all"))) {
    res.status(404).json({ error: "Peluang tidak ditemukan." });
    return null;
  }
  return opp;
}

const filterSchema = {
  stage: { type: "string", enum: svc.STAGES },
  q: { type: "string", maxLength: 100 },
  owner_id: { type: "integer", min: 1 },
  from: { type: "date" },
  to: { type: "date" }
};

// GET /api/pipeline/summary — nilai pipeline, win rate, alasan kalah, jumlah pengingat
router.get("/summary", requireAuth, READ, validate(filterSchema, "query"), (req, res) => {
  const f = req.validatedQuery;
  const s = svc.summary(req.user, f);
  const r = svc.reminders(req.user, 7);
  res.json({ ...s, reminders: { overdue: r.overdue.length, today: r.today_due.length, upcoming: r.upcoming.length } });
});

// GET /api/pipeline/reminders?days=7
router.get("/reminders", requireAuth, READ, (req, res) => {
  const days = Math.min(60, Math.max(0, parseInt(req.query.days, 10) || 7));
  res.json(svc.reminders(req.user, days));
});

router.get("/", requireAuth, READ, validate(filterSchema, "query"), (req, res) => {
  res.json({ opportunities: svc.listOpportunities(req.user, req.validatedQuery) });
});

router.post("/", requireAuth, WRITE, validate({
  session_id: { type: "integer", min: 1 },
  nama_pelanggan: { type: "string", maxLength: 150 },
  judul: { type: "string", maxLength: 200 },
  nilai: { type: "number", min: 0, max: 1e13 },
  next_followup_at: { type: "date" },
  followup_note: { type: "string", maxLength: 300 },
  notes: { type: "string", maxLength: 1000 }
}), (req, res) => {
  handle(res, () => res.status(201).json({ opportunity: svc.createOpportunity(req.user, req.body) }));
});

router.get("/:id", requireAuth, READ, (req, res) => {
  const opp = loadReadable(req, res);
  if (!opp) return;
  const events = db.prepare(`
    SELECT e.*, u.name AS actor_name FROM opportunity_events e LEFT JOIN users u ON u.id = e.actor_id
    WHERE e.opportunity_id = ? ORDER BY e.id ASC
  `).all(opp.id);
  res.json({ opportunity: opp, events });
});

router.put("/:id", requireAuth, WRITE, validate({
  judul: { type: "string", maxLength: 200 },
  nilai: { type: "number", min: 0, max: 1e13 },
  next_followup_at: { type: "date" },
  followup_note: { type: "string", maxLength: 300 },
  notes: { type: "string", maxLength: 1000 }
}), (req, res) => {
  const opp = svc.getOpportunity(req.params.id);
  if (!opp || opp.owner_id !== req.user.id) return res.status(404).json({ error: "Peluang tidak ditemukan." });
  if (svc.FINAL_STAGES.includes(opp.stage)) return res.status(409).json({ error: "Peluang berstatus final tidak dapat diubah." });
  const b = req.body;
  db.transaction(() => {
    db.prepare(`
      UPDATE opportunities SET judul = COALESCE(?, judul), nilai = COALESCE(?, nilai), next_followup_at = COALESCE(?, next_followup_at),
        followup_note = COALESCE(?, followup_note), notes = COALESCE(?, notes), reminder_sent_on = NULL, updated_at = datetime('now')
      WHERE id = ?
    `).run(b.judul ?? null, b.nilai ?? null, b.next_followup_at ?? null, b.followup_note ?? null, b.notes ?? null, opp.id);
    logAudit({ actor: req.user, action: "opportunity.update", entityType: "opportunity", entityId: opp.id, from: opp.nilai, to: b.nilai ?? opp.nilai, ip: req.ip });
  })();
  res.json({ opportunity: svc.getOpportunity(opp.id) });
});

router.post("/:id/stage", requireAuth, WRITE, validate({
  stage: { type: "string", required: true, enum: svc.STAGES },
  note: { type: "string", maxLength: 500 },
  lost_reason: { type: "string", maxLength: 300 }
}), (req, res) => {
  const opp = svc.getOpportunity(req.params.id);
  if (!opp) return res.status(404).json({ error: "Peluang tidak ditemukan." });
  handle(res, () => res.json({ opportunity: svc.changeStage(opp, req.user, req.body.stage, req.body) }));
});

router.delete("/:id", requireAuth, WRITE, (req, res) => {
  const opp = svc.getOpportunity(req.params.id);
  if (!opp || opp.owner_id !== req.user.id) return res.status(404).json({ error: "Peluang tidak ditemukan." });
  if (opp.stage !== "prospek") return res.status(409).json({ error: "Hanya peluang berstatus prospek yang dapat dihapus." });
  db.transaction(() => {
    db.prepare("DELETE FROM opportunities WHERE id = ?").run(opp.id);
    logAudit({ actor: req.user, action: "opportunity.delete", entityType: "opportunity", entityId: opp.id, from: opp.stage, note: opp.nama_pelanggan, ip: req.ip });
  })();
  res.json({ deleted: true });
});

module.exports = router;
