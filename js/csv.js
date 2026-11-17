// Backup file format (CSV), used by both Import and Export.
//
//   type,key,thip,nova,thip_est,nova_est,P,OP,H,total_baht
//   reading,2026-10-01,27891,43761,0,0,,,,
//   bill,2026-10,,,,,3840.3,1766.54,3529.1,39389.23
//
// The file contains only numbers, dates and fixed words, so no quoting/escaping
// is needed. That keeps the parser simple.

export const COLUMNS = ['type', 'key', 'thip', 'nova', 'thip_est', 'nova_est', 'P', 'OP', 'H', 'total_baht'];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;

// Blank -> null, otherwise a number (throws if it isn't one).
function num(text, what) {
  if (text === '') return null;
  const n = Number(text);
  if (!Number.isFinite(n)) throw new Error(`${what} is not a number: "${text}"`);
  return n;
}

// Parse backup CSV text into { readings: [...], bills: [...] } in the shape the
// database stores. Throws an Error listing the problems if the file is invalid.
export function parseBackup(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/); // strip BOM (Excel adds one)
  const header = lines[0].trim();
  if (header !== COLUMNS.join(',')) {
    throw new Error('This is not an Elec Bill backup file (the header row is wrong).');
  }

  const readings = [];
  const bills = [];
  const errors = [];
  const seen = new Set();

  lines.slice(1).forEach((line, i) => {
    if (line.trim() === '') return;
    const lineNo = i + 2;
    const cells = line.split(',').map((c) => c.trim());
    const row = Object.fromEntries(COLUMNS.map((c, k) => [c, cells[k] ?? '']));
    try {
      if (seen.has(row.type + row.key)) throw new Error(`duplicate ${row.type} ${row.key}`);
      seen.add(row.type + row.key);

      if (row.type === 'reading') {
        if (!DATE_RE.test(row.key)) throw new Error(`bad date "${row.key}"`);
        readings.push({
          date: row.key,
          thip: num(row.thip, 'thip'),
          nova: num(row.nova, 'nova'),
          thip_est: row.thip_est === '1',
          nova_est: row.nova_est === '1',
        });
      } else if (row.type === 'bill') {
        if (!MONTH_RE.test(row.key)) throw new Error(`bad month "${row.key}"`);
        bills.push({
          month: row.key,
          P: num(row.P, 'P'),
          OP: num(row.OP, 'OP'),
          H: num(row.H, 'H'),
          total_baht: num(row.total_baht, 'total_baht'),
        });
      } else {
        throw new Error(`unknown type "${row.type}"`);
      }
    } catch (err) {
      errors.push(`Line ${lineNo}: ${err.message}`);
    }
  });

  if (errors.length) {
    const shown = errors.slice(0, 10).join('\n');
    const more = errors.length > 10 ? `\n…and ${errors.length - 10} more` : '';
    throw new Error(`The file has errors:\n${shown}${more}`);
  }
  readings.sort((a, b) => a.date.localeCompare(b.date));
  bills.sort((a, b) => a.month.localeCompare(b.month));
  return { readings, bills };
}

// Turn database records back into backup CSV text (used by Export in step 7).
export function toBackupCSV(readings, bills) {
  const v = (x) => (x === null || x === undefined ? '' : String(x));
  const lines = [COLUMNS.join(',')];
  for (const r of readings) {
    lines.push(['reading', r.date, v(r.thip), v(r.nova), r.thip_est ? 1 : 0, r.nova_est ? 1 : 0, '', '', '', ''].join(','));
  }
  for (const b of bills) {
    lines.push(['bill', b.month, '', '', '', '', v(b.P), v(b.OP), v(b.H), v(b.total_baht)].join(','));
  }
  return lines.join('\n') + '\n';
}
