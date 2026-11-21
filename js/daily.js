// Daily screen: enter the two meter readings for a date.
//
// On Enter, for each meter that has digits typed:
//   1. rollover   – turn the 4 digits into the full meter value
//   2. sanity     – collect warnings ("Are you sure?") but never block
//   3. gap-fill   – if days before it have no reading, ask whether to fill them
//                   with averaged (interpolated) values
//   4. save       – all changes in one database transaction; later readings are
//                   renumbered so a corrected mistake can't spoil their usage
// Typing 0000 offers to clear the day's reading instead (leave the day blank).

import { getAll, putMany } from './db.js';
import {
  METERS, addDays, indexByDate, rollover, previousReading, nextRealReading,
  recordReading, removeReading, clearReading, missedDays, sanityCheck, recentRealUsages, seasonalTypical, last4,
} from './calc.js';
import { NAMES, MONTHS, todayISO, fmtDay, fmtNum, fmtDateRanges, esc } from './format.js';
import { ask } from './dialog.js';

// TESTING SWITCH: true lets you pick dates after today (for fictional future
// readings). Set back to false before deploying.
const ALLOW_FUTURE_DATES = false;

let app;                // the <main> element
let date;               // selected date 'YYYY-MM-DD'
let fromHistory;        // opened by tapping a row on the History screen

// Called by the router each time the screen is opened: start on today, or on
// the date given (when History opens a day for editing).
export function renderDaily(container, startDate = null) {
  app = container;
  fromHistory = /^\d{4}-\d{2}-\d{2}$/.test(startDate || '');
  date = fromHistory ? startDate : todayISO();
  return draw();
}

async function draw() {
  const readings = await getAll('readings');
  const byDate = indexByDate(readings);
  const today = todayISO();
  const maxDate = ALLOW_FUTURE_DATES ? '' : today;   // '' = no limit

  app.innerHTML = `
    <form id="dailyForm" class="card" autocomplete="off">
      <div class="date-row">
        <button type="button" class="secondary step" id="prevDay" aria-label="Previous day">‹</button>
        <div class="field grow">
          <label for="date">${fmtDay(date, { year: true })}${date === today ? ' (today)' : ''}</label>
          <input id="date" type="date" value="${date}" ${maxDate ? `max="${maxDate}"` : ''} required>
        </div>
        <button type="button" class="secondary step" id="nextDay" aria-label="Next day" ${maxDate && date >= maxDate ? 'disabled' : ''}>›</button>
      </div>
      ${ALLOW_FUTURE_DATES ? '<div class="test-flag">TEST: future dates allowed</div>' : ''}
      <div class="row">
        ${METERS.map((m) => meterField(m, readings, byDate)).join('')}
      </div>
      <button type="submit" class="full" id="enterBtn">Enter</button>
      <p id="dailyMsg" class="error"></p>
    </form>
    ${fromHistory ? '<button type="button" class="secondary full" id="backBtn">‹ Back to History</button>' : ''}
  `;
  // Going "back" (rather than linking to #history) keeps the browser history tidy,
  // so the phone's Back gesture behaves the same way.
  document.getElementById('backBtn')?.addEventListener('click', () => history.back());

  const form = document.getElementById('dailyForm');
  form.addEventListener('submit', (e) => { e.preventDefault(); onEnter(readings, byDate); });
  document.getElementById('date').addEventListener('change', (e) => changeDate(e.target.value));
  document.getElementById('prevDay').addEventListener('click', () => changeDate(addDays(date, -1)));
  document.getElementById('nextDay').addEventListener('click', () => changeDate(addDays(date, 1)));

  // Check each meter as soon as its 4th digit is typed, and always move on from
  // Gaae&Thip to Nig&Jop (any warning stays visible under the first box).
  for (const m of METERS) {
    const input = document.getElementById(`in-${m}`);
    if (input.value) instantCheck(m, input.value, readings, byDate); // usage for a saved reading
    input.addEventListener('focus', () => input.select()); // typing replaces the saved value
    input.addEventListener('input', () => {
      instantCheck(m, input.value, readings, byDate);
      if (m === 'thip' && input.value.length === 4) document.getElementById('in-nova').focus();
    });
  }
}

// Feedback under a box once 4 digits are typed:
//   amber – it replaces a saved reading
//   red   – the sanity check failed (the message includes the usage)
//   plain – otherwise, the usage since the last reading
function instantCheck(m, raw, readings, byDate) {
  const infoBox = document.getElementById(`info-${m}`);
  const warnBox = document.getElementById(`warn-${m}`);
  const usageBox = document.getElementById(`usage-${m}`);
  infoBox.textContent = warnBox.textContent = usageBox.textContent = '';
  if (raw.length < 4) return;               // still typing
  if (!/^\d{4}$/.test(raw)) {
    warnBox.textContent = 'Digits only, please.';
    return;
  }
  if (raw === '0000') {
    infoBox.textContent = 'On Enter you can clear this day (leave it blank)';
    return;
  }
  const { warnings, info, usage } = checkMeter(m, Number(raw), readings, byDate);
  infoBox.textContent = info.join('\n');
  warnBox.textContent = warnings.join('\n');
  if (!warnings.length) usageBox.textContent = usage;
}

// Work out the full value for one meter, its usage since the last reading, and
// anything worth warning about. Used both for the instant feedback and on
// Enter, so they always agree.
//   warnings – possible typos (red)
//   info     – worth knowing but not a mistake (amber)
// Returns { full, usage: text, warnings: [text], info: [text] }.
function checkMeter(m, digits, readings, byDate) {
  const prev = previousReading(readings, m, date);
  const full = rollover(prev ? prev[m] : null, digits);
  const warnings = [];
  const info = [];
  let usage = 'First reading for this meter';

  const existing = byDate.get(date);
  if (existing && existing[m] !== null && existing[m] !== undefined && !existing[m + '_est']
      && Math.round(existing[m]) !== full) {
    info.push(`Replaces the saved reading ${last4(existing[m])}`);
  }

  if (prev) {
    const next = nextRealReading(readings, m, date);
    const s = sanityCheck({
      prevDate: prev.date, prevFull: prev[m], date, newFull: full,
      recentUsages: recentRealUsages(byDate, m, date),
      nextDate: next?.date ?? null, nextFull: next ? next[m] : null,
    });
    usage = s.days === 1
      ? `${fmtNum(s.total)} kWh since ${fmtDay(prev.date)}`
      : `${fmtNum(s.total)} kWh over ${s.days} days (${fmtNum(s.perDay, 1)}/day), `
        + `${s.days - 1} day${s.days > 2 ? 's' : ''} with no reading`;
    if (s.suspicious) warnings.push(`${usage}: ${s.reasons.join('; ')}`);
    else if (m === 'nova' && !prev.nova_est) usage += seasonal(byDate, s.perDay);
  }
  return { full, usage, warnings, info };
}

// " (Nov typical: 25, -7%)": average daily usage compared with the same month in
// previous years (real days only). Nova only.
function seasonal(byDate, perDay) {
  const day = addDays(date, -1);            // the (last) day the usage belongs to
  const month = +day.slice(5, 7);
  const typical = seasonalTypical(byDate, 'nova', month, +day.slice(0, 4));
  if (!typical) return '';
  const pct = ((perDay - typical) / typical) * 100;
  return ` (${MONTHS[month - 1]} typical: ${fmtNum(typical)}, ${pct >= 0 ? '+' : ''}${fmtNum(pct)}%)`;
}

function changeDate(newDate) {
  if (!newDate || (!ALLOW_FUTURE_DATES && newDate > todayISO())) return;
  date = newDate;
  draw();
}

// The saved reading for the selected date as 4 digits, split by type:
// { real: '8074' | null, est: '7963' | null }.
function savedDigits(m, byDate) {
  const rec = byDate.get(date);
  if (!rec || rec[m] === null || rec[m] === undefined) return { real: null, est: null };
  return rec[m + '_est'] ? { real: null, est: last4(rec[m]) } : { real: last4(rec[m]), est: null };
}

// One input box. A real saved reading is filled in; an estimated one is shown
// greyed as a placeholder (so Enter can't turn it into a "real" reading by
// accident). The hint shows the previous reading.
function meterField(m, readings, byDate) {
  const saved = savedDigits(m, byDate);
  const prev = previousReading(readings, m, date);
  let hint = prev ? `Previous: ${last4(prev[m])} on ${fmtDay(prev.date)}` : 'No earlier reading';
  if (saved.est) hint += '<br><span class="est">Grey value is estimated: type the real reading if known</span>';
  return `
    <div class="field">
      <label for="in-${m}">${esc(NAMES[m])}</label>
      <input id="in-${m}" inputmode="numeric" pattern="[0-9]*" maxlength="4"
             value="${saved.real ?? ''}" placeholder="${saved.est ?? ''}">
      <div class="hint">${hint}</div>
      <div class="info" id="info-${m}"></div>
      <div class="warn" id="warn-${m}"></div>
      <div class="usage" id="usage-${m}"></div>
    </div>`;
}

async function onEnter(readings, byDate) {
  const msg = document.getElementById('dailyMsg');
  msg.textContent = '';

  // Read and validate the inputs. Boxes still showing the saved value are skipped.
  const entries = [];
  let unchanged = 0;
  for (const m of METERS) {
    const raw = document.getElementById(`in-${m}`).value.trim();
    if (raw === '') continue;
    if (!/^\d{1,4}$/.test(raw)) {
      msg.textContent = `${NAMES[m]}: enter up to 4 digits.`;
      return;
    }
    const { real } = savedDigits(m, byDate);
    // Unchanged, unless there are blank days before it (then Enter offers to fill
    // them) or it is 0000 (then Enter offers to clear it).
    if (real !== null && Number(raw) === Number(real) && Number(raw) !== 0
        && !missedDays(readings, m, date).length) {
      unchanged++;
      continue;
    }
    entries.push({ m, digits: Number(raw) });
  }
  if (!entries.length) {
    msg.textContent = unchanged ? 'No changes to save.' : 'Enter at least one reading.';
    return;
  }

  // 0000: clear the day's reading, or is the meter really showing 0000?
  for (const entry of entries.filter((e) => e.digits === 0)) {
    const answer = await askZero(entry.m, readings);
    if (answer !== 'clear' && answer !== 'real') return;   // Cancel or Back: nothing saved
    entry.clear = answer === 'clear';
  }
  const clears = entries.filter((e) => e.clear);
  const toRecord = entries.filter((e) => !e.clear);

  // Check each meter, collecting warnings. The meters are independent, so each
  // is checked against the readings as loaded.
  const warnings = [];
  for (const entry of toRecord) {
    const { full, warnings: w, info } = checkMeter(entry.m, entry.digits, readings, byDate);
    entry.full = full;
    for (const text of [...info, ...w]) warnings.push(`${NAMES[entry.m]}: ${text}.`);
  }

  if (warnings.length) {
    const ok = confirm(`Are you sure?\n\n${warnings.join('\n\n')}\n\nOK = save anyway\nCancel = go back and correct`);
    if (!ok) return;
  }

  // Days just before this one with no reading: ask whether to fill them.
  const gaps = toRecord
    .map(({ m }) => ({ m, days: missedDays(readings, m, date) }))
    .filter((g) => g.days.length);
  let fill = true;
  if (gaps.length) {
    const answer = await askFill(gaps);
    if (!answer) return;               // closed with Back: nothing saved
    fill = answer === 'yes';
  }

  // Work out every change, then save them all at once. Each meter's changes go
  // into a working copy, so the next meter sees them (both may touch a day).
  let working = readings;
  const toSave = new Map();      // date -> record
  const apply = (changed) => {
    const map = indexByDate(working);
    for (const r of changed) { map.set(r.date, r); toSave.set(r.date, r); }
    working = [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
  };
  for (const { m } of clears) apply(removeReading(working, m, date));
  for (const { m, full } of toRecord) apply(recordReading(working, m, date, full, fill));

  if (!toSave.size) {
    msg.textContent = 'Nothing to save: there was no reading to clear.';
    return;
  }
  await putMany('readings', [...toSave.values()]);
  draw(); // redraw: boxes show the saved values with their usage
}

// "Unfilled readings" pop-up. gaps: [{ m, days: ['YYYY-MM-DD', …] }].
// Resolves 'yes' (fill), 'no' (leave blank) or '' (closed with Back).
function askFill(gaps) {
  const lines = gaps.map(({ m, days }) =>
    `<li><strong>${esc(NAMES[m])}</strong>: ${days.length} day${days.length > 1 ? 's' : ''} (${fmtDateRanges(days)})</li>`);
  const one = gaps.length === 1 && gaps[0].days.length === 1;
  return ask(`
    <h2>Unfilled readings</h2>
    <p>There ${one ? 'is a day' : 'are days'} before ${fmtDay(date)} with no reading:</p>
    <ul>${lines.join('')}</ul>
    <p>Fill ${one ? 'it' : 'them'} with averaged values? They are marked as estimated.</p>`,
  [
    { value: 'no', label: 'No, leave blank', secondary: true },
    { value: 'yes', label: 'Yes, fill' },
  ]);
}

// 0000 typed for meter m: clear this day's reading, or is the meter really
// showing 0000 (it passes 0000 once every 10,000 kWh)? Resolves 'clear',
// 'real', 'cancel' or '' (closed with Back).
function askZero(m, readings) {
  const cleared = clearReading(readings, m, date);
  const savedRec = indexByDate(readings).get(date);
  const saved = cleared.some((r) => r.date === date);
  const others = cleared.length - (saved ? 1 : 0);
  let what = saved
    ? `the ${savedRec[m + '_est'] ? 'estimated' : 'saved'} reading ${last4(savedRec[m])}`
    : 'nothing (there is no reading saved)';
  if (others) what += ` and the ${others} estimated day${others > 1 ? 's' : ''} next to it (they were averaged using it)`;
  return ask(`
    <h2>0000 for ${esc(NAMES[m])}</h2>
    <p>Clear ${fmtDay(date)}, leaving it blank? That clears ${what}.</p>
    <p>Or is the meter really showing 0000?</p>`,
  [
    { value: 'cancel', label: 'Cancel', secondary: true },
    { value: 'real', label: 'Meter shows 0000', secondary: true },
    { value: 'clear', label: 'Clear' },
  ]);
}
