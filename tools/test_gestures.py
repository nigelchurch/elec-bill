"""Browser test of touch gestures: swiping between screens, and no pinch-zoom.
Uses Chrome DevTools touch events, so the app sees real touches, not clicks.

    python tools/test_gestures.py [--url https://nigelchurch.github.io/elec-bill/]
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


def swipe(cdp, page, x0, y0, x1, y1, ms=200, steps=8):
    """One-finger drag from (x0, y0) to (x1, y1) over `ms` milliseconds."""
    cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x0, "y": y0}]})
    for i in range(1, steps + 1):
        page.wait_for_timeout(ms / steps)
        x = x0 + (x1 - x0) * i / steps
        y = y0 + (y1 - y0) * i / steps
        cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": x, "y": y}]})
    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
    page.wait_for_timeout(400)


def screen(page):
    return page.evaluate("location.hash.slice(1).split('?')[0] || 'daily'")


ap = argparse.ArgumentParser()
ap.add_argument("--url")
args = ap.parse_args()

with app_session(SCREENS["outer"], url=args.url) as page:
    cdp = page.context.new_cdp_session(page)
    w = SCREENS["outer"]["width"]
    mid_y = 450
    left, right = w * 0.2, w * 0.8   # away from the edges (Android's back gesture)

    seen = [screen(page)]
    for _ in range(4):               # swipe left 4 times: daily -> history -> bill -> data -> (stays)
        swipe(cdp, page, right, mid_y, left, mid_y)
        seen.append(screen(page))
    check("Swipe left walks through the screens", seen == ["daily", "history", "bill", "data", "data"], seen)

    back = []
    for _ in range(4):
        swipe(cdp, page, left, mid_y, right, mid_y)
        back.append(screen(page))
    check("Swipe right walks back", back == ["bill", "history", "daily", "daily"], back)

    # The page follows the finger while it is still down.
    cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": right, "y": mid_y}]})
    for x in (right - 20, right - 60, right - 100):
        cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": x, "y": mid_y}]})
    moved = page.evaluate("document.getElementById('app').getBoundingClientRect().x")
    check("Page follows the finger mid-drag", -110 < moved < -90, f"page x={moved}")
    page.screenshot(path=str(Path(__file__).parent.parent / "data" / "screenshots" / "mid-drag.png"))
    cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": right, "y": mid_y}]})
    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})  # let go where it started
    page.wait_for_timeout(500)
    check("Dragged back and let go: stays", screen(page) == "daily", screen(page))

    swipe(cdp, page, right, mid_y, right - w * 0.25, mid_y, ms=1200)
    back_x = page.evaluate("document.getElementById('app').getBoundingClientRect().x")
    check("Short slow drag springs back", screen(page) == "daily" and abs(back_x) < 1, f"{screen(page)} x={back_x}")

    swipe(cdp, page, w * 0.9, mid_y, w * 0.1, mid_y, ms=1200)
    check("Long slow drag changes screen", screen(page) == "history", screen(page))
    swipe(cdp, page, left, mid_y, right, mid_y)

    swipe(cdp, page, w / 2, 700, w / 2 - 40, 250)
    check("Mostly vertical drag doesn't change screen", screen(page) == "daily", screen(page))

    # A swipe on the zoomed PDF preview scrolls it instead of changing screen.
    page.goto(page.base + "#bill")
    page.wait_for_selector("#billForm")
    for k, v in [("P", "3840.30"), ("OP", "1766.54"), ("H", "3529.10"), ("total_baht", "39389.23")]:
        page.fill(f"#f-{k}", v)
    page.click("#billForm button[type=submit]")
    page.click("dialog.summary button[value=ok]")
    page.wait_for_selector("#preview canvas", timeout=20000)
    page.click("#preview")
    page.locator("#preview").scroll_into_view_if_needed()
    box = page.locator("#preview").bounding_box()
    py = box["y"] + min(box["height"] / 2, 200)
    swipe(cdp, page, right, py, left, py)
    scrolled = page.evaluate("document.getElementById('preview').scrollLeft")
    check("Swipe on zoomed preview scrolls it, stays on Bill", screen(page) == "bill" and scrolled > 0,
          f"screen={screen(page)} scrollLeft={scrolled}")

    # Pinch-zoom: the page must stay at 100%.
    page.goto(page.base + "#history")
    page.wait_for_selector("table.hist")
    cdp.send("Input.synthesizePinchGesture", {"x": w / 2, "y": 400, "scaleFactor": 2.5, "gestureSourceType": "touch"})
    page.wait_for_timeout(500)
    scale = page.evaluate("visualViewport.scale")
    check("Pinch-zoom has no effect", abs(scale - 1) < 0.01, f"scale={scale}")

    # Tapping top-bar links slides pages the right way (View Transitions).
    page.evaluate("""() => { window.vt = []; const o = document.startViewTransition.bind(document);
      document.startViewTransition = (cb) => { vt.push(document.documentElement.className); return o(cb); }; }""")
    for link in ["data", "bill", "history"]:
        page.click(f"nav a[data-nav={link}]")
        page.wait_for_timeout(500)
    vt = page.evaluate("vt")
    check("Tapping links slides pages (later = from right)", vt == ["go-next", "go-prev", "go-prev"], vt)
    # A page change that cuts short a slide still in progress must still slide
    # (not cross-fade). Redrawing the Data screen mid-slide (as Import does)
    # and then leaving reproduced this.
    page.goto(page.base + "#data")
    page.wait_for_selector(".kv")
    page.evaluate("dispatchEvent(new HashChangeEvent('hashchange'))")
    page.goto(page.base + "#daily")
    page.wait_for_selector("#dailyForm")
    names = page.evaluate("document.getAnimations().map(a => a.animationName)")
    check("Page change during a slide still slides", "page-in-left" in names, names)
    page.wait_for_timeout(600)
    check("Transition classes cleared afterwards", page.evaluate("document.documentElement.className") == "")
    check("No JavaScript errors", not page.errors, page.errors)

print("ALL PASS" if not failures else f"FAILED: {failures}")
sys.exit(1 if failures else 0)
