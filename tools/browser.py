"""Drive the app in a real (Edge) browser for testing and screenshots.

Needs Playwright:  python -m pip install playwright
It uses the Edge already installed on this PC (no extra browser download), in a
fresh temporary profile each run, so it never touches your own Edge data.
It also starts its own small web server, so Live Server isn't needed.

Quick use, from the project folder:
    python tools/browser.py                  # screenshots of the main screens
    python tools/browser.py --out shots      # choose the output folder

From another script:
    from browser import app_session, SCREENS
    with app_session(SCREENS["outer"]) as page:
        page.goto(page.base + "#history")
        page.screenshot(path="history.png")
"""

import argparse
import functools
import http.server
import socketserver
import threading
from contextlib import contextmanager
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data" / "initial-import.csv"

# Approximate CSS-pixel sizes of the Galaxy Z Fold screens (whole screen; the
# visible area in Chrome is a little shorter).
SCREENS = {
    "outer": {"width": 411, "height": 960},   # Fold7 narrow cover screen
    "inner": {"width": 750, "height": 832},   # Fold7 unfolded main screen
    "fold5": {"width": 344, "height": 882},   # Fold5 cover screen: narrowest case
}


@contextmanager
def static_server():
    """Serve the project folder on a free localhost port (a secure origin, so the
    service worker and IndexedDB work as on the phone)."""
    class QuietHandler(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *args):  # keep the console quiet
            pass

    handler = functools.partial(QuietHandler, directory=str(ROOT))
    with socketserver.TCPServer(("127.0.0.1", 0), handler) as httpd:
        thread = threading.Thread(target=httpd.serve_forever, daemon=True)
        thread.start()
        try:
            yield f"http://127.0.0.1:{httpd.server_address[1]}/"
        finally:
            httpd.shutdown()


@contextmanager
def app_session(viewport=SCREENS["outer"], import_data=True, headless=True):
    """Open the app in a fresh Edge profile. Yields a Playwright page with
    page.base (the app URL) and page.errors (JavaScript errors seen so far).
    With import_data, data/initial-import.csv is imported via the Data screen."""
    with static_server() as base, sync_playwright() as p:
        browser = p.chromium.launch(channel="msedge", headless=headless)
        context = browser.new_context(viewport=viewport, device_scale_factor=2, is_mobile=True, has_touch=True)
        page = context.new_page()
        page.base = base
        page.errors = []
        page.on("pageerror", lambda e: page.errors.append(str(e)))
        page.on("console", lambda m: m.type == "error" and page.errors.append(m.text))
        page.on("dialog", lambda d: d.accept())  # say OK to confirm() pop-ups
        page.goto(base)
        page.wait_for_selector("#dailyForm")
        if import_data:
            if not DATA.exists():
                raise SystemExit(f"Missing {DATA}; run tools/convert_budget.py first")
            page.goto(base + "#data")
            page.set_input_files("#importFile", str(DATA))
            page.wait_for_selector("#importMsg:has-text('Imported')")
            page.goto(base + "#daily")
            page.wait_for_selector("#dailyForm")
        try:
            yield page
        finally:
            browser.close()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default=str(ROOT / "data" / "screenshots"),
                    help="output folder (default data/screenshots, which git ignores)")
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    for name, viewport in SCREENS.items():
        with app_session(viewport) as page:
            for screen, wait in [("daily", "#dailyForm"), ("history", "table.hist"), ("data", ".kv")]:
                page.goto(page.base + "#" + screen)
                page.wait_for_selector(wait)
                path = out / f"{screen}-{name}.png"
                page.screenshot(path=str(path))
                print("saved", path)
            if page.errors:
                print("JavaScript errors:", *page.errors, sep="\n  ")


if __name__ == "__main__":
    main()
