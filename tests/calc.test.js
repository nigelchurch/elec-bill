// Tests for js/calc.js. Run from the project folder with:
//     node --test
// (Node's built-in test runner; finds files named *.test.js.)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  addDays, daysBetween, daysInMonth, nextMonth, rollover, interpolate, applyReading, missedDays,
  previousReading, nextRealReading,
  indexByDate, usageOn, median, recentRealUsages, sanityCheck, seasonalTypical,
  yesterdayComparison, monthUsage, billSplit, billRows, measuredAverage,
} from '../js/calc.js';
import { parseBackup } from '../js/csv.js';

const near = (actual, expected, tol = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= tol, `expected ${expected}, got ${actual}`);

const rec = (date, thip, nova, thip_est = false, nova_est = false) => ({ date, thip, nova, thip_est, nova_est });

// ---------- Dates ----------

test('date helpers', () => {
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(addDays('2024-03-01', -1), '2024-02-29'); // leap year
  assert.equal(daysBetween('2026-10-28', '2026-11-02'), 5);
  assert.equal(daysInMonth('2026-02').length, 28);
  assert.equal(daysInMonth('2026-10').at(-1), '2026-10-31');
  assert.equal(nextMonth('2026-10'), '2026-11');
  assert.equal(nextMonth('2026-12'), '2027-01');
});

// ---------- Rollover ----------

test('rollover: normal, across 10,000, first ever, from fractional estimate', () => {
  assert.equal(rollover(28074, 8076), 28076);
  assert.equal(rollover(44659, 4682), 44682);
  assert.equal(rollover(39995, 12), 40012);      // meter passes 40,000
  assert.equal(rollover(28074, 8074), 28074);    // unchanged
  assert.equal(rollover(28074, 8073), 38073);    // one less = huge jump (sanity check catches it)
  assert.equal(rollover(null, 4622), 4622);
  assert.equal(rollover(27976.916666666653, 7984), 27984);
});

// ---------- Interpolation and gap-filling ----------

test('interpolate fills the days strictly between', () => {
  const g = interpolate('2026-11-01', 100, '2026-11-05', 120);
  assert.deepEqual(g.map((x) => x.date), ['2026-11-02', '2026-11-03', '2026-11-04']);
  assert.deepEqual(g.map((x) => x.value), [105, 110, 115]);
  assert.deepEqual(interpolate('2026-11-01', 100, '2026-11-02', 120), []);
});

test('applyReading: next day, no gap', () => {
  const readings = [rec('2026-11-16', 28073, 44636), rec('2026-11-17', 28074, 44659)];
  const out = applyReading(readings, 'nova', '2026-11-18', 44682);
  assert.deepEqual(out, [rec('2026-11-18', null, 44682)]);
});

test('applyReading: gap of missed days is interpolated and flagged', () => {
  const readings = [rec('2026-11-17', 28074, 44659)];
  const out = applyReading(readings, 'nova', '2026-11-21', 44759); // 4 days, 25/day
  assert.deepEqual(out.map((r) => [r.date, r.nova, r.nova_est]), [
    ['2026-11-18', 44684, true],
    ['2026-11-19', 44709, true],
    ['2026-11-20', 44734, true],
    ['2026-11-21', 44759, false],
  ]);
  // The other meter is untouched in new records.
  assert.equal(out[0].thip, null);
});

test('applyReading with fill = false leaves the missed days blank', () => {
  const readings = [rec('2026-11-17', 28074, 44659)];
  const out = applyReading(readings, 'nova', '2026-11-21', 44759, false);
  assert.deepEqual(out.map((r) => [r.date, r.nova, r.nova_est]), [['2026-11-21', 44759, false]]);
});

test('missedDays lists the blank days before a reading', () => {
  const readings = [rec('2026-11-17', 28074, 44659), rec('2026-11-19', null, 44700)];
  assert.deepEqual(missedDays(readings, 'nova', '2026-11-22'), ['2026-11-20', '2026-11-21']);
  assert.deepEqual(missedDays(readings, 'nova', '2026-11-20'), []);
  assert.deepEqual(missedDays(readings, 'thip', '2026-11-19'), ['2026-11-18']);
  assert.deepEqual(missedDays([], 'nova', '2026-11-20'), []);
});

test('applyReading: real value entered inside an estimated gap re-interpolates both sides', () => {
  const readings = [
    rec('2026-11-01', 0, 100),
    rec('2026-11-02', 0, 110, false, true),
    rec('2026-11-03', 0, 120, false, true),
    rec('2026-11-04', 0, 130, false, true),
    rec('2026-11-05', 0, 140),
  ];
  const out = applyReading(readings, 'nova', '2026-11-03', 130);
  const v = Object.fromEntries(out.map((r) => [r.date, [r.nova, r.nova_est]]));
  assert.deepEqual(v['2026-11-02'], [115, true]);
  assert.deepEqual(v['2026-11-03'], [130, false]);
  assert.deepEqual(v['2026-11-04'], [135, true]);
});

test('applyReading: editing a real value next to a gap re-interpolates that gap', () => {
  const readings = [
    rec('2026-11-01', 0, 100),
    rec('2026-11-02', 0, 110, false, true),
    rec('2026-11-03', 0, 120),
  ];
  const out = applyReading(readings, 'nova', '2026-11-03', 140); // corrected value
  const v = Object.fromEntries(out.map((r) => [r.date, r.nova]));
  assert.equal(v['2026-11-02'], 120);
  assert.equal(v['2026-11-03'], 140);
});

test('previousReading / nextRealReading', () => {
  const readings = [
    rec('2026-11-01', 5, 100),
    rec('2026-11-02', null, 110, false, true),
    rec('2026-11-03', 7, 120),
  ];
  assert.equal(previousReading(readings, 'nova', '2026-11-03').date, '2026-11-02'); // estimates count
  assert.equal(previousReading(readings, 'thip', '2026-11-03').date, '2026-11-01'); // skips null
  assert.equal(previousReading(readings, 'nova', '2026-11-01'), null);
  assert.equal(nextRealReading(readings, 'nova', '2026-11-01').date, '2026-11-03'); // skips estimate
  assert.equal(nextRealReading(readings, 'nova', '2026-11-03'), null);
});

// ---------- Usage ----------

test('usageOn: reading(D+1) − reading(D), estimated if either end is', () => {
  const m = indexByDate([rec('2026-10-31', 0, 100), rec('2026-11-01', 0, 123), rec('2026-11-02', 0, 140, false, true)]);
  assert.deepEqual(usageOn(m, 'nova', '2026-10-31'), { usage: 23, est: false });
  assert.deepEqual(usageOn(m, 'nova', '2026-11-01'), { usage: 17, est: true });
  assert.equal(usageOn(m, 'nova', '2026-11-02'), null);
});

test('median', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  assert.equal(median([]), null);
});

// ---------- Sanity check ----------

test('sanity check: normal day passes', () => {
  const s = sanityCheck({ prevDate: '2026-11-17', prevFull: 44659, date: '2026-11-18', newFull: 44682, recentUsages: [20, 22, 25, 18] });
  assert.equal(s.suspicious, false);
  assert.equal(s.perDay, 23);
});

test('sanity check: digits lower than yesterday are reported as going backwards', () => {
  const s = sanityCheck({ prevDate: '2026-11-17', prevFull: 28074, date: '2026-11-18', newFull: rollover(28074, 8073), recentUsages: [1, 2, 1] });
  assert.equal(s.suspicious, true);
  assert.equal(s.reasons[0], '8073 is lower than the previous reading 8074 (2026-11-17), but the meter can only go up');
});

test('sanity check: genuine rollover past 10,000 passes', () => {
  const s = sanityCheck({ prevDate: '2026-11-17', prevFull: 39995, date: '2026-11-18', newFull: rollover(39995, 18), recentUsages: [20, 22, 25] });
  assert.equal(s.perDay, 23);
  assert.equal(s.suspicious, false);
});

test('sanity check: a typo giving a huge jump is extremely high', () => {
  const s = sanityCheck({ prevDate: '2026-11-17', prevFull: 44659, date: '2026-11-18', newFull: rollover(44659, 5682), recentUsages: [20, 22, 25] });
  assert.match(s.reasons[0], /1023 kWh\/day is extremely high/);
});

test('sanity check: past date entered above the next reading is flagged', () => {
  const base = { prevDate: '2026-11-15', prevFull: 44618, date: '2026-11-16', recentUsages: [20, 22, 25], nextDate: '2026-11-17', nextFull: 44659 };
  assert.equal(sanityCheck({ ...base, newFull: 44636 }).suspicious, false);
  const s = sanityCheck({ ...base, newFull: 44663 });
  assert.equal(s.suspicious, true);
  assert.match(s.reasons[0], /higher than the next reading 4659 \(2026-11-17\)/);
});

test('sanity check: far above recent median is flagged', () => {
  // Thip median 2 -> limit 3*2+10 = 16
  const base = { prevDate: '2026-11-17', prevFull: 28074, date: '2026-11-18', recentUsages: [1, 2, 2, 3] };
  assert.equal(sanityCheck({ ...base, newFull: 28090 }).suspicious, false); // 16
  assert.equal(sanityCheck({ ...base, newFull: 28091 }).suspicious, true);  // 17
});

test('sanity check: averages over a multi-day gap (away period passes)', () => {
  const s = sanityCheck({ prevDate: '2026-11-01', prevFull: 44000, date: '2026-11-11', newFull: 44075, recentUsages: [22, 25, 20] });
  assert.equal(s.days, 10);
  near(s.perDay, 7.5);
  assert.equal(s.suspicious, false);
});

// ---------- Real data (only if data/initial-import.csv exists; it is not in git) ----------

const CSV = new URL('../data/initial-import.csv', import.meta.url);
const haveData = fs.existsSync(CSV);
const real = haveData ? parseBackup(fs.readFileSync(CSV, 'utf8')) : null;
const byDate = haveData ? indexByDate(real.readings) : null;

test('October 2026 acceptance test (reference PDF)', { skip: !haveData && 'no data/initial-import.csv' }, () => {
  const u = monthUsage(byDate, '2026-10');
  assert.deepEqual(u.missing, []);
  const b = billSplit({ P: 3840.30, OP: 1766.54, H: 3529.10, totalBill: 39389.23, ...u });
  assert.equal(b.totalUnits.toFixed(2), '9135.94');
  assert.equal(b.rate.toFixed(2), '4.31');
  assert.equal(Math.round(u.thipUnits), 137);
  assert.equal(Math.round(u.novaUnits), 549);
  assert.equal(Math.round(b.A), 590);
  assert.equal(Math.round(b.B), 2368);
  assert.equal(Math.round(b.boyYui), 36431);
  near(b.A + b.B + b.boyYui, 39389.23, 1e-6); // the three shares add up to the bill
});

test('billRows: one row per day, usages sum to the month totals', { skip: !haveData && 'no data' }, () => {
  const rows = billRows(byDate, '2026-10');
  assert.equal(rows.length, 31);
  assert.equal(rows[0].date, '2026-10-01');
  assert.equal(rows[30].date, '2026-10-31');
  const u = monthUsage(byDate, '2026-10');
  near(rows.reduce((s, r) => s + r.thipUse, 0), u.thipUnits, 1e-6);
  near(rows.reduce((s, r) => s + r.novaUse, 0), u.novaUnits, 1e-6);
  assert.equal(rows[0].novaUseEst, true);   // 1–10 Oct 2026 was an away period
  assert.equal(rows[20].novaUseEst, false);
});

test('monthUsage reports missing dates (Nov 2026 is incomplete)', { skip: !haveData && 'no data' }, () => {
  const u = monthUsage(byDate, '2026-11');
  assert.equal(u.missing[0], '2026-11-18');
  assert.equal(u.missing.at(-1), '2026-12-01');
  assert.equal(u.thipUnits, null);
});

test('seasonal typical and yesterday comparison on real data', { skip: !haveData && 'no data' }, () => {
  const typ = seasonalTypical(byDate, 'nova', 11, 2026);
  assert.ok(typ > 10 && typ < 40, `Nova November typical ${typ}`);
  const y = yesterdayComparison(byDate, 'nova', '2026-11-17');
  assert.equal(y.date, '2026-11-16');
  assert.equal(y.usage, 23); // 44659 − 44636
  near(y.typical, typ);
  console.log(`    Nova yesterday: ${y.usage} kWh (Nov typical: ${Math.round(y.typical)}, ${y.diffPct >= 0 ? '+' : ''}${Math.round(y.diffPct)}%)`);
});

test('recent real usages skip estimated days', { skip: !haveData && 'no data' }, () => {
  // 2023-02-28 follows the away period of 22–28 Feb 2023.
  const r = recentRealUsages(byDate, 'nova', '2023-03-01', 3);
  assert.equal(r.length, 3);
  assert.ok(r.every((x) => Number.isInteger(x)));
});

test('measuredAverage: average daily usage of measured days only', () => {
  const byDate = indexByDate([
    { date: '2026-01-01', thip: 100, nova: 1000 },
    { date: '2026-01-02', thip: 102, nova: 1020 },               // usage 1 Jan: 2, 20
    { date: '2026-01-03', thip: 104, nova: 1050, nova_est: 1 },  // 2 Jan: 2, (30 est)
    { date: '2026-01-04', thip: 110, nova: 1080 },               // 3 Jan: 6, (30 est)
  ]);
  const days = ['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04']; // 4 Jan has no next reading
  assert.equal(measuredAverage(byDate, 'thip', days), 10 / 3);
  assert.equal(measuredAverage(byDate, 'nova', days), 20);
  assert.equal(measuredAverage(byDate, 'nova', ['2026-01-02']), null);
});
