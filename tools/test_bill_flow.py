"""Browser test of the Bill screen: generate October 2026 and check the PDF tab,
Save PDF, the result summary and the missing-readings error.

    python tools/test_bill_flow.py
Screenshots and downloaded files go to data/screenshots (git-ignored).
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from browser import app_session, SCREENS, ROOT  # noqa: E402

OUT = ROOT / "data" / "screenshots"
OUT.mkdir(parents=True, exist_ok=True)
failures = []


def check(name, ok, detail=""):
    print(f"{'PASS' if ok else 'FAIL'}  {name}{'  - ' + str(detail) if detail else ''}")
    if not ok:
        failures.append(name)


with app_session(SCREENS["outer"]) as page:
    downloads = []
    page.on("download", lambda d: downloads.append(d))
    dialogs = []
    page.on("dialog", lambda d: dialogs.append(d.message))

    page.goto(page.base + "#bill")
    page.wait_for_selector("#billForm")
    check("Month defaults to previous month", page.input_value("#month") == "2026-10", page.input_value("#month"))
    check("Readings status", "137 kWh" in page.text_content("#readStatus"), page.text_content("#readStatus"))

    for key, value in [("P", "3,840.30"), ("OP", "1766.54"), ("H", "3529.1"), ("total_baht", "39,389.23")]:
        page.fill(f"#f-{key}", value)

    # Generate shows the summary and a preview of the PDF, with no tab or download.
    pages_before = len(page.context.pages)
    page.click("#billForm button[type=submit]")
    page.wait_for_selector("#billResult table")
    page.wait_for_selector("#preview canvas", timeout=15000)
    check("Generate opens no new tab", len(page.context.pages) == pages_before)
    check("Generate downloads nothing", not downloads, [d.suggested_filename for d in downloads])
    cells = page.locator("#billResult td").all_text_contents()
    check("Split A / B / Boy&Yui", ["590 Baht", "2,368 Baht", "36,431 Baht"] == [cells[5], cells[7], cells[9]], cells)
    size = page.evaluate("() => { const c = document.querySelector('#preview canvas'); return [c.width, c.height, c.clientWidth]; }")
    check("PDF preview drawn", size[0] > 500 and size[1] > size[0], size)
    page.locator("#preview").screenshot(path=str(OUT / "bill-preview-outer.png"))

    # Save PDF downloads it with the proper name.
    with page.expect_download() as dl:
        page.click("#saveBtn")
    d = dl.value
    d.save_as(str(OUT / f"dl-{d.suggested_filename}"))
    check("Save PDF filename", d.suggested_filename == "ElecBillOct2026.pdf", d.suggested_filename)

    # Share PDF: headless Edge would open an invisible dialog, so make share fail
    # and check the app explains instead of hanging.
    page.evaluate("() => { navigator.share = () => Promise.reject(new DOMException('x', 'NotAllowedError')); }")
    page.click("#shareBtn")
    page.wait_for_timeout(500)
    check("Share failure is explained", any("Save PDF" in m for m in dialogs), dialogs)
    page.screenshot(path=str(OUT / "bill-result-outer.png"), full_page=True)

    # Missing readings: November 2026 is incomplete.
    page.fill("#month", "2026-11")
    page.dispatch_event("#month", "change")
    page.wait_for_timeout(300)
    for key in ["P", "OP", "H", "total_baht"]:
        page.fill(f"#f-{key}", "100")
    pages_before = len(page.context.pages)
    page.click("#billForm button[type=submit]")
    page.wait_for_timeout(300)
    check("November refused", "18–30 Nov, 1 Dec" in page.text_content("#billMsg"), page.text_content("#billMsg"))
    check("No tab opened when refused", len(page.context.pages) == pages_before)

    # Back to October: the saved figures pre-fill.
    page.fill("#month", "2026-10")
    page.dispatch_event("#month", "change")
    page.wait_for_timeout(300)
    prefill = [page.input_value(f"#f-{k}") for k in ["P", "OP", "H", "total_baht"]]
    check("Saved figures pre-fill", prefill == ["3840.30", "1766.54", "3529.10", "39389.23"], prefill)
    check("No JavaScript errors", not page.errors, page.errors)

print("ALL PASS" if not failures else f"FAILED: {failures}")
sys.exit(1 if failures else 0)
