// Builds the monthly bill PDF, replicating the owner's Excel layout
// (ElecBillOct2026.pdf). All positions are in points (1/72 inch) on A4 portrait
// and were measured from the reference PDF.
//
// jsPDF is passed in rather than imported, so this module works both in the app
// (where lib/jspdf.umd.min.js is loaded as a plain script) and in Node tools.

import { last4 } from './calc.js';
import { MONTHS, DAYS, fmtNum } from './format.js';

const BLUE = '#2f5495';      // header bar
const LINE_BLUE = '#4472c3'; // vertical divider
const GREEN = '#e2efda';     // "from bill" input values
const PINK = '#efaaaa';      // fill of the A / B / Boy&Yui boxes
const RED = '#ff5050';       // border of those boxes
const GREY = '#bcbcbc';      // small A / B label boxes
const EST = '#8a8a8a';       // estimated values: grey italics

// Body text size. The reference uses 9.6 pt Calibri; Helvetica (built into every
// PDF reader, so nothing to embed) is wider, and 8.8 pt matches Calibri's widths.
const SIZE = 8.8;
const PITCH = 12.47;         // row spacing
const BASE = 9.1;            // baseline below the top of a 9.6 pt line (as measured)

// Right edges of the table columns.
const COL = {
  day: 164.8, thip: 283.3, nova: 342.6,          // readings side
  boyYui: 420.3, thipUse: 480.9, novaUse: 541.5, // usage side
};

// Text helper. y is the TOP of the line (as measured), not the baseline.
function text(doc, str, x, y, { bold = false, italic = false, right = false, color = '#000000', size = SIZE } = {}) {
  const style = bold && italic ? 'bolditalic' : bold ? 'bold' : italic ? 'italic' : 'normal';
  doc.setFont('helvetica', style);
  doc.setFontSize(size);
  doc.setTextColor(color);
  doc.text(String(str), x, y + BASE * (size / 9.6), { align: right ? 'right' : 'left' });
}

function fill(doc, color, x0, y0, x1, y1) {
  doc.setFillColor(color);
  doc.rect(x0, y0, x1 - x0, y1 - y0, 'F');
}

function box(doc, color, width, x0, y0, x1, y1) {
  doc.setDrawColor(color);
  doc.setLineWidth(width);
  doc.rect(x0, y0, x1 - x0, y1 - y0, 'S');
}

// bill = { month: 'YYYY-MM', P, OP, H, totalBill,
//          split: { totalUnits, rate, A, B, boyYui }, thipUnits, novaUnits,
//          rows: billRows(...) }
// Returns a jsPDF document; call doc.output('blob') to get the file.
export function buildBillPdf(jsPDF, bill) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait' });
  const [yyyy, mm] = bill.month.split('-');
  const monthName = MONTHS[+mm - 1];
  doc.setProperties({ title: `Electricity Bill ${monthName} ${yyyy}` });

  // ---- Title, bold and underlined ----
  const title = 'Electricity Bill Breakdown';
  text(doc, title, 69.2, 55.1, { bold: true, size: 19 });
  fill(doc, '#000000', 69.2, 77.3, 69.2 + doc.getTextWidth(title), 78.6);

  // ---- Bill inputs ----
  fill(doc, GREEN, 112.7, 118.8, 166.7, 155.8);   // P / OP / H values
  fill(doc, GREEN, 112.7, 182.4, 166.7, 195.0);   // Total Bill value
  fill(doc, '#000000', 112.7, 155.8, 166.7, 156.5); // double underline above TOTAL
  fill(doc, '#000000', 112.7, 157.3, 166.7, 158.0);

  text(doc, 'DATE:', 67.9, 94.2, { bold: true });
  text(doc, `${monthName}-${yyyy.slice(2)}`, 136.3, 94.2);

  const inputs = [['P:', bill.P, 119.1], ['OP:', bill.OP, 131.6], ['H:', bill.H, 144.0]];
  for (const [label, value, y] of inputs) {
    text(doc, label, 67.9, y, { bold: true });
    text(doc, fmtNum(value, 2), 164.7, y, { right: true });
    text(doc, 'kWHrs', 168.4, y);
    text(doc, 'from bill', 227.6, y);
  }
  text(doc, 'TOTAL:', 67.9, 157.8, { bold: true });
  text(doc, fmtNum(bill.split.totalUnits, 2), 164.7, 157.8, { right: true });
  text(doc, 'kWHrs', 168.4, 157.8);

  text(doc, 'Total Bill:', 67.9, 182.7, { bold: true });
  text(doc, fmtNum(bill.totalBill, 2), 164.6, 182.7, { right: true });
  text(doc, 'Baht', 168.4, 182.7);
  text(doc, 'from bill', 227.6, 182.7);

  text(doc, 'Dom rate:', 67.9, 207.7, { bold: true });
  text(doc, fmtNum(bill.split.rate, 2), 164.7, 207.7, { right: true });
  text(doc, 'Baht/kWHr', 168.4, 207.7);

  // ---- Section headings and the blue header bar ----
  text(doc, 'READING FROM POLE BETWEEN 0900 and 1100 DAILY (kWHrs):', 67.9, 232.7, { bold: true });
  text(doc, 'CALCULATED DAILY USAGE (kWHrs):', 363.4, 232.7, { bold: true });

  fill(doc, BLUE, 66.1, 257.3, 345.5, 269.9);
  fill(doc, BLUE, 361.6, 257.3, 543.5, 269.9);
  const head = { bold: true, right: true, color: '#ffffff' };
  text(doc, 'Gaae&Thip', COL.thip, 257.6, head);
  text(doc, 'Nig&Jop', COL.nova, 257.6, head);
  text(doc, 'Boy&Yui', COL.boyYui, 257.6, head);
  text(doc, 'Gaae&Thip', COL.thipUse, 257.6, head);
  text(doc, 'Nig&Jop', COL.novaUse, 257.6, head);

  // ---- One row per day (estimated values in grey italics) ----
  const top = 282.6;
  bill.rows.forEach((r, i) => {
    const y = top + i * PITCH;
    const d = new Date(`${r.date}T00:00:00Z`);
    text(doc, `${String(d.getUTCDate()).padStart(2, '0')} ${MONTHS[d.getUTCMonth()]}`, 85.2, y);
    text(doc, DAYS[d.getUTCDay()], COL.day, y, { right: true });
    const est = (flag) => ({ right: true, italic: flag, color: flag ? EST : '#000000' });
    if (r.thip !== null) text(doc, last4(r.thip), COL.thip, y, est(r.thip_est));
    if (r.nova !== null) text(doc, last4(r.nova), COL.nova, y, est(r.nova_est));
    if (r.thipUse !== null) text(doc, fmtNum(r.thipUse), COL.thipUse, y, est(r.thipUseEst));
    if (r.novaUse !== null) text(doc, fmtNum(r.novaUse), COL.novaUse, y, est(r.novaUseEst));
  });
  const lastRowBottom = top + (bill.rows.length - 1) * PITCH + 11.9;
  doc.setDrawColor(LINE_BLUE);
  doc.setLineWidth(1.2);
  doc.line(353, 277.1, 353, lastRowBottom);

  // Small key under the table, since italics are new compared with the Excel version.
  if (bill.rows.some((r) => r.thip_est || r.nova_est)) {
    text(doc, 'Grey italic = estimated (no reading taken that day)', 85.2, lastRowBottom + 2.5,
      { italic: true, size: 7.5, color: EST });
  }

  // ---- Footer: totals and the split ----
  const f = top + (bill.rows.length + 1) * PITCH;  // first footer line (681.9 for 31 days)
  text(doc, 'Total kWHrs used:', 342.6, f, { right: true });
  text(doc, fmtNum(bill.thipUnits), COL.thipUse, f, { right: true });
  text(doc, fmtNum(bill.novaUnits), COL.novaUse, f, { right: true });

  text(doc, 'Average rate/kWHr:', 342.6, f + 12.4, { right: true });
  text(doc, fmtNum(bill.split.rate, 2), COL.thipUse, f + 12.4, { right: true });
  text(doc, fmtNum(bill.split.rate, 2), COL.novaUse, f + 12.4, { right: true });

  // A and B boxes
  const ys = f + 26.1;
  fill(doc, PINK, 422.2, ys - 0.8, 543.5, ys + 13.0);
  box(doc, RED, 2.3, 422.25, ys - 0.75, 482.85, ys + 12.9);
  box(doc, RED, 2.3, 482.85, ys - 0.75, 543.45, ys + 12.9);
  box(doc, GREY, 0.6, 424.0, ys + 0.6, 437.2, ys + 11.4);
  box(doc, GREY, 0.6, 485.0, ys + 0.6, 498.2, ys + 11.4);
  text(doc, 'A', 427.6, ys + 1.3, { size: 8 });
  text(doc, 'B', 488.6, ys + 1.3, { size: 8 });
  text(doc, 'Split bill to pay:', 342.7, ys, { right: true });
  text(doc, fmtNum(bill.split.A), COL.thipUse, ys, { right: true, bold: true, color: '#ffffff' });
  text(doc, fmtNum(bill.split.B), COL.novaUse, ys, { right: true, bold: true, color: '#ffffff' });

  text(doc, 'Total Bill:', 342.7, f + 39.9, { right: true });
  text(doc, fmtNum(bill.totalBill, 2), 420.2, f + 39.9, { right: true });
  text(doc, 'Minus A and B:', 342.6, f + 52.2, { right: true });
  text(doc, fmtNum(bill.split.A + bill.split.B), 420.2, f + 52.2, { right: true });

  // Boy&Yui box
  const yb = f + 65.9;
  fill(doc, PINK, 361.6, yb - 0.8, 422.3, yb + 13.0);
  box(doc, RED, 2.3, 361.65, yb - 0.75, 422.25, yb + 12.9);
  text(doc, 'Boy&Yui:', 342.6, yb, { right: true });
  text(doc, fmtNum(bill.split.boyYui), COL.boyYui, yb, { right: true, bold: true, color: '#ffffff' });

  return doc;
}

// 'ElecBillOct2026.pdf'
export const pdfFilename = (month) => `ElecBill${MONTHS[+month.slice(5, 7) - 1]}${month.slice(0, 4)}.pdf`;
