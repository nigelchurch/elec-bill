// Build a bill PDF in Node (no browser) from data/initial-import.csv, to check
// the layout against the reference ElecBillOct2026.pdf.
//
//   node tools/make_test_pdf.mjs [YYYY-MM P OP H TotalBill]
// Defaults to the October 2026 acceptance-test figures.
// Writes data/test-ElecBillMmmYYYY.pdf (git ignores /data).

import fs from 'node:fs';
import { createRequire } from 'node:module';
import { parseBackup } from '../js/csv.js';
import { indexByDate, monthUsage, billSplit, billRows } from '../js/calc.js';
import { buildBillPdf, pdfFilename } from '../js/pdf.js';

const require = createRequire(import.meta.url);
const { jsPDF } = require('../lib/jspdf.umd.min.js'); // the same file the app uses

const [month = '2026-10', P = 3840.30, OP = 1766.54, H = 3529.10, totalBill = 39389.23] = process.argv.slice(2);
const csv = new URL('../data/initial-import.csv', import.meta.url);
const { readings } = parseBackup(fs.readFileSync(csv, 'utf8'));
const byDate = indexByDate(readings);

const usage = monthUsage(byDate, month);
if (usage.missing.length) {
  console.error('Missing readings:', usage.missing.join(', '));
  process.exit(1);
}
const nums = { P: +P, OP: +OP, H: +H, totalBill: +totalBill };
const split = billSplit({ ...nums, ...usage });
const doc = buildBillPdf(jsPDF, { month, ...nums, ...usage, split, rows: billRows(byDate, month) });

const out = new URL(`../data/test-${pdfFilename(month)}`, import.meta.url);
fs.writeFileSync(out, Buffer.from(doc.output('arraybuffer')));
console.log('wrote', out.pathname, `A=${split.A.toFixed(0)} B=${split.B.toFixed(0)} Boy&Yui=${split.boyYui.toFixed(0)}`);
