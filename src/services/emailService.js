/**
 * Pengiriman email penawaran (Nodemailer).
 *
 * Mode:
 *  - SMTP nyata bila SMTP_HOST/SMTP_USER/SMTP_PASS di-set (kredensial hanya dari environment).
 *  - Mode uji (default bila SMTP belum diset): pesan disusun penuh (termasuk lampiran PDF) tetapi TIDAK dikirim;
 *    status tercatat "simulated". Sesuai batasan proposal: demonstrasi memakai layanan uji, tidak terhubung
 *    ke infrastruktur produksi Telkom.
 *
 * Galat dikembalikan sebagai pesan ringkas tanpa kredensial SMTP.
 */
const nodemailer = require("nodemailer");

let cached = null;

function smtpConfigured() {
  const { SMTP_HOST, SMTP_USER, SMTP_PASS } = process.env;
  return !!(SMTP_HOST && SMTP_USER && SMTP_PASS);
}

function getTransport() {
  if (cached && cached.configured === smtpConfigured()) return cached;
  if (smtpConfigured()) {
    const port = Number(process.env.SMTP_PORT) || 587;
    cached = {
      configured: true,
      mode: "smtp",
      transporter: nodemailer.createTransport({
        host: process.env.SMTP_HOST, port, secure: port === 465,
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
        connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000
      })
    };
  } else {
    cached = { configured: false, mode: "test", transporter: nodemailer.createTransport({ jsonTransport: true }) };
  }
  return cached;
}

function resetTransport() { cached = null; }

function sanitizeError(err) {
  let msg = String((err && err.message) || err || "Gagal mengirim email.");
  [process.env.SMTP_PASS, process.env.SMTP_USER].filter(Boolean).forEach(secret => { msg = msg.split(secret).join("***"); });
  return msg.slice(0, 300);
}

/**
 * @returns {Promise<{status:'sent'|'simulated'|'failed', messageId?:string, error?:string, mode:string}>}
 */
async function sendQuotationEmail({ to, subject, text, pdfBuffer, filename, replyTo }) {
  const t = getTransport();
  try {
    const info = await t.transporter.sendMail({
      from: process.env.MAIL_FROM || process.env.SMTP_USER || "sales-assist@localhost",
      to, subject, text, replyTo,
      attachments: [{ filename, content: pdfBuffer, contentType: "application/pdf" }]
    });
    return { status: t.mode === "smtp" ? "sent" : "simulated", messageId: info.messageId || null, mode: t.mode };
  } catch (err) {
    return { status: "failed", error: sanitizeError(err), mode: t.mode };
  }
}

async function sendPlainEmail({ to, subject, text }) {
  const t = getTransport();
  try {
    const info = await t.transporter.sendMail({ from: process.env.MAIL_FROM || process.env.SMTP_USER || "sales-assist@localhost", to, subject, text });
    return { status: t.mode === "smtp" ? "sent" : "simulated", messageId: info.messageId || null, mode: t.mode };
  } catch (err) {
    return { status: "failed", error: sanitizeError(err), mode: t.mode };
  }
}

module.exports = { sendQuotationEmail, sendPlainEmail, smtpConfigured, resetTransport, sanitizeError };
