"""
RepairOS — End-to-End Test Suite

Tests every module: Login, Dashboard, CRM, Repairs, POS,
Inventory, Procurement, Billing, HR, Commissions, Finance, AMC, Reports, Logout

Prerequisites
-------------
1. Backend running with E2E settings:
       cd backend
       DJANGO_SETTINGS_MODULE=config.settings.e2e python manage.py runserver 8000

2. Frontend standalone build served:
       cd frontend
       NEXT_PUBLIC_API_URL=http://localhost:8000 npm run build
       cp -r .next/static .next/standalone/.next/static
       cp -r public    .next/standalone/public
       cd .next/standalone
       HOSTNAME=0.0.0.0 PORT=3000 node server.js

3. Python deps:  pip install playwright requests
                 playwright install chromium

Usage
-----
    python e2e/test_all_modules.py

Or via the launcher (starts servers automatically):
    bash e2e/run_e2e.sh
"""

import sys
import time
import requests
from pathlib import Path
from playwright.sync_api import sync_playwright, Page

# ── Config ────────────────────────────────────────────────────────────────────

BACKEND  = "http://localhost:8000/api/v1"
FRONTEND = "http://localhost:3000"
PHONE    = "+919876543210"
TENANT   = "demo"

SCREENSHOTS = Path(__file__).parent / "screenshots"
SCREENSHOTS.mkdir(exist_ok=True)

# ── Server warmup ─────────────────────────────────────────────────────────────

def _wait_for_server(url: str, max_wait: int = 60, req_timeout: int = 15) -> None:
    """Poll url until it returns a non-5xx status or max_wait seconds elapse."""
    print(f"   waiting for {url} …", flush=True)
    deadline = time.time() + max_wait
    while time.time() < deadline:
        try:
            r = requests.get(url, timeout=req_timeout)
            if r.status_code < 500:
                print(f"   ready ({r.status_code}) ✓")
                return
        except requests.exceptions.Timeout:
            pass
        except Exception:
            pass
        time.sleep(1)
    raise RuntimeError(f"Server at {url} not ready after {max_wait}s")


def wait_for_servers() -> None:
    print("Checking servers …")
    _wait_for_server(f"{BACKEND}/auth/login/")
    _wait_for_server(FRONTEND)

# ── Helpers ───────────────────────────────────────────────────────────────────

def get_otp() -> str:
    """Fetch the most-recent cached OTP from the dev-only endpoint."""
    resp = requests.get(
        f"{BACKEND}/auth/dev/otp/",
        params={"phone": PHONE},
        headers={"X-Tenant-Slug": TENANT},
        timeout=10,
    )
    assert resp.status_code == 200, f"dev/otp failed: {resp.text}"
    return resp.json()["data"]["otp"]


def login(page: Page) -> None:
    """Complete OTP login via the frontend UI."""
    page.goto(f"{FRONTEND}/login", timeout=60_000)
    page.wait_for_selector('input[placeholder="your-shop"]', timeout=15_000)

    slug  = page.locator('input[placeholder="your-shop"]')
    phone = page.locator('input[placeholder="+91XXXXXXXXXX"]')
    slug.click();  slug.fill(TENANT)
    phone.click(); phone.fill(PHONE)

    page.get_by_role("button", name="Send OTP").click()
    page.wait_for_selector('input[placeholder="000000"]', timeout=10_000)

    page.locator('input[placeholder="000000"]').fill(get_otp())
    page.get_by_role("button", name="Verify").click()
    page.wait_for_url("**/dashboard", timeout=10_000)


def shot(page: Page, name: str) -> None:
    path = SCREENSHOTS / f"{name}.png"
    try:
        page.screenshot(path=str(path), full_page=True, animations="disabled", timeout=15_000)
        print(f"   📸 {path.name}")
    except Exception as exc:
        print(f"   📸 screenshot skipped: {exc}")

# ── Tests ─────────────────────────────────────────────────────────────────────

def run_all_tests() -> dict[str, str]:
    results: dict[str, str] = {}

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page    = browser.new_context(viewport={"width": 390, "height": 844}).new_page()

        # ── 1. Login ──────────────────────────────────────────────────────────
        try:
            login(page)
            shot(page, "01_login")
            results["Login"] = "✅ PASS"
            print("✅  Login")
        except Exception as exc:
            shot(page, "01_login_fail")
            results["Login"] = f"❌ FAIL: {exc}"
            print(f"❌  Login: {exc}")
            browser.close()
            return results   # can't continue without a session

        # ── 2. Dashboard ──────────────────────────────────────────────────────
        try:
            page.wait_for_selector("h1:has-text('Dashboard')", timeout=10_000)
            shot(page, "02_dashboard")
            results["Dashboard"] = "✅ PASS"
            print("✅  Dashboard")
        except Exception as exc:
            shot(page, "02_dashboard_fail")
            results["Dashboard"] = f"❌ FAIL: {exc}"
            print(f"❌  Dashboard: {exc}")

        # ── 3. CRM — Customers ────────────────────────────────────────────────
        try:
            page.goto(f"{FRONTEND}/customers")
            page.wait_for_load_state("networkidle")
            page.wait_for_selector("text=Customers", timeout=5_000)
            page.get_by_text("Add Customer").click()
            page.wait_for_url("**/customers/new")
            page.locator('input[placeholder="Customer name"]').fill("E2E Test Customer")
            page.locator('input[placeholder="+919876543210"]').fill("+919111222333")
            page.get_by_text("Save Customer").click()
            page.wait_for_url("**/customers/*", timeout=8_000)
            shot(page, "03_crm_customer")
            results["CRM — Customers"] = "✅ PASS"
            print("✅  CRM — created customer")
        except Exception as exc:
            shot(page, "03_crm_fail")
            results["CRM — Customers"] = f"❌ FAIL: {exc}"
            print(f"❌  CRM: {exc}")

        # ── 4. Repairs ────────────────────────────────────────────────────────
        try:
            page.goto(f"{FRONTEND}/repairs")
            page.wait_for_selector("h1:has-text('Repairs')", timeout=10_000)
            shot(page, "04_repairs")
            results["Repairs"] = "✅ PASS"
            print("✅  Repairs")
        except Exception as exc:
            shot(page, "04_repairs_fail")
            results["Repairs"] = f"❌ FAIL: {exc}"
            print(f"❌  Repairs: {exc}")

        # ── 5. POS ────────────────────────────────────────────────────────────
        try:
            page.goto(f"{FRONTEND}/pos")
            page.wait_for_load_state("networkidle")
            page.wait_for_selector("text=POS Sale", timeout=5_000)
            page.wait_for_selector("text=Cart is empty", timeout=3_000)
            shot(page, "05_pos")
            results["POS"] = "✅ PASS"
            print("✅  POS")
        except Exception as exc:
            shot(page, "05_pos_fail")
            results["POS"] = f"❌ FAIL: {exc}"
            print(f"❌  POS: {exc}")

        # ── 6. Inventory ──────────────────────────────────────────────────────
        try:
            page.goto(f"{FRONTEND}/inventory")
            page.wait_for_selector("h1:has-text('Inventory')", timeout=10_000)
            shot(page, "06_inventory")
            results["Inventory"] = "✅ PASS"
            print("✅  Inventory")
        except Exception as exc:
            shot(page, "06_inventory_fail")
            results["Inventory"] = f"❌ FAIL: {exc}"
            print(f"❌  Inventory: {exc}")

        # ── 7. Procurement ────────────────────────────────────────────────────
        try:
            page.goto(f"{FRONTEND}/procurement")
            page.wait_for_selector("h1:has-text('Procurement')", timeout=10_000)
            shot(page, "07_procurement")
            results["Procurement"] = "✅ PASS"
            print("✅  Procurement")
        except Exception as exc:
            shot(page, "07_procurement_fail")
            results["Procurement"] = f"❌ FAIL: {exc}"
            print(f"❌  Procurement: {exc}")

        # ── 8. Billing ────────────────────────────────────────────────────────
        try:
            page.goto(f"{FRONTEND}/billing")
            page.wait_for_load_state("networkidle")
            page.wait_for_selector("text=Billing", timeout=5_000)
            page.wait_for_selector("text=Repair Invoices", timeout=3_000)
            page.wait_for_selector("text=POS Sales", timeout=3_000)
            shot(page, "08_billing")
            results["Billing"] = "✅ PASS"
            print("✅  Billing")
        except Exception as exc:
            shot(page, "08_billing_fail")
            results["Billing"] = f"❌ FAIL: {exc}"
            print(f"❌  Billing: {exc}")

        # ── 9. HR & Payroll ───────────────────────────────────────────────────
        try:
            page.goto(f"{FRONTEND}/hr")
            page.wait_for_load_state("networkidle")
            page.wait_for_selector("text=HR & Payroll", timeout=5_000)
            for tab in ["Employees", "Attendance", "Leaves", "Payroll"]:
                assert page.locator(f"text={tab}").count() > 0, f"tab '{tab}' missing"
            shot(page, "09_hr")
            results["HR & Payroll"] = "✅ PASS"
            print("✅  HR & Payroll (4 tabs)")
        except Exception as exc:
            shot(page, "09_hr_fail")
            results["HR & Payroll"] = f"❌ FAIL: {exc}"
            print(f"❌  HR: {exc}")

        # ── 10. Commissions ───────────────────────────────────────────────────
        try:
            page.goto(f"{FRONTEND}/commissions")
            page.wait_for_load_state("networkidle")
            page.wait_for_selector("text=Commissions", timeout=5_000)
            for tab in ["Rules", "Technician Ledger", "Payouts"]:
                assert page.locator(f"text={tab}").count() > 0, f"tab '{tab}' missing"
            shot(page, "10_commissions")
            results["Commissions"] = "✅ PASS"
            print("✅  Commissions (3 tabs)")
        except Exception as exc:
            shot(page, "10_commissions_fail")
            results["Commissions"] = f"❌ FAIL: {exc}"
            print(f"❌  Commissions: {exc}")

        # ── 11. Finance ───────────────────────────────────────────────────────
        try:
            page.goto(f"{FRONTEND}/finance")
            page.wait_for_load_state("networkidle")
            page.wait_for_selector("text=Finance", timeout=5_000)
            for tab in ["Petty Cash", "Expenses", "Budget", "Assets"]:
                assert page.locator(f"text={tab}").count() > 0, f"tab '{tab}' missing"
            shot(page, "11_finance")
            results["Finance"] = "✅ PASS"
            print("✅  Finance (4 tabs)")
        except Exception as exc:
            shot(page, "11_finance_fail")
            results["Finance"] = f"❌ FAIL: {exc}"
            print(f"❌  Finance: {exc}")

        # ── 12. AMC ───────────────────────────────────────────────────────────
        try:
            page.goto(f"{FRONTEND}/amc")
            page.wait_for_load_state("networkidle")
            page.wait_for_selector("text=AMC", timeout=5_000)
            assert page.locator("text=New Contract").count() > 0
            shot(page, "12_amc")
            results["AMC"] = "✅ PASS"
            print("✅  AMC")
        except Exception as exc:
            shot(page, "12_amc_fail")
            results["AMC"] = f"❌ FAIL: {exc}"
            print(f"❌  AMC: {exc}")

        # ── 13. Reports ───────────────────────────────────────────────────────
        try:
            page.goto(f"{FRONTEND}/reports")
            page.wait_for_load_state("networkidle")
            page.wait_for_selector("text=Reports", timeout=5_000)
            page.wait_for_selector("text=Revenue Summary", timeout=5_000)
            page.wait_for_selector("text=Revenue Today",   timeout=5_000)
            shot(page, "13_reports")
            results["Reports"] = "✅ PASS"
            print("✅  Reports")
        except Exception as exc:
            shot(page, "13_reports_fail")
            results["Reports"] = f"❌ FAIL: {exc}"
            print(f"❌  Reports: {exc}")

        # ── 14. Logout ────────────────────────────────────────────────────────
        try:
            page.goto(f"{FRONTEND}/dashboard")
            page.wait_for_selector("h1:has-text('Dashboard')", timeout=10_000)
            page.get_by_text("Sign out").first.dispatch_event("click")
            page.wait_for_url("**/login", timeout=8_000)
            shot(page, "14_logout")
            results["Logout"] = "✅ PASS"
            print("✅  Logout → /login")
        except Exception as exc:
            shot(page, "14_logout_fail")
            results["Logout"] = f"❌ FAIL: {exc}"
            print(f"❌  Logout: {exc}")

        browser.close()

    return results

# ── Entry point ───────────────────────────────────────────────────────────────

def main() -> int:
    print("\n" + "=" * 60)
    print("  RepairOS — End-to-End Test Suite")
    print(f"  Backend:  {BACKEND}")
    print(f"  Frontend: {FRONTEND}")
    print("=" * 60 + "\n")

    wait_for_servers()

    results = run_all_tests()

    passed = sum(1 for v in results.values() if "PASS" in v)
    failed = len(results) - passed

    print("\n" + "=" * 60)
    print("  RESULTS")
    print("=" * 60)
    for module, result in results.items():
        print(f"  {result}  {module}")
    print("-" * 60)
    print(f"  {passed} passed, {failed} failed out of {len(results)} tests")
    print("=" * 60 + "\n")

    if failed:
        print(f"Screenshots saved to: {SCREENSHOTS}/")

    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
