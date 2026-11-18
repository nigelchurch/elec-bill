"""Browser test of app updates, the way GitHub Pages serves them: every file
is sent with "Cache-Control: max-age=600" (browsers may reuse it for 10
minutes without asking). Opens the app, then publishes a change (new
history.js + new CACHE_VERSION) in a copy of the app, lets the service worker
update, and checks the new cache holds the NEW history.js, not the browser's
10-minute-old copy.

    python tools/test_update.py
"""
import functools
import http.server
import re
import shutil
import socketserver
import sys
import tempfile
import threading
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from browser import ROOT, SCREENS  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

failures = []


def check(name, ok, detail=""):
    print(f"{'PASS' if ok else 'FAIL'}  {name}{'  - ' + str(detail) if detail else ''}")
    if not ok:
        failures.append(name)


class PagesLikeHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "max-age=600")  # as GitHub Pages does
        super().end_headers()

    def log_message(self, *args):
        pass


class Server(socketserver.ThreadingTCPServer):
    daemon_threads = True


with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
    site = Path(tmp) / "site"
    shutil.copytree(ROOT, site, ignore=shutil.ignore_patterns(".git", "data", "tools", "tests", "*.xlsx", "*.pdf", "*.csv"))
    handler = functools.partial(PagesLikeHandler, directory=str(site))
    with Server(("127.0.0.1", 0), handler) as httpd, sync_playwright() as p:
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        base = f"http://127.0.0.1:{httpd.server_address[1]}/"
        context = p.chromium.launch_persistent_context(
            str(Path(tmp) / "profile"), channel="msedge", headless=True,
            viewport=SCREENS["outer"], is_mobile=True, has_touch=True)
        page = context.pages[0]
        page.goto(base)
        page.wait_for_selector("#dailyForm")
        page.evaluate("navigator.serviceWorker.ready")
        page.goto(base + "#history")   # the browser now holds history.js for 10 minutes
        page.wait_for_timeout(500)

        # Publish an update: change history.js and bump the cache version.
        marker = "// update-test-marker"
        (site / "js" / "history.js").write_text((site / "js" / "history.js").read_text(encoding="utf-8") + "\n" + marker + "\n", encoding="utf-8")
        sw = site / "sw.js"
        old = re.search(r"CACHE_VERSION = '([^']+)'", sw.read_text(encoding="utf-8")).group(1)
        sw.write_text(sw.read_text(encoding="utf-8").replace(f"CACHE_VERSION = '{old}'", "CACHE_VERSION = 'update-test'"), encoding="utf-8")

        page.evaluate("navigator.serviceWorker.getRegistration().then(r => r.update())")
        # Wait until the new version is active (it deletes the old cache when it takes over).
        state = None
        for _ in range(100):
            state = page.evaluate("""async () => {
                const keys = await caches.keys();
                const c = keys.includes('elecbill-update-test') ? await caches.open('elecbill-update-test') : null;
                return { keys, files: c ? (await c.keys()).length : 0 };
            }""")
            if state["keys"] == ["elecbill-update-test"] and state["files"] > 15:
                break
            page.wait_for_timeout(200)
        print("     cache state:", state)
        cached = page.evaluate("""async () => {
            const c = await caches.open('elecbill-update-test');
            const r = await c.match('js/history.js');
            return r ? r.text() : null;
        }""")
        keys = page.evaluate("caches.open('elecbill-update-test').then(c => c.keys()).then(k => k.map(r => r.url))")
        check("New version installed", cached is not None, f"{len(keys)} files cached")
        check("Cached history.js is the NEW file, not the browser's old copy", cached is not None and marker in cached)
        page.reload()
        page.wait_for_selector("#app")
        served = page.evaluate("fetch('js/history.js').then(r => r.text())")
        check("App now gets the new file", marker in served)
        context.close()
        httpd.shutdown()

print("ALL PASS" if not failures else f"FAILED: {failures}")
sys.exit(1 if failures else 0)
