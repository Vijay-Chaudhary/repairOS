"""Demo seed: counter/wholesale/job-linked sales + a return (GST/IGST cases)."""
import logging
from decimal import Decimal

from core.seeding import SeedContext, Seeder, register

logger = logging.getLogger(__name__)


class PosDemoSeeder(Seeder):
    name = "pos.demo"
    scope = "demo"
    depends_on = ("crm.demo", "inventory.demo")

    def run(self, ctx: SeedContext) -> None:
        shop_del, crm = ctx["shop_del"], ctx["crm"]
        users, variants = ctx["users"], ctx["variants"]
        from pos.models import Sale
        from pos import services as pos_svc

        admin       = users["admin"]
        cust_direct = crm["direct"]
        cust_biz    = crm["business"]
        v_usbc      = variants["usbc"]
        v_glass     = variants["glass"]
        v_charge    = variants["charger"]

        def _item(v, qty, price, hsn="85444290"):
            return {
                "variant_id": str(v.id),
                "product_name_snapshot": v.product.name,
                "variant_name_snapshot": v.variant_name,
                "hsn_code": hsn,
                "quantity": str(qty),
                "unit_price": str(price),
                "tax_rate": "18",
            }

        # Sale 1 — counter sale, cash
        if not Sale.objects.filter(shop=shop_del, sale_type="counter").exists():
            sale1 = pos_svc.create_sale(shop_del, {
                "sale_type": "counter",
                "customer": cust_direct,
                "items": [
                    _item(v_usbc,  2, v_usbc.selling_price),
                    _item(v_glass, 1, v_glass.selling_price, hsn="70099200"),
                ],
                "payments": [{"method": "cash", "amount": str(
                    2 * v_usbc.selling_price + v_glass.selling_price
                )}],
            }, admin)

            # Return 1 USB-C cable from sale1
            if sale1.status == "completed":
                ret = pos_svc.create_return(sale1, {
                    "reason": "Customer bought wrong length",
                    "items": [{"sale_item_id": str(sale1.items.filter(variant_id=v_usbc.id).first().id), "quantity": "1"}],
                }, admin)
                pos_svc.approve_return(ret, admin)

        # Sale 2 — wholesale, NEFT, business customer
        if not Sale.objects.filter(shop=shop_del, sale_type="wholesale").exists():
            # Wholesale uses the Mumbai customer but sold from Delhi shop
            # (inter-state IGST since customer GSTIN starts with 27)
            pos_svc.create_sale(shop_del, {
                "sale_type": "wholesale",
                "customer": cust_biz,
                "items": [
                    _item(v_charge, 10, v_charge.wholesale_price or v_charge.selling_price, hsn="85044090"),
                    _item(v_usbc,   20, v_usbc.wholesale_price   or v_usbc.selling_price),
                ],
                "payments": [{"method": "neft", "amount": str(
                    10 * (v_charge.wholesale_price or v_charge.selling_price) +
                    20 * (v_usbc.wholesale_price   or v_usbc.selling_price)
                ), "reference_id": "NEFT20260601WS"}],
            }, admin)

        # Sale 3 — job-linked (accessories for J3)
        from pos.models import Sale as POS_Sale
        from repair.models import JobTicket
        j3 = JobTicket.objects.filter(shop=shop_del, status="ready_for_pickup").first()
        if j3 and not POS_Sale.objects.filter(job_id=j3.id).exists():
            pos_svc.create_sale(shop_del, {
                "sale_type": "job_linked",
                "customer": j3.customer,
                "job_id": str(j3.id),
                "items": [_item(v_glass, 1, v_glass.selling_price, hsn="70099200")],
                "payments": [{"method": "cash", "amount": str(v_glass.selling_price)}],
            }, admin)

        # ── Extra counter sales ────────────────────────────────────────────
        def _get(sku):
            return variants.get(sku)

        v_ep01      = _get("ACC-EP01")
        v_pb10k     = _get("ACC-PB10K")
        v_lign      = _get("ACC-LIG1")
        v_usbc2     = _get("ACC-USBC2")
        v_wc        = _get("ACC-WC15")
        v_case_ip14 = _get("ACC-CASE-IP14")
        v_case_sa54 = _get("ACC-CASE-SA54")
        v_tg_ip14   = _get("ACC-TGIP14")
        v_tg_sa54   = _get("ACC-TGSA54")
        v_ca20      = _get("ACC-CA20W")
        v_mu1       = _get("ACC-MU1")
        v_scrkit    = _get("ACC-SCRKIT")

        extra_counter_specs = [
            # (phone, [(variant, qty, price), ...], payment_method)
            ("+919100000010", [(v_lign, 1, 399), (v_tg_ip14, 1, 249)],                   "cash"),
            ("+919100000011", [(v_case_sa54, 1, 199), (v_tg_sa54, 1, 219), (v_usbc2, 1, 349)], "upi"),
            ("+919100000012", [(v_ep01, 1, 299)],                                          "cash"),
            ("+919100000013", [(v_pb10k, 1, 1499), (v_ca20, 1, 699)],                     "card"),
            ("+919100000014", [(v_mu1, 2, 149)],                                           "cash"),
            ("+919100000015", [(v_wc, 1, 999), (v_lign, 1, 399)],                         "upi"),
            ("+919100000016", [(v_scrkit, 2, 99)],                                         "cash"),
            ("+919100000017", [(v_case_ip14, 1, 249), (v_tg_ip14, 1, 249)],               "upi"),
            ("+919100000018", [(v_pb10k, 1, 1499)],                                        "card"),
            ("+919100000019", [(v_usbc2, 2, 349), (v_mu1, 1, 149)],                       "cash"),
            ("+919100000020", [(v_ep01, 1, 299), (v_ca20, 1, 699)],                       "upi"),
            ("+919100000021", [(v_glass, 2, 149), (v_usbc, 1, 299)],                      "cash"),
        ]
        for phone, items_spec, pay_method in extra_counter_specs:
            cust = crm.get(phone)
            if not cust:
                continue
            if Sale.objects.filter(shop=shop_del, customer=cust, sale_type="counter").exists():
                continue
            valid = [(v, qty, price) for v, qty, price in items_spec if v is not None]
            if not valid:
                continue
            total = sum(Decimal(str(qty)) * Decimal(str(price)) for _, qty, price in valid)
            try:
                pos_svc.create_sale(shop_del, {
                    "sale_type": "counter",
                    "customer": cust,
                    "items": [_item(v, qty, price) for v, qty, price in valid],
                    "payments": [{"method": pay_method, "amount": str(total)}],
                }, admin)
            except Exception as exc:
                logger.warning("POS sale skipped (%s): %s", phone, exc)

        # Extra wholesale order — MobileZone India
        cust_mz = crm.get("+919100000031")
        if cust_mz and v_ca20 and v_usbc2 and v_lign:
            if not Sale.objects.filter(shop=shop_del, customer=cust_mz, sale_type="wholesale").exists():
                ws_total = (
                    20 * (v_ca20.wholesale_price or v_ca20.selling_price) +
                    30 * (v_usbc2.wholesale_price or v_usbc2.selling_price) +
                    15 * (v_lign.wholesale_price or v_lign.selling_price)
                )
                try:
                    pos_svc.create_sale(shop_del, {
                        "sale_type": "wholesale",
                        "customer": cust_mz,
                        "items": [
                            _item(v_ca20,  20, v_ca20.wholesale_price  or v_ca20.selling_price,  hsn="85044090"),
                            _item(v_usbc2, 30, v_usbc2.wholesale_price or v_usbc2.selling_price),
                            _item(v_lign,  15, v_lign.wholesale_price  or v_lign.selling_price),
                        ],
                        "payments": [{"method": "neft", "amount": str(ws_total), "reference_id": "NEFT20260610WS2"}],
                    }, admin)
                except Exception as exc:
                    logger.warning("Wholesale sale skipped: %s", exc)


register(PosDemoSeeder)
