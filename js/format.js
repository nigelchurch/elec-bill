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
// A tiny nudge (1e-6) stops floating-point dust like 6.4999999999 rounding down.
export const fmtNum = (x, dp = 0) =>
  (x + Math.sign(x) * 1e-6).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });

// '2026-10' -> 'Oct 2026'
export const fmtMonth = (month) => `${MONTHS[+month.slice(5, 7) - 1]} ${month.slice(0, 4)}`;

// List of dates -> compact ranges: '18–30 Nov, 1 Dec' (dates must be sorted).
export function fmtDateRanges(dates) {
  const day = (iso) => new Date(`${iso}T00:00:00Z`);
  const label = (iso) => `${day(iso).getUTCDate()} ${MONTHS[day(iso).getUTCMonth()]}`;
  const parts = [];
  let start = 0;
  for (let i = 1; i <= dates.length; i++) {
    const consecutive = i < dates.length && day(dates[i]) - day(dates[i - 1]) === 86400000
      && dates[i].slice(0, 7) === dates[start].slice(0, 7);
    if (consecutive) continue;
    const a = dates[start];
    const b = dates[i - 1];
    parts.push(a === b ? label(a) : `${day(a).getUTCDate()}–${label(b)}`);
    start = i;
  }
  return parts.join(', ');
}

// Make text safe to insert into HTML (names contain '&').
export const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
