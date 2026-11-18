"""Drive the app in a real (Edge) browser for testing and screenshots.

Needs Playwright:  python -m pip install playwright
It uses the Edge already installed on this PC (no extra browser download), in a
fresh temporary profile each run, so it never touches your own Edge data.
It also starts its own small web server, so Live Server isn't needed.

Quick use, from the project folder:
    python tools/browser.py                  # screenshots of the main screens
    python tools/browser.py --out shots      # choose the output folder
    python tools/browser.py --check          # PWA checks: service worker, cache, DB, installable, offline

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
import tempfile
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
    # A temporary real profile (deleted afterwards). Playwright's default throwaway
    # context counts as private browsing, where Edge refuses to install apps.
    with static_server() as base, sync_playwright() as p, tempfile.TemporaryDirectory() as profile:
        context = p.chromium.launch_persistent_context(
            profile, channel="msedge", headless=headless,
            viewport=viewport, device_scale_factor=2, is_mobile=True, has_touch=True)
        browser = context  # closing the context closes the browser
        page = context.pages[0] if context.pages else context.new_page()
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


def pwa_checks():
    """The step-1 DevTools checks, automated. Prints PASS/FAIL for each; returns True if all pass."""
    results = []

    def check(name, ok, detail=""):
        results.append(ok)
        print(f"{'PASS' if ok else 'FAIL'}  {name}{'  - ' + str(detail) if detail else ''}")

    with app_session(import_data=False) as page:
        # Service worker: the page is controlled by it once it has activated.
        page.wait_for_function("navigator.serviceWorker.controller !== null || navigator.serviceWorker.ready", timeout=10000)
        state = page.evaluate("navigator.serviceWorker.ready.then(r => r.active && r.active.state)")
        check("Service worker active", state == "activated", state)

        # Cache storage: the current cache lists every app file.
        sw_src = (ROOT / "sw.js").read_text(encoding="utf-8")
        cache = page.evaluate("""async () => {
            const keys = await caches.keys();
            const name = keys.find(k => k.startsWith('elecbill-'));
            if (!name) return { keys };
            const reqs = await (await caches.open(name)).keys();
            return { keys, name, files: reqs.map(r => new URL(r.url).pathname) };
        }""")
        check("One app cache", len(cache["keys"]) == 1, cache["keys"])
        listed = [line.strip().strip("',") for line in sw_src.split("APP_FILES = [")[1].split("]")[0].splitlines()
                  if line.strip().startswith("'")]
        missing = [f for f in listed if f != "./" and "/" + f not in cache.get("files", [])]
        check("All APP_FILES cached", not missing, missing or f"{len(listed)} files in {cache.get('name')}")
        js_files = sorted(p.relative_to(ROOT).as_posix() for p in (ROOT / "js").glob("*.js"))
        unlisted = [f for f in js_files if f not in listed]
        check("Every js/*.js is in APP_FILES", not unlisted, unlisted)

        # IndexedDB: database and its three stores exist.
        stores = page.evaluate("""() => new Promise(res => {
            const r = indexedDB.open('elecbill');
            r.onsuccess = () => res([...r.result.objectStoreNames]);
        })""")
        check("IndexedDB stores", sorted(stores) == ["bills", "meta", "readings"], stores)

        # Manifest / installability, as Edge itself judges it.
        cdp = page.context.new_cdp_session(page)
        errs = cdp.send("Page.getInstallabilityErrors")["installabilityErrors"]
        check("Installable (no manifest/installability errors)", not errs, [e["errorId"] for e in errs])

        # Offline: cut the network and reload; the app must still appear.
        page.context.set_offline(True)
        page.reload()
        page.wait_for_selector("#dailyForm", timeout=10000)
        check("Works offline", True)
        page.context.set_offline(False)

        check("No JavaScript errors", not page.errors, page.errors)
    return all(results)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default=str(ROOT / "data" / "screenshots"),
                    help="output folder (default data/screenshots, which git ignores)")
    ap.add_argument("--check", action="store_true", help="run the PWA checks instead of screenshots")
    args = ap.parse_args()
    if args.check:
        raise SystemExit(0 if pwa_checks() else 1)
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
