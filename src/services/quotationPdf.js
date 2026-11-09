/**
 * Dokumen penawaran (SPH) PDF — dibuat dengan PDFKit, tanpa Chromium/HTML.
 * Angka memakai computeTotals() yang sama dengan Excel agar PDF, Excel, dan layar selalu konsisten.
 */
const path = require("path");
const fs = require("fs");
const PDFDocument = require("pdfkit");
const { computeTotals, isCpeItem, CONTRACT_MONTHS } = require("./excelService");

// Logo versi kecil khusus PDF: logo asli 3348x2278 px membuat pembuatan PDF memakan CPU berat (hasil uji beban).
const LOGO_PATH = path.join(__dirname, "..", "..", "public", "assets", "telkom-logo-pdf.png");
const LOGO_BUFFER = fs.existsSync(LOGO_PATH) ? fs.readFileSync(LOGO_PATH) : null;
const RED = "#E23744";
const INK = "#1B1D21";
const SOFT = "#5B5F66";
const LINE = "#E7E8EB";

const rp = (n) => "Rp " + Math.round(n || 0).toLocaleString("id-ID");

function lineAmount(it) {
  const hargaNet = Math.max(0, (it.harga || 0) * (1 - (it.diskon_satuan || 0) / 100));
  const psbNet = Math.max(0, (it.psb || 0) * (1 - (it.diskon_psb || 0) / 100));
  const months = isCpeItem(it) ? 1 : (it.periode_bulan != null ? it.periode_bulan : CONTRACT_MONTHS);
  return { hargaNet, psbNet, months, total: hargaNet * (it.qty || 0) * months + psbNet * (it.qty || 0) };
}

function validUntil(days) {
  const d = new Date(Date.now() + days * 86400000);
  return d.toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta", day: "2-digit", month: "long", year: "numeric" });
}

/**
 * @returns {Promise<Buffer>}
 */
function buildQuotationPdf({ session, items, sales, approver }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 40, info: { Title: `SPH ${session.nama_pelanggan}`, Author: "Sales Assist 2.0 — Telkom Witel Priangan Timur" } });
    const chunks = [];
    doc.on("data", c => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const totals = computeTotals(items);
    const isFinal = session.approval_status === "disetujui" && !!session.rab_nomor;
    const left = doc.page.margins.left;
    const width = doc.page.width - left - doc.page.margins.right;

    const watermark = () => {
      if (isFinal) return;
      doc.save();
      doc.rotate(-30, { origin: [doc.page.width / 2, doc.page.height / 2] });
      doc.fillColor("#000000").opacity(0.07).fontSize(70).font("Helvetica-Bold")
        .text("DRAFT", 0, doc.page.height / 2 - 40, { width: doc.page.width, align: "center" });
      doc.restore();
      doc.opacity(1);
    };
    doc.on("pageAdded", watermark);
    watermark();

    // Kop
    if (LOGO_BUFFER) doc.image(LOGO_BUFFER, left, 36, { height: 38 });
    doc.fillColor(INK).font("Helvetica-Bold").fontSize(12).text("PT Telkom Indonesia (Persero) Tbk", left, 38, { width, align: "right" });
    doc.font("Helvetica").fontSize(9).fillColor(SOFT)
      .text(`Witel ${String(session.witel || "Priangan Timur").replace(/^Witel\s+/i, "")}`, left, 53, { width, align: "right" })
      .text("Jln. Raden Adipati Aria Wiratatuningrat No. 14C, Tasikmalaya", left, 65, { width, align: "right" });
    doc.moveTo(left, 88).lineTo(left + width, 88).lineWidth(2).strokeColor(RED).stroke();

    // Judul + meta
    doc.fillColor(INK).font("Helvetica-Bold").fontSize(15).text("SURAT PENAWARAN HARGA (SPH)", left, 102, { width, align: "center" });
    doc.font("Helvetica").fontSize(9.5).fillColor(INK);
    const meta = [
      ["Nomor", session.rab_nomor || "(belum diterbitkan)"],
      ["Tanggal", session.rab_tanggal || new Date().toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta", day: "2-digit", month: "long", year: "numeric" })],
      ["Kepada Yth.", session.nama_pelanggan],
      ["Industri", session.industri || "-"],
      ["Perihal", "Penawaran layanan konektivitas dan solusi digital Telkom"]
    ];
    let y = 128;
    meta.forEach(([k, v]) => {
      doc.fillColor(SOFT).text(k, left, y, { width: 80 });
      doc.fillColor(INK).text(": " + v, left + 80, y, { width: width - 80 });
      y += 14;
    });

    y += 6;
    doc.fillColor(INK).fontSize(9.5).text(
      "Dengan hormat, bersama ini kami sampaikan penawaran harga layanan Telkom sesuai kebutuhan Bapak/Ibu sebagaimana rincian berikut:",
      left, y, { width }
    );
    y = doc.y + 8;

    // Tabel
    const cols = [
      { h: "No", w: 24, a: "center" },
      { h: "Layanan", w: 190, a: "left" },
      { h: "Qty", w: 32, a: "center" },
      { h: "Harga/bln", w: 72, a: "right" },
      { h: "PSB", w: 60, a: "right" },
      { h: "Bln", w: 28, a: "center" },
      { h: "Jumlah", w: 109, a: "right" }
    ];
    const drawHeader = (yy) => {
      doc.rect(left, yy, width, 20).fill(RED);
      let x = left;
      doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(8.5);
      cols.forEach(c => { doc.text(c.h, x + 4, yy + 6, { width: c.w - 8, align: c.a }); x += c.w; });
      return yy + 20;
    };
    y = drawHeader(y);

    items.forEach((it, idx) => {
      const a = lineAmount(it);
      const name = it.nama + (it.lokasi ? ` — ${it.lokasi}` : "");
      doc.font("Helvetica").fontSize(8.5);
      const h = Math.max(20, doc.heightOfString(name, { width: cols[1].w - 8 }) + 10);
      if (y + h > doc.page.height - 150) { doc.addPage(); y = drawHeader(doc.page.margins.top); }
      if (idx % 2 === 1) doc.rect(left, y, width, h).fill("#F7F7F8");
      let x = left;
      doc.fillColor(INK);
      const cells = [String(idx + 1), name, String(it.qty || 0), rp(a.hargaNet), rp(a.psbNet), isCpeItem(it) ? "-" : String(a.months), rp(a.total)];
      cells.forEach((v, i) => { doc.text(v, x + 4, y + 5, { width: cols[i].w - 8, align: cols[i].a }); x += cols[i].w; });
      doc.moveTo(left, y + h).lineTo(left + width, y + h).lineWidth(0.5).strokeColor(LINE).stroke();
      y += h;
    });

    // Total
    if (y + 90 > doc.page.height - 120) { doc.addPage(); y = doc.page.margins.top; }
    y += 8;
    const boxX = left + width - 230;
    [["Subtotal", totals.subtotal], ["PPN 11%", totals.ppn]].forEach(([k, v]) => {
      doc.font("Helvetica").fontSize(9.5).fillColor(SOFT).text(k, boxX, y, { width: 100 });
      doc.fillColor(INK).text(rp(v), boxX + 100, y, { width: 130, align: "right" });
      y += 15;
    });
    doc.rect(boxX - 6, y - 2, 242, 22).fill("#FDECEE");
    doc.font("Helvetica-Bold").fontSize(10.5).fillColor(RED).text("TOTAL", boxX, y + 3, { width: 100 });
    doc.text(rp(totals.grand), boxX + 100, y + 3, { width: 130, align: "right" });
    y += 34;

    // Ketentuan
    const days = parseInt(process.env.QUOTATION_VALID_DAYS, 10) || 30;
    doc.font("Helvetica-Bold").fontSize(9.5).fillColor(INK).text("Ketentuan", left, y);
    doc.font("Helvetica").fontSize(8.5).fillColor(SOFT);
    const terms = [
      `Penawaran berlaku sampai ${validUntil(days)} (${days} hari sejak diterbitkan).`,
      "Harga sudah termasuk PPN 11% sebagaimana tertera pada total; biaya PSB bersifat sekali bayar.",
      "Harga dan ketersediaan layanan mengikuti Rekap Harga Layanan Telkom yang berlaku saat penawaran dibuat."
    ];
    y = doc.y + 3;
    terms.forEach((t, i) => { doc.text(`${i + 1}. ${t}`, left, y, { width }); y = doc.y + 2; });

    // Tanda tangan
    if (y + 90 > doc.page.height - 50) { doc.addPage(); y = doc.page.margins.top; }
    y += 14;
    doc.fillColor(INK).font("Helvetica").fontSize(9.5);
    doc.text("Hormat kami,", left, y);
    doc.text("Disetujui oleh,", left + width / 2, y);
    doc.font("Helvetica-Bold");
    doc.text(sales ? sales.name : "-", left, y + 52);
    doc.text(isFinal && approver ? approver.name : "(menunggu persetujuan)", left + width / 2, y + 52);
    doc.font("Helvetica").fillColor(SOFT).fontSize(8.5);
    doc.text("Sales Telkom Witel Priangan Timur", left, y + 65);
    doc.text(isFinal && approver ? "Manajer Telkom Witel Priangan Timur" : "", left + width / 2, y + 65);

    doc.end();
  });
}

module.exports = { buildQuotationPdf, lineAmount };
