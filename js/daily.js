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

// Called by the router each time the screen is opened: start on today.
export function renderDaily(container) {
  app = container;
  date = todayISO();
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
    ${novaComparison(byDate)}
    <a href="#bill" class="button secondary full">Bill</a>
  `;

  const form = document.getElementById('dailyForm');
  form.addEventListener('submit', (e) => { e.preventDefault(); onEnter(readings, byDate); });
  document.getElementById('date').addEventListener('change', (e) => changeDate(e.target.value));
  document.getElementById('prevDay').addEventListener('click', () => changeDate(addDays(date, -1)));
  document.getElementById('nextDay').addEventListener('click', () => changeDate(addDays(date, 1)));

  // Check each meter as soon as its 4th digit is typed, and always move on from
  // Gaae&Thip to Nig&Jop (any warning stays visible under the first box).
  for (const m of METERS) {
    const input = document.getElementById(`in-${m}`);
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
        + `${s.days - 1} missed day${s.days > 2 ? 's' : ''} will be estimated`;
    if (s.suspicious) warnings.push(`${usage}: ${s.reasons.join('; ')}`);
  }
  return { full, usage, warnings, info };
}

function changeDate(newDate) {
  if (!newDate || newDate > todayISO()) return;
  date = newDate;
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
      <div class="usage" id="usage-${m}"></div>
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

  for (const { m, digits } of entries) {
    // The meters are independent, so each is checked against the readings as loaded.
    const { full, warnings: w, info } = checkMeter(m, digits, readings, byDate);
    for (const text of [...info, ...w]) warnings.push(`${NAMES[m]}: ${text}.`);

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
  draw(); // redraw: boxes clear, hints show the saved values, Nova line updates
}
