"""Browser test of the Data screen: export a backup, check it against the
imported data, then restore from the exported file.

    python tools/test_data_flow.py
"""
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from browser import app_session, SCREENS, ROOT, DATA  # noqa: E402

OUT = ROOT / "data" / "screenshots"
OUT.mkdir(parents=True, exist_ok=True)
failures = []


def check(name, ok, detail=""):
    print(f"{'PASS' if ok else 'FAIL'}  {name}{'  - ' + str(detail) if detail else ''}")
    if not ok:
        failures.append(name)


def rows(text):
    return [line for line in text.splitlines() if line.strip()]


with app_session(SCREENS["outer"]) as page:
    page.goto(page.base + "#data")
    page.wait_for_selector("#exportBtn")
    cell = page.locator(".kv tr:has-text('Last backup') td").nth(1)
    check("Never backed up: shown in red", cell.text_content() == "never" and "warn-cell" in (cell.get_attribute("class") or ""))

    with page.expect_download() as dl:
        page.click("#exportBtn")
    d = dl.value
    today = date.today().isoformat()
    check("Backup filename", d.suggested_filename == f"ElecBackup-{today}.csv", d.suggested_filename)
    saved = OUT / f"dl-{d.suggested_filename}"
    d.save_as(str(saved))
    exported = saved.read_text(encoding="utf-8")
    original = DATA.read_text(encoding="utf-8")
    check("Backup identical to the imported data", rows(exported) == rows(original),
          f"{len(rows(exported))} vs {len(rows(original))} lines")

    page.wait_for_selector("#exportMsg:has-text('Saved')")
    cell = page.locator(".kv tr:has-text('Last backup') td").nth(1)
    check("Last backup now today, not red", "(today)" in cell.text_content()
          and "warn-cell" not in (cell.get_attribute("class") or ""), cell.text_content())
    page.screenshot(path=str(OUT / "data-after-export.png"), full_page=True)

    # Restore from the file just exported.
    page.set_input_files("#importFile", str(saved))
    page.wait_for_selector("#importMsg:has-text('Imported')")
    msg = page.text_content("#importMsg")
    check("Restore from the exported file", "1726 readings" in msg and "14 bills" in msg, msg)
    check("No JavaScript errors", not page.errors, page.errors)

print("ALL PASS" if not failures else f"FAILED: {failures}")
sys.exit(1 if failures else 0)
