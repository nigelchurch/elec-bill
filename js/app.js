// App entry point: registers the service worker, asks for persistent storage,
// and switches between screens.
//
// Navigation uses the URL "hash" (#daily, #history, #bill, #data). Changing the
// hash doesn't reload the page, the browser Back button works, and it needs no
// server support, which suits GitHub Pages.

import { openDB, count, getMeta, setMeta, replaceAll } from './db.js';
import { parseBackup } from './csv.js';
import { renderDaily } from './daily.js';

const app = document.getElementById('app');

// ---------- Screens (placeholders are filled in during later build steps) ----------

const screens = {
  daily: () => renderDaily(app),

  history() {
    app.innerHTML = `<h1>History</h1><div class="card muted">Coming in build step 5.</div>`;
  },

  bill() {
    app.innerHTML = `<h1>Bill</h1><div class="card muted">Coming in build step 6.</div>`;
  },

  async data() {
    app.innerHTML = `<h1>Data</h1><div class="card muted">Loading…</div>`;
    const [readings, bills, lastBackup, lastImport, persisted] = await Promise.all([
      count('readings'),
      count('bills'),
      getMeta('lastBackup'),
      getMeta('lastImport'),
      navigator.storage?.persisted ? navigator.storage.persisted() : false,
    ]);
    app.innerHTML = `
      <h1>Data</h1>
      <div class="card">
        <table class="kv">
          <tr><td>Readings</td><td>${readings}</td></tr>
          <tr><td>Bills</td><td>${bills}</td></tr>
          <tr><td>Last backup</td><td>${lastBackup || 'never'}</td></tr>
          <tr><td>Last import</td><td>${lastImport || 'never'}</td></tr>
          <tr><td>Persistent storage</td><td>${persisted ? 'yes' : 'no'}</td></tr>
        </table>
      </div>

      <h2>Restore from backup</h2>
      <div class="card">
        <p class="muted">Choose a backup CSV file. This <strong>replaces</strong> all readings and bills in the app.</p>
        <!-- The real file input is hidden; the styled label acts as its button. -->
        <label class="button secondary full" for="importFile">Import backup…</label>
        <input id="importFile" type="file" accept=".csv,text/csv" hidden>
        <p id="importMsg"></p>
      </div>
      <p class="muted">Export is added in build step 7.</p>
    `;
    document.getElementById('importFile').addEventListener('change', onImportFile);
  },
};

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
  const name = location.hash.slice(1) || 'daily';
  const screen = screens[name] || screens.daily;
  document.querySelectorAll('[data-nav]').forEach((a) => {
    a.classList.toggle('active', a.dataset.nav === name);
  });
  return screen(); // returns a Promise for async screens, so callers can await the redraw
}

window.addEventListener('hashchange', render);

// ---------- Start-up ----------

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
