/**
 * Pengingat tindak lanjut pipeline. Pengingat selalu tersedia di dashboard (GET /api/pipeline/reminders);
 * bila REMINDER_EMAIL=1, penjadwal ini juga mengirim ringkasan email harian ke pemilik peluang.
 */
const db = require("../db/db");
const { sendPlainEmail } = require("./emailService");
const { todayWib } = require("./pipelineService");

async function runOnce() {
  const today = todayWib(0);
  const due = db.prepare(`
    SELECT o.id, o.owner_id, o.nama_pelanggan, o.next_followup_at, o.stage, u.email, u.name
    FROM opportunities o JOIN users u ON u.id = o.owner_id
    WHERE o.stage IN ('prospek','penawaran','negosiasi') AND o.next_followup_at IS NOT NULL AND o.next_followup_at <= ?
      AND u.email IS NOT NULL AND (o.reminder_sent_on IS NULL OR o.reminder_sent_on <> ?)
  `).all(today, today);

  const byOwner = new Map();
  due.forEach(o => { if (!byOwner.has(o.owner_id)) byOwner.set(o.owner_id, []); byOwner.get(o.owner_id).push(o); });

  let sent = 0;
  for (const [, list] of byOwner) {
    const text = `Halo ${list[0].name},\n\nTindak lanjut yang perlu dilakukan:\n` +
      list.map(o => ` - ${o.nama_pelanggan} (${o.stage}, jatuh tempo ${o.next_followup_at})`).join("\n") + "\n\nSales Assist 2.0";
    const r = await sendPlainEmail({ to: list[0].email, subject: `Pengingat tindak lanjut (${list.length} peluang)`, text });
    if (r.status !== "failed") {
      const mark = db.prepare("UPDATE opportunities SET reminder_sent_on = ? WHERE id = ?");
      list.forEach(o => mark.run(today, o.id));
      sent += 1;
    }
  }
  return { owners: byOwner.size, sent };
}

function start() {
  if (process.env.REMINDER_EMAIL !== "1") return null;
  const minutes = Math.max(5, parseInt(process.env.REMINDER_INTERVAL_MIN, 10) || 60);
  const timer = setInterval(() => runOnce().catch(err => console.error("[reminder]", err.message)), minutes * 60000);
  timer.unref();
  console.log(`[reminder] Penjadwal email aktif setiap ${minutes} menit.`);
  return timer;
}

module.exports = { start, runOnce };
