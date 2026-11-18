// App entry point: registers the service worker, asks for persistent storage,
// and switches between screens.
//
// Navigation uses the URL "hash" (#daily, #history, #bill, #data); js/nav.js keeps
// the Back button app-like (Back goes to Daily, then closes the app). Changing the
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
import { navigate, initNav } from './nav.js';

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

// Which screen the URL hash names ('daily' if none or unknown).
function currentScreen() {
  const name = location.hash.slice(1).split('?')[0];
  return screens[name] ? name : 'daily';
}

// Screen order, as in the top bar. Used for swipes and for which way pages slide.
const ORDER = ['daily', 'history', 'bill', 'data'];
let shownScreen = null; // the screen currently drawn
let currentTransition = null; // the page slide in progress, if any
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

function render() {
  const query = location.hash.split('?')[1] || '';
  const name = currentScreen();
  const params = new URLSearchParams(query);
  const draw = () => {
    app.style.transition = app.style.transform = ''; // undo any finger drag (see below)
    document.querySelectorAll('[data-nav]').forEach((a) => {
      a.classList.toggle('active', a.dataset.nav === name);
    });
    return screens[name](params); // a Promise for async screens, so callers can await the redraw
  };

  const from = shownScreen;
  shownScreen = name;
  // Slide only when moving to a different screen (not on a redraw of the same
  // one, nor at start-up), and only if the browser supports View Transitions.
  if (!from || from === name || !document.startViewTransition || reduceMotion.matches) return draw();

  // Later screens (in top-bar order) come in from the right, earlier ones from the left.
  const forward = ORDER.indexOf(name) > ORDER.indexOf(from);
  const root = document.documentElement;
  root.classList.remove('go-next', 'go-prev');
  root.classList.add(forward ? 'go-next' : 'go-prev');
  const transition = document.startViewTransition(draw);
  currentTransition = transition;
  transition.finished.finally(() => {
    // If another page change started meanwhile (it cuts this one short), leave
    // its settings alone, or it would lose its direction and just cross-fade.
    if (currentTransition !== transition) return;
    root.classList.remove('go-next', 'go-prev');
    root.style.removeProperty('--drag');
  });
  return transition.updateCallbackDone;
}

window.addEventListener('hashchange', render);

// ---------- Swipe between screens ----------
// Drag sideways and the page follows your finger. Let go past about a third of
// the screen (or flick quickly) and it carries on to the next screen in
// top-bar order; otherwise it springs back. At the first and last screens it
// only stretches a little. Ignored inside the zoomed PDF preview (where
// sideways scrolls it) and in pop-ups.

const SWIPE = {
  DECIDE_PX: 10,      // movement before deciding: sideways drag or normal scroll?
  COMMIT_FRACTION: 0.33, // drag past this share of the screen width to change page
  FLICK_PX: 50,       // ...or a quick flick of at least this many px
  FLICK_MS: 300,      //    within this many milliseconds
  EDGE_RESIST: 0.25,  // at the first/last screen the page moves only this much
};
let drag = null; // { x, y, time, mode: null | 'x' | 'scroll', dx }

// The screen a drag of dx would go to (or undefined at the ends).
const neighbour = (dx) => ORDER[ORDER.indexOf(currentScreen()) + (dx < 0 ? 1 : -1)];

document.addEventListener('touchstart', (e) => {
  const t = e.touches[0];
  drag = e.touches.length === 1 && !e.target.closest('.preview.zoomed, dialog')
    ? { x: t.clientX, y: t.clientY, time: Date.now(), mode: null, dx: 0 }
    : null;
}, { passive: true });

// Not passive: once a drag is clearly sideways we stop the page also scrolling
// up and down under the finger. Up/down scrolls are never blocked.
document.addEventListener('touchmove', (e) => {
  if (!drag) return;
  if (e.touches.length > 1) { cancelDrag(); return; }
  const t = e.touches[0];
  const dx = t.clientX - drag.x;
  const dy = t.clientY - drag.y;
  if (!drag.mode) {
    if (Math.hypot(dx, dy) < SWIPE.DECIDE_PX) return;
    drag.mode = Math.abs(dx) > 1.5 * Math.abs(dy) ? 'x' : 'scroll';
    if (drag.mode === 'x') app.style.transition = 'none';
  }
  if (drag.mode !== 'x') return;
  if (e.cancelable) e.preventDefault();
  drag.dx = dx;
  const shown = neighbour(dx) ? dx : dx * SWIPE.EDGE_RESIST;
  app.style.transform = `translateX(${shown}px)`;
}, { passive: false });

document.addEventListener('touchend', () => {
  if (!drag || drag.mode !== 'x') { drag = null; return; }
  const { dx, time } = drag;
  drag = null;
  const target = neighbour(dx);
  const far = Math.abs(dx) > window.innerWidth * SWIPE.COMMIT_FRACTION;
  const flick = Math.abs(dx) > SWIPE.FLICK_PX && Date.now() - time < SWIPE.FLICK_MS;
  if (target && (far || flick)) {
    // Carry on from where the finger left the page (see the page-in/out
    // animations in styles.css, which start from --drag).
    document.documentElement.style.setProperty('--drag', `${dx}px`);
    navigate(`#${target}`);
  } else {
    springBack();
  }
});

document.addEventListener('touchcancel', cancelDrag);

function cancelDrag() {
  if (drag?.mode === 'x') springBack();
  drag = null;
}

function springBack() {
  app.style.transition = 'transform 0.2s ease-out';
  app.style.transform = '';
}

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
  initNav(); // Back button: see js/nav.js
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
