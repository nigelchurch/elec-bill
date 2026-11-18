// Bill screen: enter the utility bill figures for a month, then Generate:
//   1. check there is a reading for every day from the 1st to the 1st of next month
//   2. calculate the split and save the bill record
//   3. build the PDF and show a preview of it on the screen
// The result then offers Share PDF (share sheet) and Save PDF (to Downloads).
// Each of those is its own tap, so only one dialog ever appears at a time.

import { getAll, get, put, getMeta } from './db.js';
import { indexByDate, monthUsage, billSplit, billRows, addDays } from './calc.js';
import { buildBillPdf, pdfFilename } from './pdf.js';
import { downloadBlob, shareFile } from './files.js';
import { NAMES, todayISO, fmtNum, fmtMonth, fmtDateRanges, esc } from './format.js';

const FIELDS = [
  { key: 'P', label: 'P', unit: 'kWh' },
  { key: 'OP', label: 'OP', unit: 'kWh' },
  { key: 'H', label: 'H', unit: 'kWh' },
  { key: 'total_baht', label: 'Total Bill', unit: 'Baht' },
];

// The check pop-up shows the rate in bold red above this (Baht/kWh).
const RATE_WARNING = 4.8;

let app;
let month;            // usage month 'YYYY-MM'
let byDate;           // readings by date (loaded when the screen opens)

// The PDF library is a plain script (not a module), loaded once on first use.
let jsPdfPromise = null;
function loadJsPDF() {
  if (!jsPdfPromise) {
    jsPdfPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'lib/jspdf.umd.min.js';
      s.onload = () => resolve(window.jspdf.jsPDF);
      s.onerror = () => { jsPdfPromise = null; reject(new Error('Could not load the PDF library.')); };
      document.head.appendChild(s);
    });
  }
  return jsPdfPromise;
}

// Default: the previous calendar month.
const previousMonth = () => addDays(`${todayISO().slice(0, 7)}-01`, -1).slice(0, 7);

export async function renderBill(container) {
  app = container;
  month = previousMonth();
  loadJsPDF().catch(() => {}); // start loading now, so Generate is quick
  byDate = indexByDate(await getAll('readings'));

  app.innerHTML = `
    <h1>Bill</h1>
    <form id="billForm" class="card" autocomplete="off">
      <div class="field">
        <label for="month">Usage month</label>
        <input id="month" type="month" value="${month}" required>
        <div id="readStatus" class="hint"></div>
      </div>
      <div class="grid2">
        ${FIELDS.map((f) => `
          <div class="field">
            <label for="f-${f.key}">${f.label} <span class="muted small">(${f.unit})</span></label>
            <input id="f-${f.key}" inputmode="decimal" placeholder="0.00">
          </div>`).join('')}
      </div>
      <button type="submit" class="full">Generate</button>
      <p id="billMsg" class="error"></p>
    </form>
    <div id="billResult"></div>
    <h2>Saved bills</h2>
    <div id="billList"></div>
  `;

  document.getElementById('month').addEventListener('change', (e) => {
    if (!e.target.value) return;
    month = e.target.value;
    loadMonth();
  });
  document.getElementById('billForm').addEventListener('submit', (e) => { e.preventDefault(); generate(); });

  // After the 2nd decimal place, jump to the next box (and close the keypad
  // after Total Bill). Tapping a filled box selects it, so typing replaces it.
  FIELDS.forEach((f, i) => {
    const input = document.getElementById(`f-${f.key}`);
    input.addEventListener('focus', () => input.select());
    input.addEventListener('input', () => {
      if (!/\.\d{2}$/.test(input.value)) return;
      const next = FIELDS[i + 1];
      if (next) document.getElementById(`f-${next.key}`).focus();
      else input.blur();
    });
  });

  await loadMonth();
  await drawList();
}

// Show the readings status for the month and pre-fill any saved bill figures.
async function loadMonth() {
  document.getElementById('billMsg').textContent = '';
  document.getElementById('billResult').innerHTML = '';
  const saved = await get('bills', month);
  for (const f of FIELDS) {
    const v = saved?.[f.key];
    document.getElementById(`f-${f.key}`).value = v === null || v === undefined ? '' : v.toFixed(2);
  }
  const usage = monthUsage(byDate, month);
  const status = document.getElementById('readStatus');
  if (usage.missing.length) {
    status.className = 'hint warn';
    status.textContent = `Missing readings: ${fmtDateRanges(usage.missing)}`;
  } else {
    status.className = 'hint';
    status.textContent = `Readings complete: ${NAMES.thip} ${fmtNum(usage.thipUnits)} kWh, ${NAMES.nova} ${fmtNum(usage.novaUnits)} kWh`;
  }
}

// Read the four figures from the form. Returns the values, or null after showing an error.
function readForm() {
  const values = {};
  for (const f of FIELDS) {
    const raw = document.getElementById(`f-${f.key}`).value.replace(/[,\s]/g, '');
    const n = Number(raw);
    if (raw === '' || !Number.isFinite(n) || n <= 0) {
      document.getElementById('billMsg').textContent = `${f.label}: enter a number greater than 0.`;
      return null;
    }
    values[f.key] = Math.round(n * 100) / 100; // 2 decimals, as on the bill
  }
  return values;
}

// Everything the PDF and summary need, from a bill record. Returns null if readings are missing.
function makeBill(rec) {
  const usage = monthUsage(byDate, rec.month);
  if (usage.missing.length) return { missing: usage.missing };
  const split = billSplit({ P: rec.P, OP: rec.OP, H: rec.H, totalBill: rec.total_baht, ...usage });
  return {
    month: rec.month, P: rec.P, OP: rec.OP, H: rec.H, totalBill: rec.total_baht,
    thipUnits: usage.thipUnits, novaUnits: usage.novaUnits, split,
    rows: billRows(byDate, rec.month),
  };
}

async function pdfBlob(bill) {
  const jsPDF = await loadJsPDF();
  return buildBillPdf(jsPDF, bill).output('blob');
}

async function generate() {
  const msg = document.getElementById('billMsg');
  msg.textContent = '';
  const values = readForm();
  if (!values) return;

  const bill = makeBill({ month, ...values });
  if (bill.missing) {
    msg.textContent = `Can't generate: no readings for ${fmtDateRanges(bill.missing)}. `
      + 'Every day from the 1st to the 1st of the next month is needed.';
    return;
  }

  if (!(await confirmSummary(bill))) return;

  try {
    await put('bills', { month, ...values });
    const blob = await pdfBlob(bill);
    await showResult(bill, blob);
    await drawList();
  } catch (err) {
    msg.textContent = `Something went wrong: ${err.message}`;
  }
}

// A check before anything is saved: the key figures, with the rate in bold
// red if it is unusually high (a typo in P/OP/H or the total is the likely cause).
// Resolves true for Continue, false for Cancel.
function confirmSummary(bill) {
  const s = bill.split;
  const high = s.rate > RATE_WARNING;
  const dlg = document.createElement('dialog');
  dlg.className = 'summary';
  dlg.innerHTML = `
    <h2>${fmtMonth(bill.month)}: check before generating</h2>
    <table class="kv">
      <tr><td>Tariff rate</td><td class="${high ? 'rate-high' : ''}">${fmtNum(s.rate, 2)} Baht/kWh</td></tr>
      <tr><td>${esc(NAMES.thip)} · ${fmtNum(bill.thipUnits)} kWh</td><td>${fmtNum(s.A)} Baht</td></tr>
      <tr><td>${esc(NAMES.nova)} · ${fmtNum(bill.novaUnits)} kWh</td><td>${fmtNum(s.B)} Baht</td></tr>
      <tr><td>Boy&amp;Yui</td><td>${fmtNum(s.boyYui)} Baht</td></tr>
      <tr><td>Total bill</td><td>${fmtNum(bill.totalBill, 2)} Baht</td></tr>
    </table>
    ${high ? `<p class="rate-high">The rate is above ${fmtNum(RATE_WARNING, 1)} Baht/kWh. Please check P, OP, H and the total.</p>` : ''}
    <div class="row btn-row">
      <button type="button" class="secondary" value="cancel">Cancel</button>
      <button type="button" value="ok">Continue</button>
    </div>`;
  document.body.appendChild(dlg);
  return new Promise((resolve) => {
    dlg.addEventListener('click', (e) => {
      const v = e.target.closest('button')?.value;
      if (v) dlg.close(v);
    });
    dlg.addEventListener('close', () => { // also fires for the phone's Back gesture
      resolve(dlg.returnValue === 'ok');
      dlg.remove();
    });
    dlg.showModal(); // a "modal" dialog: the page behind can't be used until it closes
  });
}

// Summary of the split, Share / Save buttons, and a preview of the PDF itself.
async function showResult(bill, blob) {
  const s = bill.split;
  const filename = pdfFilename(bill.month);
  const lastBackup = await getMeta('lastBackup');
  const result = document.getElementById('billResult');
  result.innerHTML = `
    <div class="card">
      <table class="kv">
        <tr><td>Total units</td><td>${fmtNum(s.totalUnits, 2)} kWh</td></tr>
        <tr><td>Rate</td><td>${fmtNum(s.rate, 2)} Baht/kWh</td></tr>
        <tr><td>${esc(NAMES.thip)} (A) · ${fmtNum(bill.thipUnits)} kWh</td><td>${fmtNum(s.A)} Baht</td></tr>
        <tr><td>${esc(NAMES.nova)} (B) · ${fmtNum(bill.novaUnits)} kWh</td><td>${fmtNum(s.B)} Baht</td></tr>
        <tr><td>Boy&amp;Yui</td><td>${fmtNum(s.boyYui)} Baht</td></tr>
      </table>
      <div class="row btn-row">
        <button type="button" id="shareBtn">Share PDF</button>
        <button type="button" class="secondary" id="saveBtn">Save PDF</button>
      </div>
      <p class="hint">Last backup: ${lastBackup || 'never'}. <a href="#data">Back up on the Data screen</a></p>
      <p class="hint">Preview: tap to zoom in or out.</p>
      <div class="preview" id="preview"><p class="hint">Preparing preview…</p></div>
    </div>`;
  document.getElementById('shareBtn').addEventListener('click', async () => {
    const r = await shareFile(blob, filename);
    if (r === 'unavailable') alert('Sharing is not available in this browser. Use Save PDF instead.');
  });
  document.getElementById('saveBtn').addEventListener('click', () => downloadBlob(blob, filename));
  result.scrollIntoView({ behavior: 'smooth', block: 'start' });
  renderPreview(blob, document.getElementById('preview'));
}

// Draw page 1 of the PDF into the page with pdf.js (Mozilla's PDF viewer, in
// lib/), so it can be checked without opening another app or tab.
async function renderPreview(blob, container) {
  try {
    const pdfjs = await import('../lib/pdf.min.js');
    pdfjs.GlobalWorkerOptions.workerSrc = 'lib/pdf.worker.min.js'; // does the work in the background
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
    const page = await pdf.getPage(1);
    // Draw at 2× the screen's resolution so it stays sharp when pinch-zoomed.
    const cssWidth = container.clientWidth;
    const scale = (cssWidth / page.getViewport({ scale: 1 }).width) * (window.devicePixelRatio || 1) * 2;
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    await page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport }).promise;
    container.replaceChildren(canvas);
    // Tap to show it at double width (scroll around with a finger); tap again to shrink.
    container.title = 'Tap to zoom';
    container.addEventListener('click', () => container.classList.toggle('zoomed'));
  } catch (err) {
    container.innerHTML = `<p class="hint">Preview not available (${esc(err.message)}). Use Save PDF to view it.</p>`;
  }
}

// Saved bills, newest first. Bills made in the app can be re-shared or
// regenerated; totals imported from the old spreadsheet are listed separately.
async function drawList() {
  const bills = (await getAll('bills')).reverse();
  const made = bills.filter((b) => b.P !== null && b.P !== undefined);
  const imported = bills.filter((b) => b.P === null || b.P === undefined);

  const rows = made.map((b) => `
    <div class="bill-item">
      <div><strong>${fmtMonth(b.month)}</strong><div class="hint">${fmtNum(b.total_baht, 2)} Baht</div></div>
      <div class="bill-actions">
        <button type="button" class="secondary small-btn" data-share="${b.month}">Re-share</button>
        <button type="button" class="secondary small-btn" data-regen="${b.month}">Regenerate</button>
      </div>
    </div>`).join('');

  const older = imported.length ? `
    <details class="older">
      <summary>Older totals from the spreadsheet (${imported.length})</summary>
      ${imported.map((b) => `<div class="bill-item"><span>${fmtMonth(b.month)}</span><span>${fmtNum(b.total_baht, 2)} Baht</span></div>`).join('')}
    </details>` : '';

  const list = document.getElementById('billList');
  list.innerHTML = `<div class="card">${rows || '<p class="muted">No bills generated yet.</p>'}${older}</div>`;

  list.querySelectorAll('[data-share]').forEach((btn) => btn.addEventListener('click', () => reshare(btn.dataset.share)));
  list.querySelectorAll('[data-regen]').forEach((btn) => btn.addEventListener('click', () => regenerate(btn.dataset.regen)));
}

// Re-share: rebuild the PDF from the saved figures and open the share sheet.
async function reshare(m) {
  const bill = makeBill(await get('bills', m));
  if (bill.missing) {
    alert(`Readings are now missing for ${fmtDateRanges(bill.missing)}.`);
    return;
  }
  const blob = await pdfBlob(bill);
  const filename = pdfFilename(m);
  const r = await shareFile(blob, filename);
  if (r === 'unavailable') {
    downloadBlob(blob, filename);
    alert(`Sharing is not available here, so ${filename} was saved to Downloads instead.`);
  }
}

// Regenerate: load the month into the form and run Generate again (e.g. after
// a reading was corrected).
async function regenerate(m) {
  month = m;
  document.getElementById('month').value = m;
  await loadMonth();
  window.scrollTo({ top: 0, behavior: 'smooth' });
  await generate();
}
