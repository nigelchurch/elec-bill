// Calculation module: pure functions only (no screen, no database), so each can
// be tested on its own with `node --test`.
//
// Data shapes used throughout:
//   reading record  { date: 'YYYY-MM-DD', thip, nova, thip_est, nova_est }
//                   thip/nova = full meter value (number) or null if absent.
//   meter           'thip' | 'nova'
//   byDate          Map 'YYYY-MM-DD' -> reading record (see indexByDate)

// ---------- Tunable constants ----------

export const SANITY = {
  MAX_DAILY_KWH: 150,   // above this average kWh/day is surely a typo or false rollover
  MEDIAN_FACTOR: 3,     // flag if daily usage > FACTOR × median + OFFSET
  MEDIAN_OFFSET: 10,
  MEDIAN_DAYS: 14,      // how many recent real daily usages the median uses
};

export const METERS = ['thip', 'nova'];

// ---------- Dates ----------
// Dates are 'YYYY-MM-DD' strings. Arithmetic is done in UTC so that daylight
// saving changes (on a PC set to another time zone) can't shift a day.

const toUTC = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
const fromUTC = (ms) => new Date(ms).toISOString().slice(0, 10);
const DAY_MS = 86400000;

export const addDays = (iso, n) => fromUTC(toUTC(iso) + n * DAY_MS);
export const daysBetween = (a, b) => Math.round((toUTC(b) - toUTC(a)) / DAY_MS); // b − a

// 'YYYY-MM' -> ['YYYY-MM-01', …, last day of month]
export function daysInMonth(month) {
  const first = `${month}-01`;
  const out = [];
  for (let d = first; d.startsWith(month); d = addDays(d, 1)) out.push(d);
  return out;
}

// 'YYYY-MM' of the month after the given one.
export const nextMonth = (month) => addDays(`${month}-28`, 7).slice(0, 7);

// ---------- Readings ----------

export const indexByDate = (readings) => new Map(readings.map((r) => [r.date, r]));

// Convert the 4 digits typed by the user into the full cumulative meter value.
// The meter only ever goes up, so if the 4 digits are lower than the last 4
// digits of the previous value, the meter has rolled past a multiple of 10,000.
//   rollover(28074, 75)   -> 30075   (implausible, caught by the sanity check)
//   rollover(39995, 12)   -> 40012
export function rollover(prevFull, entered4) {
  if (prevFull === null || prevFull === undefined) return entered4; // first ever reading
  const base = Math.floor(prevFull / 10000) * 10000;
  let full = base + entered4;
  if (full < prevFull) full += 10000;
  return full;
}

// Most recent record before `date` that has a value for `meter` (or null).
export function previousReading(readings, meter, date) {
  let best = null;
  for (const r of readings) {
    if (r.date < date && r[meter] !== null && r[meter] !== undefined) {
      if (!best || r.date > best.date) best = r;
    }
  }
  return best;
}

// Earliest record after `date` with a real (non-estimated) value for `meter` (or null).
// Used when logging a past date: the new value must not exceed it.
export function nextRealReading(readings, meter, date) {
  let best = null;
  for (const r of readings) {
    if (r.date > date && r[meter] !== null && r[meter] !== undefined && !r[meter + '_est']) {
      if (!best || r.date < best.date) best = r;
    }
  }
  return best;
}

// Linear interpolation for the dates strictly between two readings.
// Returns [{ date, value }] for each missing day (empty if the dates are adjacent).
export function interpolate(fromDate, fromValue, toDate, toValue) {
  const days = daysBetween(fromDate, toDate);
  const step = (toValue - fromValue) / days;
  const out = [];
  for (let i = 1; i < days; i++) out.push({ date: addDays(fromDate, i), value: fromValue + step * i });
  return out;
}

// Record a real reading and gap-fill as needed. Returns the list of records to
// save (new or changed); `readings` itself is not modified.
//   - The record for `date` gets the value, marked as real.
//   - Missing days between the previous reading and `date` are filled with
//     interpolated values marked estimated.
//   - Any estimated run directly before or after `date` is re-interpolated, so
//     entering (or editing) a real value in the middle of a gap fixes both sides.
export function applyReading(readings, meter, date, full) {
  const byDate = indexByDate(readings);
  const changed = new Map(); // date -> updated copy of record
  const rec = (d) => changed.get(d) || { ...(byDate.get(d) || blankRecord(d)) };
  const set = (d, value, est) => {
    const r = rec(d);
    r[meter] = value;
    r[meter + '_est'] = est;
    changed.set(d, r);
  };

  set(date, full, false);

  // Fill missing days back to the previous reading (with placeholders; values come below).
  const prev = previousReading(readings, meter, date);
  if (prev) {
    for (let d = addDays(prev.date, 1); d < date; d = addDays(d, 1)) {
      const r = byDate.get(d);
      if (!r || r[meter] === null || r[meter] === undefined) set(d, 0, true);
    }
  }

  // Re-interpolate the estimated runs touching `date` on each side.
  const value = (d) => (changed.get(d) || byDate.get(d))?.[meter];
  const isEst = (d) => {
    const r = changed.get(d) || byDate.get(d);
    return !!r && r[meter] !== null && r[meter] !== undefined && r[meter + '_est'];
  };
  for (const dir of [-1, 1]) {
    let d = addDays(date, dir);
    const run = [];
    while (isEst(d)) { run.push(d); d = addDays(d, dir); }
    const anchor = value(d);
    if (run.length && anchor !== null && anchor !== undefined) {
      const [a, b] = dir < 0 ? [d, date] : [date, d];
      for (const { date: dd, value: v } of interpolate(a, value(a), b, value(b))) set(dd, v, true);
    }
  }
  return [...changed.values()].sort((x, y) => x.date.localeCompare(y.date));
}

const blankRecord = (date) => ({ date, thip: null, nova: null, thip_est: false, nova_est: false });

// ---------- Usage ----------

// Usage for date D = reading(D+1) − reading(D).
// Returns { usage, est } or null if either reading is missing.
// A day counts as estimated if either of its two readings is estimated.
export function usageOn(byDate, meter, date) {
  const a = byDate.get(date);
  const b = byDate.get(addDays(date, 1));
  if (!a || !b || a[meter] === null || b[meter] === null || a[meter] === undefined || b[meter] === undefined) return null;
  return { usage: b[meter] - a[meter], est: !!(a[meter + '_est'] || b[meter + '_est']) };
}

// Average daily usage over `dates` for one meter, counting only measured days
// (both readings real, i.e. neither estimated). null if there are none.
export function measuredAverage(byDate, meter, dates) {
  const used = dates.map((d) => usageOn(byDate, meter, d)).filter((u) => u && !u.est);
  return used.length ? used.reduce((sum, u) => sum + u.usage, 0) / used.length : null;
}

export function median(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// The last `n` real (non-estimated) daily usages before `date`, newest first.
// Stops looking after a year so a sparse meter can't loop forever.
export function recentRealUsages(byDate, meter, date, n = SANITY.MEDIAN_DAYS) {
  const out = [];
  for (let d = addDays(date, -1), i = 0; out.length < n && i < 366; d = addDays(d, -1), i++) {
    const u = usageOn(byDate, meter, d);
    if (u && !u.est) out.push(u.usage);
  }
  return out;
}

// ---------- Sanity check ----------

// Last 4 digits of a meter value, as shown on the meter (e.g. 28074 -> '8074',
// 40021 -> '0021'). Used for every reading shown on screen and in the PDF; the
// stored full value keeps the extra leading digit(s), which count rollovers.
export const last4 = (full) => String(roundHalfUp(full) % 10000).padStart(4, '0');

// Round to a whole number, ignoring floating-point dust: 27941.499999999993 is
// really 27941.5 from the spreadsheet's interpolation, so it rounds up (as Excel did).
export const roundHalfUp = (x) => Math.round(x + 1e-6);

// Is a new reading plausible? Compares the implied average daily usage since the
// previous reading with absolute and recent-median limits. If a later reading
// already exists (when logging a past date), also checks the new value isn't
// above it, which would make usage negative.
// Returns { suspicious, total, days, perDay, median, reasons: [text] }.
export function sanityCheck({ prevDate, prevFull, date, newFull, recentUsages, nextDate = null, nextFull = null }) {
  const days = daysBetween(prevDate, date);
  const total = newFull - prevFull;
  const perDay = total / days;
  const med = median(recentUsages);
  const reasons = [];

  // Typed digits lower than the previous reading: rollover() has assumed the meter
  // passed a multiple of 10,000, giving a huge jump. A genuine rollover gives a
  // normal daily usage, so only a huge one means a meter that "went backwards".
  const crossed = Math.floor(newFull / 10000) > Math.floor(prevFull / 10000);
  if (total < 0 || (crossed && perDay > SANITY.MAX_DAILY_KWH)) {
    reasons.push(`${last4(newFull)} is lower than the previous reading ${last4(prevFull)} (${prevDate}), but the meter can only go up`);
  } else if (perDay > SANITY.MAX_DAILY_KWH) {
    reasons.push(`${Math.round(perDay)} kWh/day is extremely high`);
  } else if (med !== null && perDay > SANITY.MEDIAN_FACTOR * med + SANITY.MEDIAN_OFFSET) {
    reasons.push(`${Math.round(perDay)} kWh/day is far above the recent typical ${Math.round(med)} kWh/day`);
  }

  if (nextFull !== null && newFull > nextFull) {
    reasons.push(`${last4(newFull)} is higher than the next reading ${last4(nextFull)} (${nextDate}), which would make usage negative`);
  }
  return { suspicious: reasons.length > 0, total, days, perDay, median: med, reasons };
}

// ---------- Yesterday and seasonal comparison ----------

// Mean real daily usage for calendar month `monthNum` (1–12) in years before `beforeYear`.
// Returns null if there is no history for that month.
export function seasonalTypical(byDate, meter, monthNum, beforeYear) {
  const mm = String(monthNum).padStart(2, '0');
  let sum = 0;
  let n = 0;
  for (const date of byDate.keys()) {
    if (date.slice(5, 7) !== mm || +date.slice(0, 4) >= beforeYear) continue;
    const u = usageOn(byDate, meter, date);
    if (u && !u.est) { sum += u.usage; n++; }
  }
  return n ? sum / n : null;
}

// For the Daily screen: usage for the day before `today`, compared with the
// seasonal typical for that day's month. Returns null if yesterday's usage isn't
// available or isn't real.
export function yesterdayComparison(byDate, meter, today) {
  const yesterday = addDays(today, -1);
  const u = usageOn(byDate, meter, yesterday);
  if (!u || u.est) return null;
  const month = +yesterday.slice(5, 7);
  const typical = seasonalTypical(byDate, meter, month, +yesterday.slice(0, 4));
  const diffPct = typical ? ((u.usage - typical) / typical) * 100 : null;
  return { date: yesterday, usage: u.usage, month, typical, diffPct };
}

// ---------- Bill ----------

// Per-meter usage totals for a month. Needs a reading (real or estimated) for
// every day from the 1st through the 1st of the following month; any missing
// dates are listed in `missing` (and the totals are then null).
export function monthUsage(byDate, month) {
  const dates = [...daysInMonth(month), `${nextMonth(month)}-01`];
  const missing = dates.filter((d) => {
    const r = byDate.get(d);
    return !r || METERS.some((m) => r[m] === null || r[m] === undefined);
  });
  if (missing.length) return { missing, thipUnits: null, novaUnits: null };
  const first = byDate.get(dates[0]);
  const last = byDate.get(dates[dates.length - 1]);
  return {
    missing: [],
    thipUnits: last.thip - first.thip, // = sum of daily usages (the sum telescopes)
    novaUnits: last.nova - first.nova,
  };
}

// One row per day of the month for the bill PDF:
//   { date, thip, nova, thip_est, nova_est,          (readings)
//     thipUse, novaUse, thipUseEst, novaUseEst }      (usage, null if unknown)
export function billRows(byDate, month) {
  return daysInMonth(month).map((date) => {
    const r = byDate.get(date) || {};
    const row = { date };
    for (const m of METERS) {
      const u = usageOn(byDate, m, date);
      row[m] = r[m] ?? null;
      row[m + '_est'] = !!r[m + '_est'];
      row[m + 'Use'] = u ? u.usage : null;
      row[m + 'UseEst'] = u ? u.est : false;
    }
    return row;
  });
}

// Split the utility bill between the households (all values unrounded).
export function billSplit({ P, OP, H, totalBill, thipUnits, novaUnits }) {
  const totalUnits = P + OP + H;
  const rate = totalBill / totalUnits;
  const A = rate * thipUnits;   // Gaae&Thip pays
  const B = rate * novaUnits;   // Nig&Jop pays
  return { totalUnits, rate, A, B, boyYui: totalBill - A - B };
}
