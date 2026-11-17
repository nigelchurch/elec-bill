"""One-off converter: BUDGET.xlsx -> data/initial-import.csv (the app's backup format).

Run from the project folder:
    python tools/convert_budget.py

Needs openpyxl:  python -m pip install openpyxl

What it reads (sheet "Electric bill"):
  - Daily log from row 6: B = date, E = Gaae&Thip reading, F = Nig&Jop reading.
    Stops at the first row where both E and F are blank (later rows are future dates).
  - Monthly bill history: S = month (a date on the 1st), T = total Baht, rows 4-17.

Estimated readings (past away periods, where the readings were spread out evenly
by hand) are detected with three rules:
  1. The reading is not a whole number (real meter readings are always integers).
  2. It lies inside a run of >= 3 consecutive days of identical daily usage whose
     value is not a whole number (only interpolation produces that).
  3. It lies inside a window of >= 3 days where BOTH meters have constant daily
     usage at the same time. A whole-number run on one meter alone is usually
     genuine (Thip often really does use exactly 1 kWh/day), but when both meters
     go flat together, nobody was reading them.
Only the readings *inside* a run are estimated. The first and last readings of a
run are the real readings the interpolation was drawn between.
"""

import csv
import sys
from datetime import date, timedelta
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "BUDGET.xlsx"
OUT = ROOT / "data" / "initial-import.csv"

COLUMNS = ["type", "key", "thip", "nova", "thip_est", "nova_est", "P", "OP", "H", "total_baht"]
RUN_MIN = 3        # minimum run length in days
SAME = 0.01        # usages within this are "identical"
METERS = ("thip", "nova")


def read_sheet():
    wb = openpyxl.load_workbook(SRC, data_only=True)  # data_only: cached formula results, not formulas
    ws = wb["Electric bill"]

    readings = []  # list of dicts in date order
    for r in range(6, ws.max_row + 1):
        d, thip, nova = ws.cell(r, 2).value, ws.cell(r, 5).value, ws.cell(r, 6).value
        if thip is None and nova is None:
            break
        readings.append({"date": d.date(), "thip": thip, "nova": nova})

    bills = []
    for r in range(4, 18):
        month, total = ws.cell(r, 19).value, ws.cell(r, 20).value
        if month is not None and total is not None:
            bills.append({"month": month.date(), "total": total})
    return readings, bills


def usages(readings, meter):
    """usage[i] = reading[i+1] - reading[i], or None if either reading is missing."""
    out = []
    for a, b in zip(readings, readings[1:]):
        out.append(None if a[meter] is None or b[meter] is None else b[meter] - a[meter])
    return out


def flat_runs(flags):
    """Given a list of booleans ('usage i equals usage i-1'), return (start, end) usage
    index ranges of maximal runs of identical usage that are >= RUN_MIN long."""
    runs, i, n = [], 0, len(flags)
    while i < n:
        j = i
        while j + 1 < n and flags[j + 1]:
            j += 1
        if j - i + 1 >= RUN_MIN:
            runs.append((i, j))
        i = j + 1
    return runs


def same_as_prev(u):
    """flags[i] = True if usage i equals usage i-1 (both present)."""
    return [i > 0 and u[i] is not None and u[i - 1] is not None and abs(u[i] - u[i - 1]) <= SAME
            for i in range(len(u))]


def is_whole(x):
    return abs(x - round(x)) < 1e-6


def detect_estimates(readings):
    for rec in readings:
        for m in METERS:
            rec[m + "_est"] = rec[m] is not None and not is_whole(rec[m])  # rule 1

    u = {m: usages(readings, m) for m in METERS}
    same = {m: same_as_prev(u[m]) for m in METERS}

    def mark_inside(start, end, meters):
        # Usage days start..end are equal, so readings start+1 .. end are interpolated.
        for k in range(start + 1, end + 1):
            for m in meters:
                if readings[k][m] is not None:
                    readings[k][m + "_est"] = True

    # Rule 2: single-meter runs with a fractional step.
    for m in METERS:
        for s, e in flat_runs(same[m]):
            if not is_whole(u[m][s]):
                mark_inside(s, e, [m])

    # Rule 3: both meters flat over the same days.
    # both[i] = True if usage i equals usage i-1 on BOTH meters. A run of True flags
    # i..j means usages i-1..j are constant on both meters.
    both = [same["thip"][i] and same["nova"][i] for i in range(len(u["thip"]))]
    i, n = 0, len(both)
    while i < n:
        if both[i]:
            j = i
            while j + 1 < n and both[j + 1]:
                j += 1
            start, end = i - 1, j          # usage indices of the joint constant window
            if end - start + 1 >= RUN_MIN:
                mark_inside(start, end, METERS)
            i = j + 1
        else:
            i += 1
    return readings


def fmt(x):
    """Numbers as plain text: integers without '.0', floats at full precision."""
    if x is None:
        return ""
    if isinstance(x, float) and x.is_integer():
        return str(int(x))
    return repr(x)


def write_csv(readings, bills):
    OUT.parent.mkdir(exist_ok=True)
    with open(OUT, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(COLUMNS)
        for rec in readings:
            w.writerow(["reading", rec["date"].isoformat(), fmt(rec["thip"]), fmt(rec["nova"]),
                        int(rec["thip_est"]), int(rec["nova_est"]), "", "", "", ""])
        for b in bills:
            w.writerow(["bill", b["month"].strftime("%Y-%m"), "", "", "", "", "", "", "", fmt(b["total"])])


def check(readings, bills):
    """Print verification figures, including the October 2026 acceptance test."""
    print(f"Readings: {len(readings)}  ({readings[0]['date']} .. {readings[-1]['date']})")
    for m in METERS:
        present = [r for r in readings if r[m] is not None]
        est = sum(r[m + "_est"] for r in readings)
        print(f"  {m}: {len(present)} readings from {present[0]['date']}, {est} estimated")
    days = [(b['date'] - a['date']).days for a, b in zip(readings, readings[1:])]
    print(f"  date gaps/duplicates: {sum(d != 1 for d in days)}")
    print(f"Bills: {len(bills)}  ({bills[0]['month']:%Y-%m} .. {bills[-1]['month']:%Y-%m})")

    by_date = {r["date"]: r for r in readings}
    a, b = by_date.get(date(2026, 10, 1)), by_date.get(date(2026, 11, 1))
    if a and b:
        P, OP, H, total = 3840.30, 1766.54, 3529.10, 39389.23
        units = P + OP + H
        rate = total / units
        thip = b["thip"] - a["thip"]
        nova = b["nova"] - a["nova"]
        A, B = rate * thip, rate * nova
        print("October 2026 acceptance test:")
        print(f"  total {units:,.2f} kWh, rate {rate:.2f}")
        print(f"  Gaae&Thip {thip:,.0f} kWh -> A {A:,.0f}   (expect 137 -> 590)")
        print(f"  Nig&Jop   {nova:,.0f} kWh -> B {B:,.0f}   (expect 549 -> 2,368)")
        print(f"  Boy&Yui   {total - A - B:,.0f}            (expect 36,431)")


def main():
    if not SRC.exists():
        sys.exit(f"Not found: {SRC}")
    readings, bills = read_sheet()
    detect_estimates(readings)
    write_csv(readings, bills)
    check(readings, bills)
    print(f"Wrote {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
