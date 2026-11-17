// Daily screen: enter the two meter readings for a date.
//
// On Enter, for each meter that has digits typed:
//   1. rollover   – turn the 4 digits into the full meter value
//   2. sanity     – collect warnings ("Are you sure?") but never block
//   3. gap-fill   – estimate any missed days since the previous reading
//   4. save       – all changes in one database transaction

import { getAll, putMany } from './db.js';
import {
  METERS, addDays, indexByDate, rollover, previousReading, nextRealReading,
  applyReading, sanityCheck, recentRealUsages, yesterdayComparison, last4,
} from './calc.js';
import { NAMES, MONTHS, todayISO, fmtDay, fmtNum, esc } from './format.js';

let app;                // the <main> element
let date;               // selected date 'YYYY-MM-DD'
let resultHTML = '';    // message shown after a save

// Called by the router each time the screen is opened: start on today.
export function renderDaily(container) {
  app = container;
  date = todayISO();
  resultHTML = '';
  return draw();
}

async function draw() {
  const readings = await getAll('readings');
  const byDate = indexByDate(readings);
  const today = todayISO();

  app.innerHTML = `
    <form id="dailyForm" class="card" autocomplete="off">
      <div class="date-row">
        <button type="button" class="secondary step" id="prevDay" aria-label="Previous day">‹</button>
        <div class="field grow">
          <label for="date">${fmtDay(date, { year: true })}${date === today ? ' (today)' : ''}</label>
          <input id="date" type="date" value="${date}" max="${today}" required>
        </div>
        <button type="button" class="secondary step" id="nextDay" aria-label="Next day" ${date >= today ? 'disabled' : ''}>›</button>
      </div>
      <div class="row">
        ${METERS.map((m) => meterField(m, readings, byDate)).join('')}
      </div>
      <button type="submit" class="full" id="enterBtn">Enter</button>
      <p id="dailyMsg" class="error"></p>
    </form>
    ${resultHTML}
    ${novaComparison(byDate)}
    <a href="#bill" class="button secondary full">Bill</a>
  `;

  const form = document.getElementById('dailyForm');
  form.addEventListener('submit', (e) => { e.preventDefault(); onEnter(readings, byDate); });
  document.getElementById('date').addEventListener('change', (e) => changeDate(e.target.value));
  document.getElementById('prevDay').addEventListener('click', () => changeDate(addDays(date, -1)));
  document.getElementById('nextDay').addEventListener('click', () => changeDate(addDays(date, 1)));

  // Check each meter as soon as its 4th digit is typed. If Gaae&Thip looks fine,
  // jump to Nig&Jop; if not, stay put so it can be corrected.
  for (const m of METERS) {
    const input = document.getElementById(`in-${m}`);
    input.addEventListener('input', () => {
      const ok = instantCheck(m, input.value, readings, byDate);
      if (ok && m === 'thip' && input.value.length === 4) document.getElementById('in-nova').focus();
    });
  }
}

// Show (or clear) the red warning under a box. Returns true if there is no warning.
function instantCheck(m, raw, readings, byDate) {
  const box = document.getElementById(`warn-${m}`);
  const infoBox = document.getElementById(`info-${m}`);
  box.textContent = '';
  infoBox.textContent = '';
  if (raw.length < 4) return true;          // still typing
  if (!/^\d{4}$/.test(raw)) {
    box.textContent = 'Digits only, please.';
    return false;
  }
  const { warnings, info } = checkMeter(m, Number(raw), readings, byDate);
  box.textContent = warnings.join('\n');
  infoBox.textContent = info.join('\n');
  return warnings.length === 0;             // information alone doesn't stop the cursor
}

// Work out the full value for one meter and anything worth warning about.
// Used both for the instant check and on Enter, so they always agree.
// warnings = possible typos (stop the cursor); info = worth knowing but not a
// sign of a mistake. Both are shown again in the confirmation on Enter.
// Returns { full, warnings: [text], info: [text], note: text|null }.
function checkMeter(m, digits, readings, byDate) {
  const prev = previousReading(readings, m, date);
  const full = rollover(prev ? prev[m] : null, digits);
  const warnings = [];
  const info = [];
  let note = null;

  const existing = byDate.get(date);
  if (existing && existing[m] !== null && existing[m] !== undefined && !existing[m + '_est']
      && Math.round(existing[m]) !== full) {
    info.push(`Replaces the saved reading ${last4(existing[m])}.`);
  }

  if (prev) {
    const next = nextRealReading(readings, m, date);
    const s = sanityCheck({
      prevDate: prev.date, prevFull: prev[m], date, newFull: full,
      recentUsages: recentRealUsages(byDate, m, date),
      nextDate: next?.date ?? null, nextFull: next ? next[m] : null,
    });
    if (s.suspicious) {
      const usage = s.days === 1
        ? `${fmtNum(s.total)} kWh since ${fmtDay(prev.date)}`
        : `${fmtNum(s.total)} kWh over ${s.days} days (${fmtNum(s.perDay, 1)}/day)`;
      warnings.push(`${usage}: ${s.reasons.join('; ')}.`);
    }
    if (s.days > 1) note = `${s.days - 1} missed day${s.days > 2 ? 's' : ''} filled with estimates`;
  }
  return { full, warnings, info, note };
}

function changeDate(newDate) {
  if (!newDate || newDate > todayISO()) return;
  date = newDate;
  resultHTML = '';
  draw();
}

// One input box plus a hint line: what's saved for this date, or the last reading before it.
function meterField(m, readings, byDate) {
  const rec = byDate.get(date);
  let hint;
  if (rec && rec[m] !== null && rec[m] !== undefined) {
    hint = `Saved: ${last4(rec[m])}${rec[m + '_est'] ? ' <span class="est">(estimated)</span>' : ''}`;
  } else {
    const prev = previousReading(readings, m, date);
    hint = prev ? `Last: ${last4(prev[m])} on ${fmtDay(prev.date)}` : 'No earlier reading';
  }
  return `
    <div class="field">
      <label for="in-${m}">${esc(NAMES[m])}</label>
      <input id="in-${m}" inputmode="numeric" pattern="[0-9]*" maxlength="4" placeholder="0000">
      <div class="hint">${hint}</div>
      <div class="info" id="info-${m}"></div>
      <div class="warn" id="warn-${m}"></div>
    </div>`;
}

// "Nova yesterday: 23 kWh (Nov typical: 25, -7%)" – only once the selected
// date has a Nova reading, and only if yesterday's reading was real.
function novaComparison(byDate) {
  const rec = byDate.get(date);
  if (!rec || rec.nova === null || rec.nova === undefined) return '';
  const c = yesterdayComparison(byDate, 'nova', date);
  if (!c) return `<div class="card muted">Nova yesterday: not available (estimated day)</div>`;
  let typical = '';
  if (c.typical !== null) {
    const sign = c.diffPct >= 0 ? '+' : '';
    typical = ` <span class="muted">(${MONTHS[c.month - 1]} typical: ${fmtNum(c.typical)}, ${sign}${fmtNum(c.diffPct)}%)</span>`;
  }
  return `<div class="card comparison">Nova yesterday: <strong>${fmtNum(c.usage)} kWh</strong>${typical}</div>`;
}

async function onEnter(readings, byDate) {
  const msg = document.getElementById('dailyMsg');
  msg.textContent = '';

  // Read and validate the inputs.
  const entries = [];
  for (const m of METERS) {
    const raw = document.getElementById(`in-${m}`).value.trim();
    if (raw === '') continue;
    if (!/^\d{1,4}$/.test(raw)) {
      msg.textContent = `${NAMES[m]}: enter up to 4 digits.`;
      return;
    }
    entries.push({ m, digits: Number(raw) });
  }
  if (!entries.length) {
    msg.textContent = 'Enter at least one reading.';
    return;
  }

  // Work out every change before saving anything, collecting warnings on the way.
  let working = readings;        // readings including changes so far
  const toSave = new Map();      // date -> record
  const warnings = [];
  const notes = [];

  for (const { m, digits } of entries) {
    // The meters are independent, so each is checked against the readings as loaded.
    const { full, warnings: w, info, note } = checkMeter(m, digits, readings, byDate);
    for (const text of [...info, ...w]) warnings.push(`${NAMES[m]}: ${text}`);
    if (note) notes.push(`${NAMES[m]}: ${note}`);

    // Gap-fill and merge into the working copy (so the next meter sees these changes).
    const changed = applyReading(working, m, date, full);
    const map = indexByDate(working);
    for (const r of changed) { map.set(r.date, r); toSave.set(r.date, r); }
    working = [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
  }

  if (warnings.length) {
    const ok = confirm(`Are you sure?\n\n${warnings.join('\n\n')}\n\nOK = save anyway\nCancel = go back and correct`);
    if (!ok) return;
  }

  await putMany('readings', [...toSave.values()]);

  const saved = indexByDate(working).get(date);
  const values = METERS.filter((m) => saved[m] !== null && saved[m] !== undefined)
    .map((m) => `${esc(NAMES[m])} ${last4(saved[m])}`).join(', ');
  resultHTML = `
    <div class="card ok">
      Saved ${fmtDay(date)}: ${values}
      ${notes.map((n) => `<div class="hint">${esc(n)}</div>`).join('')}
    </div>`;
  draw();
}
