// History screen: every day's readings and usage, newest first, grouped by
// month. Each month starts collapsed, showing only its heading with the
// average daily usage of its measured days; tap the heading to open it.
// Tapping a day opens the Daily screen on that date, which already handles
// editing, sanity checks and re-interpolating neighbouring estimated days.

import { navigate } from './nav.js';
import { getAll } from './db.js';
import { indexByDate, usageOn, measuredAverage, METERS, last4, roundHalfUp } from './calc.js';
import { MONTHS, DAYS, NAMES, esc } from './format.js';

const open = new Set();  // months the user has opened ('YYYY-MM'), kept while the app runs
let lastOpened = null;   // date of the row last tapped, to scroll back to it

export async function renderHistory(app) {
  const readings = await getAll('readings');
  if (!readings.length) {
    app.innerHTML = `<h1>History</h1>
      <div class="card muted">No readings yet. Import a backup on the Data screen.</div>`;
    return;
  }
  const byDate = indexByDate(readings);
  if (lastOpened) open.add(lastOpened.slice(0, 7)); // coming back from an edit: keep its month open

  // Group the days by month, newest first.
  const months = new Map();
  for (const r of readings.slice().reverse()) {
    const ym = r.date.slice(0, 7);
    if (!months.has(ym)) months.set(ym, []);
    months.get(ym).push(r);
  }

  // One <tbody> per month: its heading row, then its days (hidden until opened).
  let body = '';
  for (const [ym, rows] of months) {
    const dates = rows.map((r) => r.date);
    const avgs = METERS.map((m) => {
      const a = measuredAverage(byDate, m, dates);
      return `<th class="use avg">${a === null ? '–' : a.toFixed(1)}</th>`;
    });
    const isOpen = open.has(ym);
    body += `<tbody data-month="${ym}" class="${isOpen ? 'open' : ''}">
      <tr class="month" aria-expanded="${isOpen}">
        <th colspan="4"><span class="chev" aria-hidden="true"></span>${MONTHS[+ym.slice(5) - 1]} ${ym.slice(0, 4)}</th>
        ${avgs.join('')}
      </tr>
      ${rows.map((r) => rowHTML(r, byDate)).join('')}
    </tbody>`;
  }

  app.innerHTML = `
    <h1>History</h1>
    <p class="muted small">Tap a month to open it, a day to edit it. Month figures: average kWh/day of measured days. <span class="est">Italic</span> = estimated.</p>
    <div class="card table-card">
      <table class="hist">
        <thead>
          <tr><th colspan="2" rowspan="2">Date</th><th colspan="2">Reading</th><th colspan="2">Usage (kWh)</th></tr>
          <tr>${METERS.map((m) => `<th>${esc(NAMES[m])}</th>`).join('')}${METERS.map((m) => `<th class="use">${esc(NAMES[m])}</th>`).join('')}</tr>
        </thead>
        ${body}
      </table>
    </div>
  `;

  // One click handler for the whole table ("event delegation"), not one per row.
  app.querySelector('table.hist').addEventListener('click', (e) => {
    const heading = e.target.closest('tr.month');
    if (heading) {
      const tbody = heading.parentElement;
      const nowOpen = tbody.classList.toggle('open');
      heading.setAttribute('aria-expanded', String(nowOpen));
      if (nowOpen) open.add(tbody.dataset.month); else open.delete(tbody.dataset.month);
      return;
    }
    const tr = e.target.closest('tr[data-date]');
    if (!tr) return;
    lastOpened = tr.dataset.date;
    navigate(`#daily?date=${tr.dataset.date}`, { edit: true }); // Back returns here
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
    return u ? cell(u.usage, u.est, roundHalfUp, 'use') : cell(null, false, roundHalfUp, 'use');
  });
  return `<tr data-date="${r.date}" id="row-${r.date}">
    <td>${d.getUTCDate()}</td><td class="day">${DAYS[d.getUTCDay()]}</td>
    ${readingCells.join('')}${usageCells.join('')}
  </tr>`;
}
