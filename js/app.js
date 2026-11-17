// App entry point: registers the service worker, asks for persistent storage,
// and switches between screens.
//
// Navigation uses the URL "hash" (#daily, #history, #bill, #data). Changing the
// hash doesn't reload the page, the browser Back button works, and it needs no
// server support, which suits GitHub Pages.

import { openDB, count, getMeta } from './db.js';

const app = document.getElementById('app');

// ---------- Screens (placeholders; filled in during later build steps) ----------

function todayISO() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const screens = {
  daily() {
    app.innerHTML = `
      <h1>Daily reading</h1>
      <div class="card">
        <div class="field">
          <label for="date">Date</label>
          <input id="date" type="date" value="${todayISO()}">
        </div>
        <div class="row">
          <div class="field">
            <label for="thip">Gaae&amp;Thip</label>
            <input id="thip" inputmode="numeric" maxlength="4" placeholder="0000" autocomplete="off">
          </div>
          <div class="field">
            <label for="nova">Nig&amp;Jop</label>
            <input id="nova" inputmode="numeric" maxlength="4" placeholder="0000" autocomplete="off">
          </div>
        </div>
        <button class="full" disabled>Enter</button>
        <p class="muted">Entry is wired up in build step 4.</p>
      </div>
      <a href="#bill" class="button secondary full">Bill</a>
    `;
  },

  history() {
    app.innerHTML = `<h1>History</h1><div class="card muted">Coming in build step 5.</div>`;
  },

  bill() {
    app.innerHTML = `<h1>Bill</h1><div class="card muted">Coming in build step 6.</div>`;
  },

  async data() {
    app.innerHTML = `<h1>Data</h1><div class="card muted">Loading…</div>`;
    const [readings, bills, lastBackup, persisted] = await Promise.all([
      count('readings'),
      count('bills'),
      getMeta('lastBackup'),
      navigator.storage?.persisted ? navigator.storage.persisted() : false,
    ]);
    app.innerHTML = `
      <h1>Data</h1>
      <div class="card">
        <table class="kv">
          <tr><td>Readings</td><td>${readings}</td></tr>
          <tr><td>Bills</td><td>${bills}</td></tr>
          <tr><td>Last backup</td><td>${lastBackup || 'never'}</td></tr>
          <tr><td>Persistent storage</td><td>${persisted ? 'yes' : 'no'}</td></tr>
        </table>
      </div>
      <p class="muted">Import and Export are added in build steps 2 and 7.</p>
    `;
  },
};

// ---------- Router ----------

function render() {
  const name = location.hash.slice(1) || 'daily';
  const screen = screens[name] || screens.daily;
  document.querySelectorAll('[data-nav]').forEach((a) => {
    a.classList.toggle('active', a.dataset.nav === name);
  });
  screen();
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
