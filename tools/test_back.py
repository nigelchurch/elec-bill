"""Browser test of the Back button: from Bill/History/Data, Back goes to Daily;
from Daily, Back leaves the app; editing a day from History, Back returns to
History. Uses real taps and touch swipes, as on the phone.

    python tools/test_back.py [--url https://nigelchurch.github.io/elec-bill/]
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from browser import app_session, SCREENS  # noqa: E402

failures = []


def check(name, ok, detail=""):
    print(f"{'PASS' if ok else 'FAIL'}  {name}{'  - ' + str(detail) if detail else ''}")
    if not ok:
        failures.append(name)


ap = argparse.ArgumentParser()
ap.add_argument("--url")
args = ap.parse_args()

with app_session(SCREENS["outer"], url=args.url) as setup:
    # A fresh tab, so its history starts with the app (as when opening the
    # installed app). The data imported by app_session is kept.
    page = setup.context.new_page()
    page.on("pageerror", lambda e: setup.errors.append(str(e)))
    page.goto(setup.base)
    page.wait_for_selector("#dailyForm")
    cdp = page.context.new_cdp_session(page)
    w = SCREENS["outer"]["width"]

    def screen():
        return page.evaluate("location.hash.slice(1) || 'daily'")

    def back():
        page.go_back()
        page.wait_for_timeout(500)
        return page.url

    def tap(name):
        page.click(f"nav a[data-nav={name}]")
        page.wait_for_timeout(500)

    def swipe_left():
        y = 450
        cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": w * 0.8, "y": y}]})
        for i in range(1, 9):
            page.wait_for_timeout(25)
            cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": w * (0.8 - 0.075 * i), "y": y}]})
        cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
        page.wait_for_timeout(500)

    for name in ["bill", "history", "data", "bill"]:
        tap(name)
    back()
    check("Taps round the screens, then Back: Daily", screen() == "daily", screen())

    swipe_left(); swipe_left(); swipe_left()
    check("Swiped to Data", screen() == "data", screen())
    back()
    check("Swipes, then Back: Daily", screen() == "daily", screen())

    tap("history")
    page.wait_for_selector("table.hist tbody.open")      # the current month starts open
    page.locator("table.hist tr[data-date]").nth(3).click()
    page.wait_for_selector("#backBtn")
    edit = screen()
    back()
    check("Edit a day from History, then Back: History", screen() == "history", f"{edit} -> {screen()}")
    page.locator("table.hist tr[data-date]").nth(3).click()
    page.wait_for_selector("#backBtn")
    page.click("#backBtn")
    page.wait_for_timeout(500)
    check("'Back to History' button still works", screen() == "history", screen())
    back()
    check("Then Back: Daily", screen() == "daily", screen())

    tap("bill")
    page.click("a.title")
    page.wait_for_timeout(500)
    check("Title link from Bill: Daily", screen() == "daily", screen())

    url = back()
    check("Back on Daily leaves the app", "#" not in url and not url.startswith(setup.base), url)
    check("No JavaScript errors", not setup.errors, setup.errors)

print("ALL PASS" if not failures else f"FAILED: {failures}")
sys.exit(1 if failures else 0)
