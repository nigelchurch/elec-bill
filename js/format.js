// Display formatting helpers (rounding happens only here, never in stored data).

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Names as printed on the bill.
export const NAMES = { thip: 'Gaae&Thip', nova: 'Nig&Jop' };

// Today's date as 'YYYY-MM-DD' in the phone's local time zone.
export function todayISO() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// '2026-11-17' -> 'Tue 17 Nov' (or 'Tue 17 Nov 2026' with { year: true })
export function fmtDay(iso, { year = false } = {}) {
  const d = new Date(`${iso}T00:00:00Z`);
  const text = `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  return year ? `${text} ${d.getUTCFullYear()}` : text;
}

// 36431.2 -> '36,431'; fmtNum(4.311, 2) -> '4.31'
export const fmtNum = (x, dp = 0) =>
  x.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });

// Make text safe to insert into HTML (names contain '&').
export const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
