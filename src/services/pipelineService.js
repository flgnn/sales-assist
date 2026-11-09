/**
 * Pipeline penjualan: Prospek -> Penawaran -> Negosiasi -> Menang | Kalah.
 *
 * Definisi metrik (dokumentasi untuk F-12):
 *  - Peluang "terbuka"  : stage prospek, penawaran, negosiasi
 *  - Peluang "final"    : stage menang atau kalah (status akhir; tidak dapat diubah lagi)
 *  - Win rate           : menang / (menang + kalah), dihitung hanya dari peluang final; null bila belum ada
 *  - Nilai pipeline     : jumlah nilai peluang terbuka (dari total RAB bila tertaut, atau input manual)
 */
const db = require("../db/db");
const { logAudit } = require("./audit");
const { computeTotals } = require("./excelService");

const STAGES = ["prospek", "penawaran", "negosiasi", "menang", "kalah"];
const OPEN_STAGES = ["prospek", "penawaran", "negosiasi"];
const FINAL_STAGES = ["menang", "kalah"];
const TRANSITIONS = {
  prospek: ["penawaran", "kalah"],
  penawaran: ["negosiasi", "menang", "kalah"],
  negosiasi: ["penawaran", "menang", "kalah"],
  menang: [],
  kalah: []
};

class PipelineError extends Error {
  constructor(message, httpStatus = 400) { super(message); this.httpStatus = httpStatus; }
}

function todayWib(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }); // YYYY-MM-DD
}

function getOpportunity(id) {
  return db.prepare(`
    SELECT o.*, u.name AS owner_name FROM opportunities o JOIN users u ON u.id = o.owner_id WHERE o.id = ?
  `).get(id);
}

function createOpportunity(actor, data) {
  let nama = data.nama_pelanggan;
  let nilai = data.nilai;
  let sessionId = null;
  if (data.session_id) {
    const s = db.prepare("SELECT * FROM sessions WHERE id = ?").get(data.session_id);
    if (!s || s.user_id !== actor.id) throw new PipelineError("RAB tidak ditemukan.", 404);
    const dup = db.prepare("SELECT id FROM opportunities WHERE session_id = ?").get(s.id);
    if (dup) throw new PipelineError("RAB ini sudah tertaut pada peluang lain.", 409);
    sessionId = s.id;
    nama = nama || s.nama_pelanggan;
    if (nilai == null) {
      const items = db.prepare("SELECT * FROM session_items WHERE session_id = ?").all(s.id);
      nilai = Math.round(computeTotals(items).grand);
    }
  }
  if (!nama) throw new PipelineError("nama_pelanggan wajib diisi.");
  const tx = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO opportunities (owner_id, session_id, nama_pelanggan, judul, nilai, stage, next_followup_at, followup_note, notes)
      VALUES (?, ?, ?, ?, ?, 'prospek', ?, ?, ?)
    `).run(actor.id, sessionId, nama, data.judul || null, nilai || 0, data.next_followup_at || null, data.followup_note || null, data.notes || null);
    db.prepare("INSERT INTO opportunity_events (opportunity_id, from_stage, to_stage, note, actor_id) VALUES (?, NULL, 'prospek', ?, ?)")
      .run(info.lastInsertRowid, "Peluang dibuat", actor.id);
    logAudit({ actor, action: "opportunity.create", entityType: "opportunity", entityId: info.lastInsertRowid, to: "prospek", note: nama });
    return info.lastInsertRowid;
  });
  return getOpportunity(tx());
}

function changeStage(opp, actor, to, { note, lost_reason } = {}) {
  if (opp.owner_id !== actor.id) throw new PipelineError("Hanya pemilik peluang yang dapat mengubah tahap.", 403);
  if (!STAGES.includes(to)) throw new PipelineError("Tahap tidak dikenal.");
  if (!(TRANSITIONS[opp.stage] || []).includes(to)) {
    throw new PipelineError(`Perpindahan tahap dari "${opp.stage}" ke "${to}" tidak diizinkan.`, 409);
  }
  if (to === "kalah" && (!lost_reason || String(lost_reason).trim().length < 3)) {
    throw new PipelineError("Peluang yang kalah wajib memiliki alasan kalah.");
  }
  const isFinal = FINAL_STAGES.includes(to);
  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE opportunities SET stage = ?, lost_reason = ?, closed_at = ${isFinal ? "datetime('now')" : "NULL"},
        next_followup_at = ${isFinal ? "NULL" : "next_followup_at"}, updated_at = datetime('now')
      WHERE id = ?
    `).run(to, to === "kalah" ? String(lost_reason).trim() : null, opp.id);
    db.prepare("INSERT INTO opportunity_events (opportunity_id, from_stage, to_stage, note, actor_id) VALUES (?, ?, ?, ?, ?)")
      .run(opp.id, opp.stage, to, to === "kalah" ? `Alasan kalah: ${String(lost_reason).trim()}` : (note || null), actor.id);
    logAudit({ actor, action: "opportunity.stage", entityType: "opportunity", entityId: opp.id, from: opp.stage, to, note: to === "kalah" ? lost_reason : note });
  });
  tx();
  return getOpportunity(opp.id);
}

/** Dipanggil saat penawaran terkirim: peluang tertaut yang masih "prospek" naik ke "penawaran". */
function onQuotationSent(sessionId, actor) {
  const opp = db.prepare("SELECT * FROM opportunities WHERE session_id = ?").get(sessionId);
  if (opp && opp.stage === "prospek" && opp.owner_id === actor.id) {
    return changeStage(opp, actor, "penawaran", { note: "Otomatis: penawaran dikirim ke pelanggan" });
  }
  return null;
}

function scopeWhere(user, filters = {}) {
  const where = [];
  const params = [];
  const seeAll = user.role === "manager" || user.role === "admin";
  if (!seeAll) { where.push("o.owner_id = ?"); params.push(user.id); }
  else if (filters.owner_id) { where.push("o.owner_id = ?"); params.push(Number(filters.owner_id)); }
  if (filters.stage && STAGES.includes(filters.stage)) { where.push("o.stage = ?"); params.push(filters.stage); }
  if (filters.from) { where.push("date(o.created_at) >= date(?)"); params.push(filters.from); }
  if (filters.to) { where.push("date(o.created_at) <= date(?)"); params.push(filters.to); }
  if (filters.q) { where.push("(o.nama_pelanggan LIKE ? OR o.judul LIKE ?)"); params.push(`%${filters.q}%`, `%${filters.q}%`); }
  return { clause: where.length ? "WHERE " + where.join(" AND ") : "", params };
}

function listOpportunities(user, filters = {}) {
  const { clause, params } = scopeWhere(user, filters);
  return db.prepare(`
    SELECT o.*, u.name AS owner_name FROM opportunities o JOIN users u ON u.id = o.owner_id
    ${clause} ORDER BY o.updated_at DESC, o.id DESC LIMIT 500
  `).all(...params);
}

function summary(user, filters = {}) {
  const { clause, params } = scopeWhere(user, { ...filters, stage: undefined, q: undefined });
  const rows = db.prepare(`SELECT o.stage, COUNT(*) c, COALESCE(SUM(o.nilai),0) v FROM opportunities o ${clause} GROUP BY o.stage`).all(...params);
  const byStage = {};
  STAGES.forEach(s => { byStage[s] = { count: 0, value: 0 }; });
  rows.forEach(r => { byStage[r.stage] = { count: r.c, value: r.v }; });

  const won = byStage.menang, lost = byStage.kalah;
  const finalCount = won.count + lost.count;
  const finalValue = won.value + lost.value;
  const open = OPEN_STAGES.reduce((a, s) => ({ count: a.count + byStage[s].count, value: a.value + byStage[s].value }), { count: 0, value: 0 });

  const lostWhere = clause ? clause + " AND o.stage = 'kalah'" : "WHERE o.stage = 'kalah'";
  const lostReasons = db.prepare(`
    SELECT COALESCE(NULLIF(TRIM(o.lost_reason), ''), '(tanpa alasan)') AS reason, COUNT(*) c, COALESCE(SUM(o.nilai),0) v
    FROM opportunities o ${lostWhere} GROUP BY reason ORDER BY c DESC
  `).all(...params);

  return {
    by_stage: byStage,
    open_count: open.count,
    open_value: open.value,
    won_count: won.count, won_value: won.value,
    lost_count: lost.count, lost_value: lost.value,
    win_rate: finalCount ? won.count / finalCount : null,
    win_rate_value: finalValue ? won.value / finalValue : null,
    lost_reasons: lostReasons,
    definisi: "Win rate = menang / (menang + kalah) dari peluang yang dibuat pada rentang tanggal terpilih dan sudah berstatus final."
  };
}

function reminders(user, days = 7) {
  const { clause, params } = scopeWhere(user, {});
  const today = todayWib(0), until = todayWib(days);
  const open = db.prepare(`
    SELECT o.*, u.name AS owner_name FROM opportunities o JOIN users u ON u.id = o.owner_id
    ${clause ? clause + " AND" : "WHERE"} o.stage IN ('prospek','penawaran','negosiasi') AND o.next_followup_at IS NOT NULL AND o.next_followup_at <= ?
    ORDER BY o.next_followup_at ASC
  `).all(...params, until);
  return {
    today, until,
    overdue: open.filter(o => o.next_followup_at < today),
    today_due: open.filter(o => o.next_followup_at === today),
    upcoming: open.filter(o => o.next_followup_at > today)
  };
}

module.exports = {
  STAGES, OPEN_STAGES, FINAL_STAGES, TRANSITIONS, PipelineError, todayWib,
  getOpportunity, createOpportunity, changeStage, onQuotationSent, listOpportunities, summary, reminders
};
