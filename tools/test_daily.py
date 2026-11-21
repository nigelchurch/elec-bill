"""Browser test of the Daily screen:
  - the boxes use the phone's number keyboard; typing 4 digits in Gaae&Thip
    moves on to Nig&Jop
  - entering a reading after days with no reading asks "Unfilled readings":
    No leaves them blank, Yes fills them (estimated), Back saves nothing.
  - 0000 offers to clear the day, or save a real 0000; correcting a wrong
    reading renumbers the readings after it.

Uses data/initial-import.csv, whose last reading is 17 Nov 2026, so today's
date (on this PC) must be at least 19 Nov 2026.

    python tools/test_daily.py
"""
import sys
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from browser import app_session, SCREENS, ROOT  # noqa: E402

OUT = ROOT / "data" / "screenshots"
LAST = date(2026, 11, 17)          # last reading in the import file
TODAY = date.today()
GAP = [(LAST + timedelta(days=i)).isoformat() for i in range(1, (TODAY - LAST).days)]
failures = []


def check(name, ok, detail=""):
    print(f"{'PASS' if ok else 'FAIL'}  {name}{'  - ' + str(detail) if detail else ''}")
    if not ok:
        failures.append(name)


def record(page, day):
    """The saved reading record for a date, or None."""
    return page.evaluate("""(day) => new Promise((res) => {
        const r = indexedDB.open('elecbill');
        r.onsuccess = () => {
            const q = r.result.transaction('readings').objectStore('readings').get(day);
            q.onsuccess = () => res(q.result ?? null);
        };
    })""", day)


def type_in(page, box, digits):
    """Tap a box and type into it, as on the phone."""
    page.tap(f"#in-{box}")
    page.keyboard.type(digits)


def open_day(page, day):
    page.fill("#date", day)
    page.dispatch_event("#date", "change")
    page.wait_for_selector(f"#date[value='{day}']")
    page.wait_for_timeout(200)


def enter(page, thip=None, nova=None):
    for m, v in (("thip", thip), ("nova", nova)):
        if v is not None:
            page.fill(f"#in-{m}", v)
    page.click("#enterBtn")


if len(GAP) < 1:
    raise SystemExit("Needs today to be at least 19 Nov 2026 (a day with no reading before it).")

for size in ("outer", "fold5", "inner"):
    with app_session(SCREENS[size]) as page:
        page.reload()                          # a fresh start, as when opening the app
        page.wait_for_selector("#dailyForm")
        page.wait_for_timeout(300)
        if size != "outer":
            page.screenshot(path=str(OUT / f"daily-{size}.png"))
            type_in(page, "thip", "80804760")
            page.click("#enterBtn")
            page.wait_for_selector("dialog.summary[open]")
            page.screenshot(path=str(OUT / f"daily-fill-{size}.png"))
            continue

        page.screenshot(path=str(OUT / "daily-outer.png"))
        check("Boxes use the phone's number keyboard",
              page.eval_on_selector_all("#in-thip, #in-nova", "els => els.every(e => e.inputMode === 'numeric')"))
        type_in(page, "thip", "8080")
        check("4 digits in Gaae&Thip, cursor moves on to Nig&Jop",
              page.evaluate("document.activeElement?.id") == "in-nova", page.input_value("#in-thip"))
        page.keyboard.type("4760")
        page.tap("#enterBtn")
        page.wait_for_selector("dialog.summary[open]")
        text = page.text_content("dialog.summary")
        check("Pop-up lists both meters and the missed days",
              "Unfilled readings" in text and "Gaae&Thip" in text and "Nig&Jop" in text
              and f"{len(GAP)} day" in text, " ".join(text.split()))
        page.screenshot(path=str(OUT / "daily-fill-outer.png"))

        # Back (Escape on a PC) closes it and saves nothing.
        page.keyboard.press("Escape")
        page.wait_for_selector("dialog.summary", state="detached")
        check("Back: nothing saved", record(page, TODAY.isoformat()) is None)

        # No: today's reading saved, the missed days stay blank.
        page.click("#enterBtn")
        page.click("dialog.summary button[value=no]")
        page.wait_for_selector("dialog.summary", state="detached")
        page.wait_for_timeout(300)
        rec = record(page, TODAY.isoformat())
        check("No: today's reading saved", rec and rec["thip_est"] is False and rec["nova_est"] is False, rec)
        check("No: missed days left blank", all(record(page, d) is None for d in GAP))

        # Change Gaae&Thip; Nig&Jop is unchanged but still has blank days, so both are offered.
        enter(page, thip="8081")
        page.wait_for_selector("dialog.summary[open]")
        text = page.text_content("dialog.summary")
        check("Second time asks again, for both meters", "Gaae&Thip" in text and "Nig&Jop" in text,
              " ".join(text.split()))
        page.click("dialog.summary button[value=yes]")
        page.wait_for_selector("dialog.summary", state="detached")
        page.wait_for_timeout(300)
        recs = [record(page, d) for d in GAP]
        check("Yes: missed days filled and marked estimated",
              all(r and r["thip"] is not None and r["thip_est"] and r["nova"] is not None and r["nova_est"] for r in recs),
              [(r["date"], round(r["thip"], 1)) for r in recs if r])
        check("Filled values lie between the readings",
              all(28074 < r["thip"] < 28081 for r in recs))

        # A reading with no gap before it (18-20 Nov now estimated): no pop-up.
        enter(page, thip="8082")
        page.wait_for_timeout(500)
        check("No gap: no pop-up", page.locator("dialog.summary").count() == 0 and record(page, TODAY.isoformat())["thip"] == 28082, (page.locator("dialog.summary").count(), record(page, TODAY.isoformat()), page.text_content("#dailyMsg")))

        # 0000 on today's Gaae&Thip: offer to clear it (and the estimates next to it).
        open_day(page, TODAY.isoformat())
        type_in(page, "thip", "0000")
        page.tap("#enterBtn")
        page.wait_for_selector("dialog.summary[open]")
        text = " ".join(page.text_content("dialog.summary").split())
        check("0000 asks: clear, or meter really shows 0000",
              "0000 for Gaae&Thip" in text and f"{len(GAP)} estimated day" in text, text)
        page.locator("dialog.summary").screenshot(path=str(OUT / "daily-zero-dialog.png"))
        page.click("dialog.summary button[value=clear]")
        page.wait_for_selector("dialog.summary", state="detached")
        page.wait_for_timeout(300)
        rec = record(page, TODAY.isoformat())
        check("Clear: today's Gaae&Thip blank, Nig&Jop kept", rec["thip"] is None and rec["nova"] == 44760, rec)
        check("Clear: the estimates next to it cleared too", all(record(page, d)["thip"] is None for d in GAP))

        # A wrong 0000 saved as a real reading on the 14th (taken as passing
        # 30,000), then corrected: the days after it must follow.
        open_day(page, "2026-11-14")
        type_in(page, "thip", "0000")
        page.tap("#enterBtn")
        page.click("dialog.summary button[value=real]")   # the "Are you sure?" is accepted
        page.wait_for_timeout(400)
        check("Real 0000 saved; later readings follow it",
              record(page, "2026-11-14")["thip"] == 30000 and record(page, "2026-11-15")["thip"] == 38072,
              (record(page, "2026-11-14")["thip"], record(page, "2026-11-15")["thip"]))
        type_in(page, "thip", "8071")
        page.tap("#enterBtn")
        page.wait_for_timeout(400)
        later = [record(page, f"2026-11-{d}")["thip"] for d in (14, 15, 16, 17)]
        check("Corrected: later readings renumbered back", later == [28071, 28072, 28073, 28074], later)

        # History: the current month starts open, older months closed.
        page.goto(page.base + "#history")
        page.wait_for_selector("table.hist tr.month")
        ym = TODAY.strftime("%Y-%m")
        open_months = page.eval_on_selector_all("tbody.open", "els => els.map(e => e.dataset.month)")
        check("History: only the current month open", open_months == [ym], open_months)
        check("No JavaScript errors", not page.errors, page.errors)

print("ALL PASS" if not failures else f"FAILED: {failures}")
sys.exit(1 if failures else 0)
