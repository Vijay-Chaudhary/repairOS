"""Demo seed: product catalogue, variants and opening stock (HSN codes, ₹ prices)."""
from decimal import Decimal

from core.seeding import SeedContext, Seeder, register

# ctx["variants"] key → barcode natural key (must mirror run()'s specs).
NAMED_VARIANT_BARCODES = {
    "iphone_screen": "SPN-IP14-OEM",
    "samsung_battery": "SPN-SA54-ORI",
    "usbc": "ACC-USBC1-BR",
    "glass": "ACC-TG01-03",
    "charger": "ACC-CA65-WH",
}
EXTRA_SKU_BARCODES = [
    ("SPN-IP13", "SPN-IP13-OEM"), ("SPN-IP15P", "SPN-IP15P-OEM"),
    ("SPN-SSS23", "SPN-SSS23-ORI"), ("SPN-SSA33", "SPN-SSA33-ORI"),
    ("SPN-RLC55", "SPN-RLC55-ORI"), ("SPN-RDN12", "SPN-RDN12-ORI"),
    ("SPN-IP12CP", "SPN-IP12CP-ORI"), ("SPN-OPA57S", "SPN-OPA57S-ORI"),
    ("ACC-USBC2", "ACC-USBC2-NY"), ("ACC-LIG1", "ACC-LIG1-MFI"),
    ("ACC-WC15", "ACC-WC15-RND"), ("ACC-EP01", "ACC-EP01-IE"),
    ("ACC-CASE-IP14", "ACC-CASE-IP14-BK"), ("ACC-CASE-SA54", "ACC-CASE-SA54-CL"),
    ("ACC-PB10K", "ACC-PB10K-BK"), ("ACC-SCRKIT", "ACC-SCRKIT-SP"),
    ("ACC-MU1", "ACC-MU1-BAS"), ("ACC-TGIP14", "ACC-TGIP14-PV"),
    ("ACC-TGSA54", "ACC-TGSA54-CL"), ("ACC-CA20W", "ACC-CA20W-WH"),
]


class InventoryDemoSeeder(Seeder):
    name = "inventory.demo"
    scope = "demo"
    depends_on = ("authentication.demo_users",)

    def run(self, ctx: SeedContext) -> None:
        shop_del, users = ctx["shop_del"], ctx["users"]
        from inventory.models import ProductCategory, Product, ProductVariant, InventoryStock
        from inventory import services as inv_svc

        admin = users["admin"]

        cat_spare, _ = ProductCategory.objects.get_or_create(name="Spare Parts")
        cat_acc, _ = ProductCategory.objects.get_or_create(name="Accessories & Consumables")

        def _product(sku, cat, name, brand, hsn, for_sale, for_repair):
            return Product.objects.get_or_create(
                sku=sku,
                defaults={
                    "category": cat, "name": name, "brand": brand,
                    "hsn_code": hsn, "default_tax_rate": Decimal("18"),
                    "is_for_sale": for_sale, "is_for_repair_use": for_repair,
                },
            )[0]

        p_ip14_screen = _product("SPN-IP14", cat_spare, "iPhone 14 Display Assembly", "Apple",    "85177090", False, True)
        p_sa54_batt   = _product("SPN-SA54", cat_spare, "Samsung A54 Battery",         "Samsung",  "85076000", False, True)
        p_usbc        = _product("ACC-USBC1",cat_acc,   "USB-C Cable 1m",              "Generic",  "85444290", True,  False)
        p_glass       = _product("ACC-TG01", cat_acc,   "Tempered Glass (Universal)",  "Generic",  "70099200", True,  False)
        p_charger     = _product("ACC-CA65", cat_acc,   "65W Charging Adapter",        "Generic",  "85044090", True,  False)

        def _variant(product, name, barcode, cost, sell, wholesale=None):
            return ProductVariant.objects.get_or_create(
                barcode=barcode,
                defaults={
                    "product": product, "variant_name": name,
                    "cost_price": Decimal(str(cost)),
                    "selling_price": Decimal(str(sell)),
                    "wholesale_price": Decimal(str(wholesale)) if wholesale else None,
                },
            )[0]

        v_ip14   = _variant(p_ip14_screen, "OEM Grade A",   "SPN-IP14-OEM", 3500,  4500)
        v_sa54   = _variant(p_sa54_batt,   "Original",      "SPN-SA54-ORI", 800,   1200)
        v_usbc   = _variant(p_usbc,        "Braided",       "ACC-USBC1-BR", 120,   299,  wholesale=220)
        v_glass  = _variant(p_glass,       "0.3mm",         "ACC-TG01-03",  50,    149,  wholesale=110)
        v_charge = _variant(p_charger,     "White / GaN",   "ACC-CA65-WH",  400,   899,  wholesale=650)

        from django.db import transaction as dbtxn

        def _open_stock(variant, qty, reorder):
            stock = InventoryStock.objects.filter(shop=shop_del, variant=variant).first()
            if stock is None or stock.quantity_in_stock == 0:
                with dbtxn.atomic():
                    inv_svc.opening_stock(shop_del, variant, Decimal(str(qty)), admin)
            InventoryStock.objects.filter(shop=shop_del, variant=variant).update(reorder_level=Decimal(str(reorder)))

        _open_stock(v_ip14,   10, 3)
        _open_stock(v_sa54,    2, 5)   # qty=2 < reorder_level=5 → low-stock alert
        _open_stock(v_usbc,   50, 10)
        _open_stock(v_glass,  40, 10)
        _open_stock(v_charge, 20,  5)

        # ── Extra products and variants ────────────────────────────────────
        cat_comp,  _ = ProductCategory.objects.get_or_create(name="Components & Ports")
        cat_cable, _ = ProductCategory.objects.get_or_create(name="Cables & Adapters")
        cat_prot,  _ = ProductCategory.objects.get_or_create(name="Protection & Cases")
        cat_power, _ = ProductCategory.objects.get_or_create(name="Power & Charging")
        cat_audio, _ = ProductCategory.objects.get_or_create(name="Audio & Accessories")

        extra_prod_specs = [
            ("SPN-IP13",      cat_spare, "iPhone 13 Display Assembly",      "Apple",   "85177090", False, True),
            ("SPN-IP15P",     cat_spare, "iPhone 15 Pro Display Assembly",   "Apple",   "85177090", False, True),
            ("SPN-SSS23",     cat_spare, "Samsung Galaxy S23 Battery",       "Samsung", "85076000", False, True),
            ("SPN-SSA33",     cat_spare, "Samsung Galaxy A33 Battery",       "Samsung", "85076000", False, True),
            ("SPN-RLC55",     cat_spare, "Realme C55 Battery",               "Realme",  "85076000", False, True),
            ("SPN-RDN12",     cat_spare, "Redmi Note 12 Battery",            "Xiaomi",  "85076000", False, True),
            ("SPN-IP12CP",    cat_comp,  "iPhone 12 Lightning Port",         "Apple",   "85177090", False, True),
            ("SPN-OPA57S",    cat_spare, "Oppo A57 Speaker Module",          "Oppo",    "85182100", False, True),
            ("ACC-USBC2",     cat_cable, "USB-C Cable 2m",                   "Generic", "85444290", True,  False),
            ("ACC-LIG1",      cat_cable, "Lightning Cable 1m",               "Generic", "85444290", True,  False),
            ("ACC-WC15",      cat_power, "15W Wireless Charging Pad",        "Generic", "85044090", True,  False),
            ("ACC-EP01",      cat_audio, "Wired Earphones 3.5mm",            "Generic", "85183000", True,  False),
            ("ACC-CASE-IP14", cat_prot,  "iPhone 14 Silicone Case",          "Apple",   "39269090", True,  False),
            ("ACC-CASE-SA54", cat_prot,  "Samsung A54 TPU Case",             "Samsung", "39269090", True,  False),
            ("ACC-PB10K",     cat_power, "Power Bank 10000mAh",              "Generic", "85076000", True,  False),
            ("ACC-SCRKIT",    cat_acc,   "Screen Cleaning Kit",              "Generic", "34021900", True,  False),
            ("ACC-MU1",       cat_cable, "Micro USB Cable 1m",               "Generic", "85444290", True,  False),
            ("ACC-TGIP14",    cat_prot,  "Tempered Glass iPhone 14",         "Generic", "70099200", True,  False),
            ("ACC-TGSA54",    cat_prot,  "Tempered Glass Samsung A54",       "Generic", "70099200", True,  False),
            ("ACC-CA20W",     cat_power, "20W PD Wall Charger",              "Generic", "85044090", True,  False),
        ]

        extra_variant_specs = [
            ("SPN-IP13",      "OEM Grade A",      "SPN-IP13-OEM",    2800, 3800,  None),
            ("SPN-IP15P",     "OEM Grade A",      "SPN-IP15P-OEM",   6500, 8500,  None),
            ("SPN-SSS23",     "Original",         "SPN-SSS23-ORI",   1200, 1800,  None),
            ("SPN-SSA33",     "Original",         "SPN-SSA33-ORI",   600,  950,   None),
            ("SPN-RLC55",     "Original",         "SPN-RLC55-ORI",   450,  750,   None),
            ("SPN-RDN12",     "Original",         "SPN-RDN12-ORI",   500,  799,   None),
            ("SPN-IP12CP",    "Original",         "SPN-IP12CP-ORI",  800,  1400,  None),
            ("SPN-OPA57S",    "Original",         "SPN-OPA57S-ORI",  350,  600,   None),
            ("ACC-USBC2",     "Nylon Braided",    "ACC-USBC2-NY",    150,  349,   260),
            ("ACC-LIG1",      "MFI Certified",    "ACC-LIG1-MFI",    180,  399,   290),
            ("ACC-WC15",      "Round Pad",        "ACC-WC15-RND",    450,  999,   750),
            ("ACC-EP01",      "In-ear Wired",     "ACC-EP01-IE",     120,  299,   220),
            ("ACC-CASE-IP14", "Midnight Black",   "ACC-CASE-IP14-BK",80,   249,   180),
            ("ACC-CASE-SA54", "Clear TPU",        "ACC-CASE-SA54-CL",60,   199,   140),
            ("ACC-PB10K",     "Black",            "ACC-PB10K-BK",    600,  1499,  1100),
            ("ACC-SCRKIT",    "Spray + Cloth",    "ACC-SCRKIT-SP",   40,   99,    None),
            ("ACC-MU1",       "Basic",            "ACC-MU1-BAS",     60,   149,   110),
            ("ACC-TGIP14",    "0.3mm Privacy",    "ACC-TGIP14-PV",   80,   249,   180),
            ("ACC-TGSA54",    "0.3mm Clear",      "ACC-TGSA54-CL",   70,   219,   160),
            ("ACC-CA20W",     "White",            "ACC-CA20W-WH",    280,  699,   500),
        ]

        prod_map = {sku: _product(sku, cat, nm, brand, hsn, fs, fr)
                    for sku, cat, nm, brand, hsn, fs, fr in extra_prod_specs}
        extra_variants = {}
        for sku, vname, barcode, cost, sell, wholesale in extra_variant_specs:
            extra_variants[sku] = _variant(prod_map[sku], vname, barcode, cost, sell, wholesale)

        extra_stock_specs = [
            ("SPN-IP13",      8,  3), ("SPN-IP15P",     5,  2),
            ("SPN-SSS23",     6,  3), ("SPN-SSA33",     10, 5),
            ("SPN-RLC55",     8,  4), ("SPN-RDN12",     4,  5),
            ("SPN-IP12CP",    6,  3), ("SPN-OPA57S",    4,  3),
            ("ACC-USBC2",     30, 10), ("ACC-LIG1",     25, 10),
            ("ACC-WC15",      15, 5),  ("ACC-EP01",     30, 10),
            ("ACC-CASE-IP14", 20, 8),  ("ACC-CASE-SA54",20, 8),
            ("ACC-PB10K",     12, 5),  ("ACC-SCRKIT",   40, 15),
            ("ACC-MU1",       50, 15), ("ACC-TGIP14",   25, 8),
            ("ACC-TGSA54",    20, 8),  ("ACC-CA20W",    15, 5),
        ]
        for sku, qty, reorder in extra_stock_specs:
            _open_stock(extra_variants[sku], qty, reorder)

        ctx["variants"] = {
            "iphone_screen":  v_ip14,
            "samsung_battery": v_sa54,
            "usbc":    v_usbc,
            "glass":   v_glass,
            "charger": v_charge,
            **extra_variants,
        }

    def load(self, ctx: SeedContext) -> None:
        """Re-fetch by the barcode natural keys run() creates with."""
        from inventory.models import ProductVariant

        wanted = list(NAMED_VARIANT_BARCODES.values()) + [b for _, b in EXTRA_SKU_BARCODES]
        by_barcode = {v.barcode: v for v in ProductVariant.objects.filter(barcode__in=wanted)}
        variants = {key: by_barcode.get(bc) for key, bc in NAMED_VARIANT_BARCODES.items()}
        for sku, barcode in EXTRA_SKU_BARCODES:
            variants[sku] = by_barcode.get(barcode)
        ctx["variants"] = variants


register(InventoryDemoSeeder)
