"""Demo seed: petty cash, budgets (one over budget), expenses, shop assets."""
import random
from datetime import date, timedelta
from decimal import Decimal

from core.seeding import SeedContext, Seeder, register


class FinanceDemoSeeder(Seeder):
    name = "finance.demo"
    scope = "demo"
    depends_on = ("authentication.demo_users",)

    def run(self, ctx: SeedContext) -> None:
        shop_del, shop_mum, users = ctx["shop_del"], ctx["shop_mum"], ctx["users"]
        from finance.models import PettyCashAccount, BudgetHead, BudgetAllocation, ShopAsset
        from finance import services as fin_svc

        admin = users["admin"]
        today = date.today()
        month, year = today.month, today.year

        # ── Petty cash accounts ────────────────────────────────────────────
        pc_del, _ = PettyCashAccount.objects.get_or_create(
            shop=shop_del,
            defaults={"name": "Delhi Petty Cash", "current_balance": Decimal("0"), "low_balance_threshold": Decimal("500")},
        )
        pc_mum, _ = PettyCashAccount.objects.get_or_create(
            shop=shop_mum,
            defaults={"name": "Mumbai Petty Cash", "current_balance": Decimal("0"), "low_balance_threshold": Decimal("500")},
        )

        # Opening credit
        from finance.models import PettyCashTransaction
        if not PettyCashTransaction.objects.filter(account=pc_del).exists():
            fin_svc.record_petty_cash_txn(pc_del, {"txn_type": "credit", "amount": "5000", "category": "Opening", "description": "Opening balance", "date": today - timedelta(days=30)}, admin)
            txns = [
                ("debit", "350",  "Chai & Refreshments",    "Monthly chai expense for staff"),
                ("debit", "820",  "Stationery",             "A4 paper, pens, stapler refill"),
                ("debit", "450",  "Courier",                "Parts courier from supplier"),
                ("debit", "200",  "Cleaning",               "Weekly cleaning supplies"),
                ("credit","3000", "Replenishment",          "Cash replenishment from accounts"),
            ]
            for txn_type, amount, category, desc in txns:
                fin_svc.record_petty_cash_txn(pc_del, {
                    "txn_type": txn_type, "amount": amount,
                    "category": category, "description": desc,
                    "date": today - timedelta(days=random.randint(1, 25)),
                }, admin)

        if not PettyCashTransaction.objects.filter(account=pc_mum).exists():
            fin_svc.record_petty_cash_txn(pc_mum, {"txn_type": "credit", "amount": "3000", "category": "Opening", "description": "Opening balance", "date": today - timedelta(days=30)}, admin)

        # ── Budget heads + allocations ─────────────────────────────────────
        bh_rm, _ = BudgetHead.objects.get_or_create(shop=shop_del, name="Repairs & Maintenance", defaults={"category": "operational"})
        bh_mkt, _ = BudgetHead.objects.get_or_create(shop=shop_del, name="Marketing",             defaults={"category": "marketing"})
        bh_off, _ = BudgetHead.objects.get_or_create(shop=shop_del, name="Office Supplies",       defaults={"category": "operational"})

        # Set budgeted amounts
        for bh, budgeted in [(bh_rm, Decimal("10000")), (bh_mkt, Decimal("8000")), (bh_off, Decimal("3000"))]:
            BudgetAllocation.objects.update_or_create(
                head=bh, month=month, year=year,
                defaults={"budgeted_amount": budgeted},
            )

        # ── Expenses ───────────────────────────────────────────────────────
        from finance.models import Expense
        if not Expense.objects.filter(shop=shop_del).exists():
            expenses = [
                (bh_rm,  "6500",  "Electrical repairs",  "Rewiring for new workstation"),
                (bh_mkt, "12000", "Social media ads",    "Instagram/Facebook campaign for June — OVER BUDGET"),  # ₹12k vs ₹8k budget
                (bh_off, "1200",  "Stationery & print",  "Invoice booklets, pens, register"),
            ]
            for bh, amount, category, desc in expenses:
                fin_svc.create_expense(shop_del, {
                    "budget_head_id": str(bh.id),
                    "amount": amount,
                    "category": category,
                    "description": desc,
                    "date": today - timedelta(days=random.randint(1, 15)),
                }, admin)

        # ── Extra budget heads ─────────────────────────────────────────────
        bh_util,  _ = BudgetHead.objects.get_or_create(shop=shop_del, name="Utilities",          defaults={"category": "operational"})
        bh_rent,  _ = BudgetHead.objects.get_or_create(shop=shop_del, name="Rent & Premises",    defaults={"category": "operational"})
        bh_train, _ = BudgetHead.objects.get_or_create(shop=shop_del, name="Staff Training",     defaults={"category": "operational"})
        bh_equip, _ = BudgetHead.objects.get_or_create(shop=shop_del, name="Equipment & Tools",  defaults={"category": "capex"})
        bh_it,    _ = BudgetHead.objects.get_or_create(shop=shop_del, name="IT & Software",      defaults={"category": "operational"})

        for bh, budgeted in [
            (bh_util,  Decimal("5000")), (bh_rent, Decimal("30000")),
            (bh_train, Decimal("4000")), (bh_equip, Decimal("15000")),
            (bh_it,    Decimal("3000")),
        ]:
            BudgetAllocation.objects.update_or_create(
                head=bh, month=month, year=year,
                defaults={"budgeted_amount": budgeted},
            )

        # ── Extra expenses ─────────────────────────────────────────────────
        from finance.models import Expense
        if Expense.objects.filter(shop=shop_del).count() < 15:
            extra_expenses = [
                (bh_util,  "4200",  "Electricity bill",      "June electricity bill for SDEL showroom",          today - timedelta(days=2)),
                (bh_rent,  "25000", "Shop rent",             "Monthly rent payment — Delhi showroom",             today - timedelta(days=5)),
                (bh_rm,    "3200",  "Generator service",     "Annual AMC for backup generator",                   today - timedelta(days=8)),
                (bh_mkt,   "5500",  "Flex banners",          "New service offering banners installed",            today - timedelta(days=12)),
                (bh_off,   "800",   "Printer cartridge",     "Canon ink cartridge for invoice printer",           today - timedelta(days=14)),
                (bh_equip, "12000", "Soldering station",     "Hakko FX-888D for micro-soldering repairs",         today - timedelta(days=18)),
                (bh_it,    "2400",  "Domain & hosting",      "Annual domain renewal and hosting plan",            today - timedelta(days=20)),
                (bh_util,  "1200",  "Water & housekeeping",  "Water bill + monthly cleaning contract",            today - timedelta(days=22)),
                (bh_train, "3500",  "Training workshop",     "Staff mobile repair diagnosis training",            today - timedelta(days=25)),
                (bh_mkt,   "2000",  "Print collateral",      "Visiting cards + promotional leaflets",             today - timedelta(days=28)),
                (bh_rm,    "1500",  "AC gas refill",         "Refrigerant refill for waiting area AC unit",       today - timedelta(days=30)),
                (bh_off,   "600",   "Office consumables",    "Stapler pins, rubber bands, folders",               today - timedelta(days=35)),
                (bh_equip, "2500",  "Oscilloscope probe",    "Replacement probe for test bench equipment",        today - timedelta(days=40)),
                (bh_it,    "599",   "Software subscription", "Monthly antivirus + remote monitoring subscription",today - timedelta(days=45)),
                (bh_mkt,   "1800",  "Google Ads",            "Search ads for mobile repair — Delhi targeting",    today - timedelta(days=48)),
            ]
            for bh, amount, category, desc, exp_date in extra_expenses:
                try:
                    fin_svc.create_expense(shop_del, {
                        "budget_head_id": str(bh.id),
                        "amount": amount,
                        "category": category,
                        "description": desc,
                        "date": exp_date,
                    }, admin)
                except Exception:
                    pass

        # ── Extra petty cash transactions ──────────────────────────────────
        from finance.models import PettyCashTransaction
        if PettyCashTransaction.objects.filter(account=pc_del).count() < 12:
            extra_pc = [
                ("debit",  "180",  "Food & Beverages",    "Lunch for technicians during overtime"),
                ("debit",  "420",  "Courier",             "Express courier — spare parts from supplier"),
                ("debit",  "250",  "Cleaning",            "Cleaning supplies — mop, phenyl, duster"),
                ("credit", "2000", "Replenishment",       "Cash replenishment from accounts"),
                ("debit",  "150",  "Printing",            "Customer receipt roll paper"),
                ("debit",  "320",  "Stationery",          "Register notebook and pens"),
                ("debit",  "500",  "Repairs & Maintenance","Workbench screw kit and cable ties"),
                ("debit",  "380",  "Courier",             "Return courier for rejected batteries"),
                ("credit", "1500", "Replenishment",       "Additional petty cash from accounts"),
                ("debit",  "200",  "Food & Beverages",    "Staff chai and snacks"),
            ]
            for txn_type, amount, category, desc in extra_pc:
                try:
                    fin_svc.record_petty_cash_txn(pc_del, {
                        "txn_type": txn_type, "amount": amount,
                        "category": category, "description": desc,
                        "date": today - timedelta(days=random.randint(1, 50)),
                    }, admin)
                except Exception:
                    pass

        # ── Assets ────────────────────────────────────────────────────────
        asset_specs = [
            ("Dell Inspiron Laptop (Service Desk)", "IT Equipment",       "SDEL-IT-001",
             date(2025, 3, 15), Decimal("55000"), None,              "good", "Front desk — service management PC"),
            ("Daikin 1.5T Split AC",                "Electrical Equipment","SDEL-EL-001",
             date(2024, 5, 10), Decimal("38000"), date(2029, 5, 10), "good", "Customer waiting area"),
            ("Hakko FX-888D Soldering Station",      "Workshop Tools",     "SDEL-WS-001",
             date(2026, 6, 1),  Decimal("12000"), None,              "good", "Service workbench — soldering & micro-repairs"),
            ("Canon PIXMA G3010 Printer",            "IT Equipment",       "SDEL-IT-002",
             date(2025, 8, 20), Decimal("8500"),  date(2028, 8, 20), "good", "Invoice and document printer"),
            ("Accessory Display Shelving Unit",      "Fixtures",           "SDEL-FX-001",
             date(2024, 11, 1), Decimal("15000"), None,              "good", "Front counter accessory display stand"),
            ("Security Camera System (4-cam)",       "Security",           "SDEL-SC-001",
             date(2025, 1, 15), Decimal("22000"), None,              "good", "CCTV covering shop front, counter, workshop"),
        ]
        for name, cat, code, pdate, cost, warranty, condition, loc in asset_specs:
            if not ShopAsset.objects.filter(asset_code=code).exists():
                ShopAsset.objects.create(
                    shop=shop_del, name=name, category=cat, asset_code=code,
                    purchase_date=pdate, purchase_cost=cost,
                    warranty_expiry=warranty, condition=condition,
                    location_description=loc, is_active=True,
                )


register(FinanceDemoSeeder)
