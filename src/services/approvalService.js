/**
 * Mesin status persetujuan RAB (F-04..F-06):
 *
 *   draft ──ajukan──▶ diajukan ──setujui──▶ disetujui   (final)
 *     ▲                  │  └────tolak────▶ ditolak ──ajukan ulang──▶ diajukan
 *     └──────tarik───────┘
 *
 * Aturan bisnis: pemeriksa harus berperan Manajer dan tidak boleh memutuskan RAB miliknya sendiri
 * (pemisahan tugas); penolakan wajib disertai catatan; setiap transisi tercatat di audit_logs
 * dalam transaksi yang sama.
 */
const db = require("../db/db");
const { logAudit } = require("./audit");

const TRANSITIONS = {
  draft: ["diajukan"],
  diajukan: ["disetujui", "ditolak", "draft"],
  ditolak: ["diajukan"],
  disetujui: []
};
const EDITABLE_STATES = ["draft", "ditolak"];

class ApprovalError extends Error {
  constructor(message, httpStatus = 409) {
    super(message);
    this.httpStatus = httpStatus;
  }
}

function canTransition(from, to) {
  return (TRANSITIONS[from] || []).includes(to);
}

function isEditable(session) {
  return EDITABLE_STATES.includes(session.approval_status || "draft");
}

function assertEditable(session) {
  if (!isEditable(session)) {
    throw new ApprovalError(
      `RAB berstatus "${session.approval_status}" dan terkunci. Tarik pengajuan atau gunakan "Edit sebagai riwayat baru".`
    );
  }
}

function transition(session, to, actor, { note = null, ip = null, action, extraSql = "", extraParams = [] }) {
  const from = session.approval_status || "draft";
  if (!canTransition(from, to)) {
    throw new ApprovalError(`Transisi status dari "${from}" ke "${to}" tidak diizinkan.`);
  }
  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE sessions SET approval_status = ?, updated_at = datetime('now') ${extraSql} WHERE id = ?
    `).run(to, ...extraParams, session.id);
    logAudit({ actor, action, entityType: "session", entityId: session.id, from, to, note, ip });
  });
  tx();
  return db.prepare("SELECT * FROM sessions WHERE id = ?").get(session.id);
}

function submit(session, actor, ip) {
  if (session.user_id !== actor.id) throw new ApprovalError("Hanya pemilik RAB yang dapat mengajukan.", 403);
  const items = db.prepare("SELECT * FROM session_items WHERE session_id = ?").all(session.id);
  if (!items.length) throw new ApprovalError("Tabel rekomendasi masih kosong. Tambahkan minimal satu produk.", 400);
  const bad = items.find(it => !(it.qty > 0) || !String(it.nama || "").trim());
  if (bad) throw new ApprovalError("Setiap item wajib memiliki nama dan kuantitas lebih dari 0.", 400);
  const resubmit = session.approval_status === "ditolak";
  return transition(session, "diajukan", actor, {
    ip, action: resubmit ? "session.resubmit" : "session.submit",
    extraSql: ", submitted_at = datetime('now'), decided_by = NULL, decided_at = NULL, decision_note = NULL"
  });
}

function recall(session, actor, ip) {
  if (session.user_id !== actor.id) throw new ApprovalError("Hanya pemilik RAB yang dapat menarik pengajuan.", 403);
  return transition(session, "draft", actor, { ip, action: "session.recall" });
}

function decide(session, actor, decision, note, ip) {
  if (actor.role !== "manager") throw new ApprovalError("Hanya Manajer yang dapat memutuskan persetujuan.", 403);
  if (session.user_id === actor.id) throw new ApprovalError("Manajer tidak dapat memutuskan RAB miliknya sendiri.", 403);
  if (!["approve", "reject"].includes(decision)) throw new ApprovalError("decision harus 'approve' atau 'reject'.", 400);
  const cleanNote = note ? String(note).trim() : "";
  if (decision === "reject" && cleanNote.length < 5) {
    throw new ApprovalError("Penolakan wajib disertai catatan alasan (minimal 5 karakter).", 400);
  }
  const to = decision === "approve" ? "disetujui" : "ditolak";
  return transition(session, to, actor, {
    ip, note: cleanNote || null,
    action: decision === "approve" ? "session.approve" : "session.reject",
    extraSql: ", decided_by = ?, decided_at = datetime('now'), decision_note = ?",
    extraParams: [actor.id, cleanNote || null]
  });
}

module.exports = { TRANSITIONS, EDITABLE_STATES, ApprovalError, canTransition, isEditable, assertEditable, submit, recall, decide };
