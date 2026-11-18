// History screen: every day's readings and usage, newest first, grouped by month.
// Tapping a row opens the Daily screen on that date, which already handles
// editing, sanity checks and re-interpolating neighbouring estimated days.

import { getAll } from './db.js';
import { indexByDate, usageOn, METERS, last4 } from './calc.js';
import { MONTHS, DAYS, NAMES, esc } from './format.js';

const PAGE = 120;        // rows shown at first; "Show older" adds a year at a time
let shown = PAGE;
let lastOpened = null;   // date of the row last tapped, to scroll back to it

export async function renderHistory(app) {
  const readings = await getAll('readings');
  if (!readings.length) {
    app.innerHTML = `<h1>History</h1>
      <div class="card muted">No readings yet. Import a backup on the Data screen.</div>`;
    return;
  }
  const byDate = indexByDate(readings);
  const rows = readings.slice().reverse().slice(0, shown); // newest first

  let body = '';
  let month = '';
  for (const r of rows) {
    const ym = r.date.slice(0, 7);
    if (ym !== month) {   // month heading row
      month = ym;
      body += `<tr class="month"><th colspan="6">${MONTHS[+ym.slice(5) - 1]} ${ym.slice(0, 4)}</th></tr>`;
    }
    body += rowHTML(r, byDate);
  }

  const more = readings.length > shown
    ? `<button class="secondary full" id="showOlder">Show older (${readings.length - shown} more days)</button>`
    : '';

  app.innerHTML = `
    <h1>History</h1>
    <p class="muted small"><span class="est">Italic</span> = estimated. Tap a day to edit it.</p>
    <div class="card table-card">
      <table class="hist">
        <thead>
          <tr><th colspan="2" rowspan="2">Date</th><th colspan="2">Reading</th><th colspan="2">Usage (kWh)</th></tr>
          <tr>${METERS.map((m) => `<th>${esc(NAMES[m])}</th>`).join('')}${METERS.map((m) => `<th class="use">${esc(NAMES[m])}</th>`).join('')}</tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    </div>
    ${more}
  `;

  // One click handler for the whole table ("event delegation"), not one per row.
  app.querySelector('tbody').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-date]');
    if (!tr) return;
    lastOpened = tr.dataset.date;
    location.hash = `#daily?date=${tr.dataset.date}`;
  });
  document.getElementById('showOlder')?.addEventListener('click', () => {
    shown += 365;
    renderHistory(app);
  });

  // Coming back from an edit: scroll to that row and highlight it.
  const row = lastOpened && document.getElementById(`row-${lastOpened}`);
  if (row) {
    row.classList.add('highlight');
    row.scrollIntoView({ block: 'center' });
  }
}

function rowHTML(r, byDate) {
  const d = new Date(`${r.date}T00:00:00Z`);
  // fmt: how to show the number. Readings show only the 4 digits on the meter
  // (the stored full value also counts rollovers); usage is rounded kWh.
  const cell = (value, est, fmt, cls = '') => {
    const classes = [cls, est ? 'est' : ''].filter(Boolean).join(' ');
    const text = value === null || value === undefined ? '' : fmt(value);
    return `<td${classes ? ` class="${classes}"` : ''}>${text}</td>`;
  };
  const readingCells = METERS.map((m) => cell(r[m], r[m + '_est'], last4));
  const usageCells = METERS.map((m) => {
    const u = usageOn(byDate, m, r.date);
    return u ? cell(u.usage, u.est, Math.round, 'use') : cell(null, false, Math.round, 'use');
  });
  return `<tr data-date="${r.date}" id="row-${r.date}">
    <td>${d.getUTCDate()}</td><td class="day">${DAYS[d.getUTCDay()]}</td>
    ${readingCells.join('')}${usageCells.join('')}
  </tr>`;
}
