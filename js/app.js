// App entry point: registers the service worker, asks for persistent storage,
// and switches between screens.
//
// Navigation uses the URL "hash" (#daily, #history, #bill, #data). Changing the
// hash doesn't reload the page, the browser Back button works, and it needs no
// server support, which suits GitHub Pages. A screen can take parameters after
// a '?', e.g. #daily?date=2026-11-10 (used by History to open a day for editing).

import { openDB, count, getMeta, setMeta, replaceAll } from './db.js';
import { parseBackup } from './csv.js';
import { renderDaily } from './daily.js';
import { renderHistory } from './history.js';
import { renderBill } from './bill.js';
import { downloadBackup } from './files.js';
import { daysBetween } from './calc.js';
import { todayISO } from './format.js';

const app = document.getElementById('app');

// ---------- Screens ----------

// A backup older than this many days is shown in red on the Data screen.
const BACKUP_WARN_DAYS = 35;

const screens = {
  daily: (params) => renderDaily(app, params.get('date')),

  history: () => renderHistory(app),

  bill: () => renderBill(app),

  async data() {
    app.innerHTML = `<h1>Data</h1><div class="card muted">Loading…</div>`;
    const [readings, bills, lastBackup, lastImport, persisted] = await Promise.all([
      count('readings'),
      count('bills'),
      getMeta('lastBackup'),
      getMeta('lastImport'),
      navigator.storage?.persisted ? navigator.storage.persisted() : false,
    ]);
    const age = lastBackup ? daysBetween(lastBackup, todayISO()) : null;
    const backupOld = age === null || age > BACKUP_WARN_DAYS;
    const backupText = lastBackup
      ? `${lastBackup} (${age === 0 ? 'today' : `${age} day${age === 1 ? '' : 's'} ago`})`
      : 'never';
    app.innerHTML = `
      <h1>Data</h1>
      <div class="card">
        <table class="kv">
          <tr><td>Readings</td><td>${readings}</td></tr>
          <tr><td>Bills</td><td>${bills}</td></tr>
          <tr><td>Last backup</td><td class="${backupOld ? 'warn-cell' : ''}">${backupText}</td></tr>
          <tr><td>Last import</td><td>${lastImport || 'never'}</td></tr>
          <tr><td>Persistent storage</td><td>${persisted ? 'yes' : 'no'}</td></tr>
        </table>
      </div>

      <h2>Back up</h2>
      <div class="card">
        <p class="muted">Saves every reading and bill to one file in Downloads
          (<code>ElecBackup-${todayISO()}.csv</code>). Any one backup restores everything.
          Keep a copy off the phone too, e.g. in OneDrive or Google Drive.</p>
        <button type="button" class="full" id="exportBtn">Export backup</button>
        <p id="exportMsg"></p>
      </div>

      <h2>Restore from backup</h2>
      <div class="card">
        <p class="muted">Choose a backup CSV file. This <strong>replaces</strong> all readings and bills in the app.</p>
        <!-- The real file input is hidden; the styled label acts as its button. -->
        <label class="button secondary full" for="importFile">Import backup…</label>
        <input id="importFile" type="file" accept=".csv,text/csv" hidden>
        <p id="importMsg"></p>
      </div>
    `;
    document.getElementById('importFile').addEventListener('change', onImportFile);
    document.getElementById('exportBtn').addEventListener('click', onExport);
  },
};

// ---------- Export ----------

async function onExport() {
  const filename = await downloadBackup();
  await render(); // redraw so "Last backup" shows today
  document.getElementById('exportMsg').textContent = `Saved ${filename} to Downloads.`;
}

// ---------- Import ----------

async function onImportFile(event) {
  const input = event.target;
  const file = input.files[0];
  input.value = ''; // so choosing the same file again still fires 'change'
  if (!file) return;
  const msg = document.getElementById('importMsg');
  msg.className = '';

  let data;
  try {
    data = parseBackup(await file.text());
  } catch (err) {
    msg.className = 'error';
    msg.textContent = err.message;
    return;
  }

  const { readings, bills } = data;
  const range = readings.length
    ? `${readings[0].date} to ${readings[readings.length - 1].date}`
    : 'no readings';
  const summary = `${readings.length} readings (${range}) and ${bills.length} bills`;

  const existing = (await count('readings')) + (await count('bills'));
  const question = existing
    ? `Replace ALL existing data (${existing} records) with ${summary} from "${file.name}"?`
    : `Import ${summary} from "${file.name}"?`;
  if (!confirm(question)) return;

  await replaceAll({ readings, bills });
  await setMeta('lastImport', `${new Date().toISOString().slice(0, 10)} (${file.name})`);
  await render(); // redraw the Data screen with the new counts; wait, as it loads them asynchronously
  document.getElementById('importMsg').textContent = `Imported ${summary}.`;
}

// ---------- Router ----------

function render() {
  const [name = 'daily', query = ''] = location.hash.slice(1).split('?');
  const params = new URLSearchParams(query);
  const screen = screens[name] || screens.daily;
  document.querySelectorAll('[data-nav]').forEach((a) => {
    a.classList.toggle('active', a.dataset.nav === name);
  });
  return screen(params); // returns a Promise for async screens, so callers can await the redraw
}

window.addEventListener('hashchange', render);

// ---------- Start-up ----------

// Top bar layout, re-checked at start-up and whenever the screen size changes
// (e.g. the Fold opened or closed):
//  - If the links don't fit beside the title, collapse them into a ☰ menu.
//  - Publish the bar's height as a CSS variable (--topbar-h), so the frozen
//    History table heading can sit just below it.
const topbar = document.querySelector('.topbar');
const menuBtn = document.getElementById('menuBtn');

function measureTopbar() {
  topbar.classList.remove('collapsed', 'menu-open');
  menuBtn.setAttribute('aria-expanded', 'false');
  if (topbar.scrollWidth > topbar.clientWidth) topbar.classList.add('collapsed');
  document.documentElement.style.setProperty('--topbar-h', `${topbar.offsetHeight}px`);
}
measureTopbar();
window.addEventListener('resize', measureTopbar);

function closeMenu() {
  topbar.classList.remove('menu-open');
  menuBtn.setAttribute('aria-expanded', 'false');
}
menuBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  const open = topbar.classList.toggle('menu-open');
  menuBtn.setAttribute('aria-expanded', String(open));
});
document.addEventListener('click', closeMenu); // tapping a link or anywhere else closes it

async function start() {
  await openDB();

  // Ask the browser not to evict our data under storage pressure. Chrome decides
  // automatically: installed PWAs are normally granted this.
  if (navigator.storage?.persist) {
    const already = await navigator.storage.persisted();
    if (!already) await navigator.storage.persist();
  }

  render();
}

// Register the service worker (only works over HTTPS or on localhost).
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch((err) => console.error('SW registration failed', err));
}

start();
