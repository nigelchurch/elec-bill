"""Browser test of the Daily screen:
  - on opening, the cursor is already in the Gaae&Thip box (today not yet entered)
  - entering a reading after days with no reading asks "Unfilled readings":
    No leaves them blank, Yes fills them (estimated), Back saves nothing.

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
        check(f"[{size}] Cursor in Gaae&Thip on opening",
              page.evaluate("document.activeElement?.id") == "in-thip")
        if size != "outer":
            page.keyboard.type("8080")
            page.keyboard.type("4760")
            page.click("#enterBtn")
            page.wait_for_selector("dialog.summary[open]")
            page.screenshot(path=str(OUT / f"daily-fill-{size}.png"))
            continue

        # Typing straight away goes into the box, then on to Nig&Jop.
        page.keyboard.type("8080")
        check("Typing goes into Gaae&Thip, cursor moves on",
              page.input_value("#in-thip") == "8080"
              and page.evaluate("document.activeElement?.id") == "in-nova")
        page.keyboard.type("4760")
        page.click("#enterBtn")
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

        # Change Gaae&Thip only, then Yes: only that meter's missed days are filled.
        enter(page, thip="8081")
        page.wait_for_selector("dialog.summary[open]")
        text = page.text_content("dialog.summary")
        check("Second time asks for Gaae&Thip only", "Gaae&Thip" in text and "Nig&Jop" not in text,
              " ".join(text.split()))
        page.click("dialog.summary button[value=yes]")
        page.wait_for_selector("dialog.summary", state="detached")
        page.wait_for_timeout(300)
        recs = [record(page, d) for d in GAP]
        check("Yes: missed days filled and marked estimated",
              all(r and r["thip"] is not None and r["thip_est"] and r["nova"] is None for r in recs),
              [(r["date"], round(r["thip"], 1)) for r in recs if r])
        check("Filled values lie between the readings",
              all(28074 < r["thip"] < 28081 for r in recs))

        # A reading with no gap before it: no pop-up.
        page.fill("#date", TODAY.isoformat())
        enter(page, nova="4770")
        page.wait_for_timeout(500)
        check("No gap: no pop-up", page.locator("dialog.summary").count() == 0)

        # History: the current month starts open, older months closed.
        page.goto(page.base + "#history")
        page.wait_for_selector("table.hist tr.month")
        ym = TODAY.strftime("%Y-%m")
        open_months = page.eval_on_selector_all("tbody.open", "els => els.map(e => e.dataset.month)")
        check("History: only the current month open", open_months == [ym], open_months)
        check("No JavaScript errors", not page.errors, page.errors)

print("ALL PASS" if not failures else f"FAILED: {failures}")
sys.exit(1 if failures else 0)
