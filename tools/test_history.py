"""Browser test of the History screen: the current month starts open, the others
collapsed, with each month's average daily usage of measured days in its
heading; tapping a heading opens/closes it; returning from an edit keeps that
month open.

    python tools/test_history.py
"""
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from browser import app_session, SCREENS, ROOT  # noqa: E402

OUT = ROOT / "data" / "screenshots"
failures = []


def check(name, ok, detail=""):
    print(f"{'PASS' if ok else 'FAIL'}  {name}{'  - ' + str(detail) if detail else ''}")
    if not ok:
        failures.append(name)


def visible_days(page):
    return page.locator("table.hist tr[data-date]:visible").count()


for size in ("outer", "fold5", "inner"):
    with app_session(SCREENS[size]) as page:
        page.goto(page.base + "#history")
        page.wait_for_selector("table.hist tr.month")
        page.wait_for_function("document.getAnimations().length === 0")
        page.screenshot(path=str(OUT / f"history-start-{size}.png"))
        if size != "outer":
            continue

        months = page.locator("table.hist tr.month")
        # The current month (Nov 2026 in the test data: 1-17 Nov) starts open, the rest collapsed.
        cur = date.today().strftime("%Y-%m")
        open_months = page.eval_on_selector_all("tbody.open", "els => els.map(e => e.dataset.month)")
        check("All months listed, only the current one open",
              months.count() > 50 and open_months == [cur] and visible_days(page) == 17,
              f"{months.count()} months, open {open_months}, {visible_days(page)} days showing")
        page.locator(f"tbody[data-month='{cur}'] tr.month").click()  # close it
        check("Current month closes like the others", visible_days(page) == 0, visible_days(page))
        oct26 = page.locator("tbody[data-month='2026-10'] tr.month th")
        texts = [oct26.nth(i).text_content().strip() for i in range(3)]
        # October 2026: 21 measured days (10 estimated, an away period, are left out).
        check("Oct 2026 heading: name and measured averages", texts[0].endswith("Oct 2026")
              and texts[1] == "3.1" and texts[2] == "22.9", texts)

        page.locator("tbody[data-month='2026-10'] tr.month").click()
        check("Tap heading opens the month", visible_days(page) == 31, visible_days(page))
        page.wait_for_timeout(400)  # arrow finishes turning
        page.screenshot(path=str(OUT / "history-open-outer.png"))
        page.locator("tbody[data-month='2026-10'] tr.month").click()
        check("Tap again closes it", visible_days(page) == 0, visible_days(page))

        page.locator("tbody[data-month='2026-10'] tr.month").click()
        page.click("#row-2026-10-15")
        page.wait_for_selector("#backBtn")
        page.click("#backBtn")
        page.wait_for_selector("#row-2026-10-15.highlight")
        check("Back from an edit: month still open, row highlighted",
              page.locator("#row-2026-10-15").is_visible(), visible_days(page))
        check("No JavaScript errors", not page.errors, page.errors)

print("ALL PASS" if not failures else f"FAILED: {failures}")
sys.exit(1 if failures else 0)
