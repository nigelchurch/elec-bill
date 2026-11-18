"""Browser test of the Bill screen: generate October 2026 and check the
downloads, the result summary and the missing-readings error.

    python tools/test_bill_flow.py
Screenshots and downloaded files go to data/screenshots (git-ignored).
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from browser import app_session, SCREENS, ROOT  # noqa: E402

OUT = ROOT / "data" / "screenshots"
OUT.mkdir(parents=True, exist_ok=True)

with app_session(SCREENS["outer"]) as page:
    downloads = []
    page.on("download", lambda d: downloads.append(d))

    # Headless Edge would open an invisible share dialog that never closes, so
    # make share fail the way it does when the tap has expired.
    page.evaluate("() => { navigator.share = () => Promise.reject(new DOMException('no gesture', 'NotAllowedError')); }")
    page.goto(page.base + "#bill")
    page.wait_for_selector("#billForm")
    print("month default:", page.input_value("#month"))
    print("status:", page.text_content("#readStatus"))
    page.screenshot(path=str(OUT / "bill-empty-outer.png"), full_page=True)

    for key, value in [("P", "3,840.30"), ("OP", "1766.54"), ("H", "3529.1"), ("total_baht", "39,389.23")]:
        page.fill(f"#f-{key}", value)
    page.click("#billForm button[type=submit]")
    page.wait_for_selector("#billResult table")
    page.wait_for_selector("#shareBtn:not([hidden])")
    page.wait_for_timeout(1500)
    print("result:", " | ".join(page.locator("#billResult td").all_text_contents()))
    print("note:", page.text_content("#billResult .hint"))
    for d in downloads:
        target = OUT / f"dl-{d.suggested_filename}"
        d.save_as(str(target))
        print("downloaded:", d.suggested_filename, target.stat().st_size, "bytes")
    page.screenshot(path=str(OUT / "bill-result-outer.png"), full_page=True)

    # Missing readings: November 2026 is incomplete.
    page.fill("#month", "2026-11")
    page.dispatch_event("#month", "change")
    page.wait_for_timeout(300)
    print("Nov status:", page.text_content("#readStatus"))
    for key in ["P", "OP", "H", "total_baht"]:
        page.fill(f"#f-{key}", "100")
    page.click("#billForm button[type=submit]")
    print("Nov error:", page.text_content("#billMsg"))

    # Back to October: the saved figures should pre-fill.
    page.fill("#month", "2026-10")
    page.dispatch_event("#month", "change")
    page.wait_for_timeout(300)
    print("Oct prefill:", [page.input_value(f"#f-{k}") for k in ["P", "OP", "H", "total_baht"]])
    page.screenshot(path=str(OUT / "bill-list-outer.png"), full_page=True)
    print("JS errors:", page.errors or "none")
