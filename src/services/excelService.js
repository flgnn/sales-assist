const path = require("path");
const ExcelJS = require("exceljs");

const TEMPLATE_PATH = path.join(__dirname, "..", "..", "data", "Template_SE.xlsx");
const CONTRACT_MONTHS = 12;
const COLS = ["B", "C", "D", "E", "F", "G", "H", "I", "J", "K"];

function cloneStyle(style) {
  return style ? JSON.parse(JSON.stringify(style)) : {};
}

// Tentukan apakah sebuah item termasuk CPE atau Connectivity.
// Prioritas: field `jenis_layanan` yang dipilih user (Connectivity / CPE) di layar rekomendasi.
// Kalau field itu kosong (data lama / belum diisi), fallback ke `periode` seperti sebelumnya.
function isCpeItem(it) {
  const jenis = (it.jenis_layanan || "").toString().trim().toLowerCase();
  if (jenis === "cpe") return true;
  if (jenis === "connectivity") return false;
  return it.periode === "Sekali bayar";
}

function computeTotals(items) {
  const connectivity = items.filter(it => !isCpeItem(it));
  const cpe = items.filter(it => isCpeItem(it));
  
  const connTotal = connectivity.reduce((s, it) => {
    const hargaNet = Math.max(0, (it.harga || 0) * (1 - (it.diskon_satuan || 0) / 100));
    const psbNet = Math.max(0, (it.psb || 0) * (1 - (it.diskon_psb || 0) / 100));
    const m = (it.periode_bulan != null) ? it.periode_bulan : CONTRACT_MONTHS;
    return s + (hargaNet * (it.qty || 0) * m) + (psbNet * (it.qty || 0));
  }, 0);
  
  const cpeTotal = cpe.reduce((s, it) => {
    const hargaNet = Math.max(0, (it.harga || 0) * (1 - (it.diskon_satuan || 0) / 100));
    const psbNet = Math.max(0, (it.psb || 0) * (1 - (it.diskon_psb || 0) / 100));
    return s + (hargaNet * (it.qty || 0)) + (psbNet * (it.qty || 0));
  }, 0);
  
  const subtotal = connTotal + cpeTotal;
  const ppn = subtotal * 0.11;
  const grand = subtotal + ppn;
  
  const grossSubtotal = items.reduce((s, it) => {
    const m = it.periode === "Bulanan" ? (it.periode_bulan || 12) : 1;
    return s + ((it.harga || 0) * m + (it.psb || 0)) * (it.qty || 0);
  }, 0);
  
  return { connectivity, cpe, connTotal, cpeTotal, subtotal, ppn, grand, CONTRACT_MONTHS, grossSubtotal };
}

/**
 * Mengisi Template SE asli (sheet "RAB SPH") dengan item-item RAB sebuah sesi.
 * Mengembalikan ExcelJS.Workbook siap ditulis ke stream/response.
 */
async function buildRabWorkbook({ customerName, items, rabMeta }) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(TEMPLATE_PATH);

  const ws = workbook.getWorksheet("RAB SPH");
  if (!ws) throw new Error('Sheet "RAB SPH" tidak ditemukan pada Template SE.');

  const titleCell = ws.getCell("B2");
  const custDisplay = (customerName && String(customerName).trim()) ? String(customerName).trim() : "[NAMA PELANGGAN]";
  // Judul selalu memakai nama pelanggan/perusahaan persis seperti yang diinput
  // (kalau memang diketik "PT ..." maka tampil "PT ...", kalau bukan PT ya tampil apa adanya).
  titleCell.value = `SPH CONNECTIVITY ${custDisplay} - TELKOM`;

  // Baris pembatas merah (B4:K4) di bawah judul diubah jadi putih polos.
  const dividerRow = ws.getRow(4);
  COLS.forEach(c => {
    dividerRow.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFFFF" } };
  });
  dividerRow.commit();

  const itemRowStyleCells = {}, totalRowStyleCells = {}, labelRowStyleCells = {}, grandRowStyleCells = {}, paguRowStyleCells = {};
  COLS.forEach(c => {
    itemRowStyleCells[c] = cloneStyle(ws.getCell(c + "10").style);
    totalRowStyleCells[c] = cloneStyle(ws.getCell(c + "12").style);
    labelRowStyleCells[c] = cloneStyle(ws.getCell(c + "9").style);
    grandRowStyleCells[c] = cloneStyle(ws.getCell(c + "16").style);
    paguRowStyleCells[c] = cloneStyle(ws.getCell(c + "20").style);
  });
  const rowHeightItem = ws.getRow(10).height;
  const rowHeightLabel = ws.getRow(9).height;

  const staleMerges = (ws.model.merges || []).filter(m => {
    const match = String(m).match(/[A-Z]+(\d+)/);
    return match && parseInt(match[1], 10) >= 9;
  });
  staleMerges.forEach(m => { try { ws.unMergeCells(m); } catch (e) { /* abaikan */ } });

  const CLEAR_UNTIL_ROW = 9 + Math.max(items.length, 2) * 2 + 20;
  for (let rn = 9; rn <= CLEAR_UNTIL_ROW; rn++) {
    const row = ws.getRow(rn);
    COLS.forEach(c => { row.getCell(c).value = null; });
  }

  function writeRow(rowNum, values, styleMap, height) {
    const row = ws.getRow(rowNum);
    COLS.forEach(c => {
      const cell = row.getCell(c);
      if (styleMap[c]) cell.style = cloneStyle(styleMap[c]);
      if (Object.prototype.hasOwnProperty.call(values, c)) cell.value = values[c];
    });
    if (height) row.height = height;
    row.commit();
    return row;
  }
  function mergeIfNeeded(range) { try { ws.mergeCells(range); } catch (e) { /* sudah merge */ } }

  const { connectivity, cpe, CONTRACT_MONTHS: CM } = computeTotals(items);
  let r = 9;

  writeRow(r, { B: "CONNECTIVITY" }, labelRowStyleCells, rowHeightLabel);
  mergeIfNeeded(`B${r}:K${r}`);
  r++;

  const connStart = r;
  const connItems = connectivity.length ? connectivity : [{ nama: "-", qty: 0, satuan: "-", harga: 0, psb: 0, diskon_psb: 0, diskon_satuan: 0, periode_bulan: 12, periode: "Bulanan" }];
  connItems.forEach((it, idx) => {
    const periodNumber = it.periode === "Bulanan" ? (it.periode_bulan != null ? it.periode_bulan : CM) : 1;
    const psbNet = Math.max(0, (it.psb || 0) * (1 - (it.diskon_psb || 0) / 100));
    const hargaNet = Math.max(0, (it.harga || 0) * (1 - (it.diskon_satuan || 0) / 100));
    writeRow(r, {
      B: idx + 1,
      C: it.nama,
      D: it.qty,
      E: it.satuan,
      F: periodNumber,
      G: psbNet,
      H: hargaNet,
      I: { formula: `D${r}*G${r}` },
      J: { formula: `D${r}*H${r}` },
      K: { formula: `I${r}+J${r}*F${r}` }
    }, itemRowStyleCells, rowHeightItem);
    r++;
  });
  const connEnd = r - 1;
  const connTotalRow = r;
  writeRow(r, {
    B: "TOTAL CONNECTIVITY",
    G: { formula: `SUM(G${connStart}:G${connEnd})` }, H: { formula: `SUM(H${connStart}:H${connEnd})` },
    I: { formula: `SUM(I${connStart}:I${connEnd})` }, J: { formula: `SUM(J${connStart}:J${connEnd})` },
    K: { formula: `SUM(K${connStart}:K${connEnd})` }
  }, totalRowStyleCells, rowHeightItem);
  mergeIfNeeded(`B${r}:F${r}`);
  r++;

  writeRow(r, { B: "CPE" }, labelRowStyleCells, rowHeightLabel);
  mergeIfNeeded(`B${r}:K${r}`);
  r++;

  const cpeStart = r;
  const cpeItemsArr = cpe.length ? cpe : [{ nama: "-", qty: 0, satuan: "-", harga: 0, psb: 0, diskon_psb: 0, diskon_satuan: 0, periode_bulan: 1, periode: "Sekali bayar" }];
  cpeItemsArr.forEach((it, idx) => {
    const periodNumber = it.periode === "Bulanan" ? (it.periode_bulan != null ? it.periode_bulan : CM) : 1;
    const psbNet = Math.max(0, (it.psb || 0) * (1 - (it.diskon_psb || 0) / 100));
    const hargaNet = Math.max(0, (it.harga || 0) * (1 - (it.diskon_satuan || 0) / 100));
    writeRow(r, {
      B: idx + 1,
      C: it.nama,
      D: it.qty,
      E: it.satuan,
      F: periodNumber,
      G: psbNet,
      H: hargaNet,
      I: { formula: `D${r}*G${r}` },
      J: { formula: `D${r}*H${r}` },
      K: { formula: `I${r}+J${r}*F${r}` }
    }, itemRowStyleCells, rowHeightItem);
    r++;
  });
  const cpeEnd = r - 1;
  const cpeTotalRow = r;
  writeRow(r, {
    B: "TOTAL CPE",
    G: { formula: `SUM(G${cpeStart}:G${cpeEnd})` }, H: { formula: `SUM(H${cpeStart}:H${cpeEnd})` },
    I: { formula: `SUM(I${cpeStart}:I${cpeEnd})` }, J: { formula: `SUM(J${cpeStart}:J${cpeEnd})` },
    K: { formula: `SUM(K${cpeStart}:K${cpeEnd})` }
  }, totalRowStyleCells, rowHeightItem);
  mergeIfNeeded(`B${r}:F${r}`);
  r++;

  const totalRow = r;
  writeRow(r, {
    B: "TOTAL",
    G: { formula: `G${cpeTotalRow}+G${connTotalRow}` }, H: { formula: `H${cpeTotalRow}+H${connTotalRow}` },
    I: { formula: `I${cpeTotalRow}+I${connTotalRow}` }, J: { formula: `J${cpeTotalRow}+J${connTotalRow}` },
    K: { formula: `K${cpeTotalRow}+K${connTotalRow}` }
  }, grandRowStyleCells);
  mergeIfNeeded(`B${r}:F${r}`);
  r++;

  const ppnRow = r;
  writeRow(r, {
    B: "PPN 11%",
    G: { formula: `11%*G${totalRow}` }, H: { formula: `11%*H${totalRow}` },
    I: { formula: `11%*I${totalRow}` }, J: { formula: `11%*J${totalRow}` }, K: { formula: `11%*K${totalRow}` }
  }, grandRowStyleCells);
  mergeIfNeeded(`B${r}:F${r}`);
  r++;

  const grandRow = r;
  writeRow(r, {
    B: "GRAND TOTAL",
    G: { formula: `SUM(G${totalRow}:G${ppnRow})` }, H: { formula: `SUM(H${totalRow}:H${ppnRow})` },
    I: { formula: `SUM(I${totalRow}:I${ppnRow})` }, J: { formula: `SUM(J${totalRow}:J${ppnRow})` },
    K: { formula: `SUM(K${totalRow}:K${ppnRow})` }
  }, grandRowStyleCells);
  mergeIfNeeded(`B${r}:F${r}`);
  r++;

  // Baris kosong pemisah antara GRAND TOTAL dan PAGU/SISA — pastikan putih polos,
  // jangan biarkan sisa warna merah/abu dari baris template sebelumnya.
  const blankSepRow = ws.getRow(r);
  COLS.forEach(c => {
    const cell = blankSepRow.getCell(c);
    cell.value = null;
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFFFF" } };
  });
  blankSepRow.commit();
  r++;

  const paguRow = r;
  // Tampilkan PAGU sebagai nilai budget pelanggan per bulan (sebelum PPN)
  const paguVal = (rabMeta && rabMeta.budget != null) ? Number(rabMeta.budget) || 0 : 0;
  writeRow(r, { J: "PAGU", K: paguVal }, paguRowStyleCells);
  r++;
  const sisaRow = r;
  // Hitung SISA per bulan: PAGU (per bulan) - (GRAND TOTAL kontrak dibagi CONTRACT_MONTHS)
  writeRow(r, { J: "SISA", K: { formula: `K${paguRow}-K${grandRow}/${CM}` } }, paguRowStyleCells);

  // Pastikan seluruh tabel (dari header CONNECTIVITY sampai baris SISA) punya
  // garis pembatas (border) lengkap di semua sisi, termasuk baris PAGU/SISA
  // yang di template aslinya tidak ada border-nya.
  const THIN = { style: "thin", color: { argb: "FF000000" } };
  for (let rn = 9; rn <= sisaRow; rn++) {
    const row = ws.getRow(rn);
    COLS.forEach(c => {
      const cell = row.getCell(c);
      cell.border = { top: THIN, left: THIN, bottom: THIN, right: THIN };
    });
    row.commit();
  }

  const wsInfo = workbook.addWorksheet("Ringkasan Sesi");
  wsInfo.columns = [{ width: 28 }, { width: 70 }];
  [
    ["Ringkasan Sesi Sales Assist", ""],
    ["Pelanggan", customerName],
    ["No. RAB", rabMeta.nomor || ""],
    ["Tanggal", rabMeta.tanggal || ""],
    ["Dibuat oleh API", "sales-assist-backend"]
  ].forEach(row => wsInfo.addRow(row));
  wsInfo.getRow(1).font = { bold: true, size: 13 };

  return workbook;
}

module.exports = { buildRabWorkbook, computeTotals, CONTRACT_MONTHS, isCpeItem };
