"""Demo seed: suppliers, purchase orders, GRNs, purchase invoices + payments."""
from datetime import date, timedelta

from core.seeding import SeedContext, Seeder, register


class ProcurementDemoSeeder(Seeder):
    name = "procurement.demo"
    scope = "demo"
    depends_on = ("inventory.demo",)

    def run(self, ctx: SeedContext) -> None:
        shop_del, variants, users = ctx["shop_del"], ctx["variants"], ctx["users"]
        from procurement.models import Supplier, PurchaseOrder
        from procurement import services as proc_svc

        admin = users["admin"]

        supplier, _ = Supplier.objects.get_or_create(
            phone="+911144001001",
            defaults={
                "name": "Rohan Mobile Distributors",
                "contact_person": "Rohan Aggarwal",
                "email": "rohan@rmobiles.in",
                "address": "Plot 14, Wazirpur Industrial Area, Delhi",
                "state": "Delhi",
                "state_code": "07",
                "gstin": "07AACPR1234B1Z5",
                "payment_terms_days": 30,
            },
        )

        # Idempotency: only create primary PO if it doesn't exist yet
        if not PurchaseOrder.objects.filter(shop=shop_del, supplier=supplier).exists():
            v_ip14 = variants["iphone_screen"]
            v_sa54 = variants["samsung_battery"]
            v_usbc = variants["usbc"]

            po = proc_svc.create_purchase_order(
                shop=shop_del,
                supplier=supplier,
                data={
                    "expected_delivery_date": date.today() + timedelta(days=7),
                    "notes": "Urgent — iPhone screens running low",
                    "items": [
                        {"variant_id": str(v_ip14.id), "quantity_ordered": "5", "unit_cost": "3200", "tax_rate": "18", "hsn_code": "85177090"},
                        {"variant_id": str(v_sa54.id), "quantity_ordered": "10","unit_cost": "750",  "tax_rate": "18", "hsn_code": "85076000"},
                        {"variant_id": str(v_usbc.id), "quantity_ordered": "20","unit_cost": "100",  "tax_rate": "18", "hsn_code": "85444290"},
                    ],
                },
                user=admin,
            )

            proc_svc.update_purchase_order(po, {"status": "sent"}, admin)

            grn = proc_svc.receive_grn(
                shop=shop_del,
                po=po,
                data={
                    "received_date": str(date.today()),
                    "challan_number": "CH-2026-0042",
                    "notes": "Samsung batteries — 2 units physically damaged",
                    "items": [
                        {"po_item_id": str(po.items.get(variant=v_ip14).id), "quantity_received": "5",  "quantity_accepted": "5",  "quantity_rejected": "0"},
                        {"po_item_id": str(po.items.get(variant=v_sa54).id), "quantity_received": "10", "quantity_accepted": "8",  "quantity_rejected": "2", "rejection_reason": "Dented casing — DOA"},
                        {"po_item_id": str(po.items.get(variant=v_usbc).id), "quantity_received": "20", "quantity_accepted": "20", "quantity_rejected": "0"},
                    ],
                },
                user=admin,
            )

            inv = proc_svc.create_purchase_invoice(
                shop=shop_del,
                supplier=supplier,
                data={
                    "grn_id": str(grn.id),
                    "bill_number": "RMD-INV-2026-0189",
                    "bill_date": str(date.today()),
                    "due_date": str(date.today() + timedelta(days=30)),
                    "subtotal": str(grn.subtotal),
                },
                user=admin,
            )

            proc_svc.record_purchase_payment(
                invoice=inv,
                data={"amount": "15000", "method": "neft", "reference_id": "NEFT20260601"},
                user=admin,
            )

        # ── Extra suppliers ────────────────────────────────────────────────
        supp2, _ = Supplier.objects.get_or_create(
            phone="+912244001001",
            defaults={
                "name": "TechParts Global",
                "contact_person": "Suresh Chandra",
                "email": "suresh@techpartsglobal.com",
                "address": "34, Dharavi Industrial Estate, Mumbai",
                "state": "Maharashtra",
                "state_code": "27",
                "gstin": "27AACPT9876B1Z5",
                "payment_terms_days": 45,
            },
        )
        supp3, _ = Supplier.objects.get_or_create(
            phone="+918044001001",
            defaults={
                "name": "Apple Authorized Spares",
                "contact_person": "Ramesh Kumar",
                "email": "ramesh@appleauth.in",
                "address": "15, Koramangala, Bangalore",
                "state": "Karnataka",
                "state_code": "29",
                "gstin": "29AACPA1234C1Z5",
                "payment_terms_days": 30,
            },
        )
        supp4, _ = Supplier.objects.get_or_create(
            phone="+911244001001",
            defaults={
                "name": "Xiaomi Service Distributors",
                "contact_person": "Deepak Jain",
                "email": "deepak@xiaomiparts.in",
                "address": "45, Sector 18, Noida, UP",
                "state": "Uttar Pradesh",
                "state_code": "09",
                "gstin": "09AACPX5678D1Z5",
                "payment_terms_days": 30,
            },
        )

        # PO from Apple supplier — SENT, awaiting delivery
        v_ip13  = variants.get("SPN-IP13")
        v_ip15p = variants.get("SPN-IP15P")
        if v_ip13 and v_ip15p and not PurchaseOrder.objects.filter(shop=shop_del, supplier=supp3).exists():
            po_apple = proc_svc.create_purchase_order(
                shop=shop_del, supplier=supp3,
                data={
                    "expected_delivery_date": date.today() + timedelta(days=5),
                    "notes": "Q2 stock replenishment — iPhone 13 and 15 Pro screens",
                    "items": [
                        {"variant_id": str(v_ip13.id),  "quantity_ordered": "10", "unit_cost": "2600", "tax_rate": "18", "hsn_code": "85177090"},
                        {"variant_id": str(v_ip15p.id), "quantity_ordered": "5",  "unit_cost": "6000", "tax_rate": "18", "hsn_code": "85177090"},
                    ],
                },
                user=admin,
            )
            proc_svc.update_purchase_order(po_apple, {"status": "sent"}, admin)

        # PO from Xiaomi supplier — DRAFT (not yet confirmed)
        v_rdn12 = variants.get("SPN-RDN12")
        v_rlc55 = variants.get("SPN-RLC55")
        if v_rdn12 and v_rlc55 and not PurchaseOrder.objects.filter(shop=shop_del, supplier=supp4).exists():
            proc_svc.create_purchase_order(
                shop=shop_del, supplier=supp4,
                data={
                    "expected_delivery_date": date.today() + timedelta(days=10),
                    "notes": "Restocking Redmi and Realme batteries",
                    "items": [
                        {"variant_id": str(v_rdn12.id), "quantity_ordered": "15", "unit_cost": "450", "tax_rate": "18", "hsn_code": "85076000"},
                        {"variant_id": str(v_rlc55.id), "quantity_ordered": "12", "unit_cost": "400", "tax_rate": "18", "hsn_code": "85076000"},
                    ],
                },
                user=admin,
            )

        # PO from TechParts — fully received and paid
        v_ep01  = variants.get("ACC-EP01")
        v_pb10k = variants.get("ACC-PB10K")
        v_wc15  = variants.get("ACC-WC15")
        if v_ep01 and v_pb10k and v_wc15 and not PurchaseOrder.objects.filter(shop=shop_del, supplier=supp2).exists():
            po_tech = proc_svc.create_purchase_order(
                shop=shop_del, supplier=supp2,
                data={
                    "expected_delivery_date": date.today() - timedelta(days=15),
                    "notes": "Accessories bulk order",
                    "items": [
                        {"variant_id": str(v_ep01.id),  "quantity_ordered": "30", "unit_cost": "100", "tax_rate": "18", "hsn_code": "85183000"},
                        {"variant_id": str(v_pb10k.id), "quantity_ordered": "10", "unit_cost": "550", "tax_rate": "18", "hsn_code": "85076000"},
                        {"variant_id": str(v_wc15.id),  "quantity_ordered": "15", "unit_cost": "400", "tax_rate": "18", "hsn_code": "85044090"},
                    ],
                },
                user=admin,
            )
            proc_svc.update_purchase_order(po_tech, {"status": "sent"}, admin)
            grn_tech = proc_svc.receive_grn(
                shop=shop_del, po=po_tech,
                data={
                    "received_date": str(date.today() - timedelta(days=10)),
                    "challan_number": "TG-CH-2026-0087",
                    "notes": "All items received in good condition",
                    "items": [
                        {"po_item_id": str(po_tech.items.get(variant=v_ep01).id),  "quantity_received": "30", "quantity_accepted": "30", "quantity_rejected": "0"},
                        {"po_item_id": str(po_tech.items.get(variant=v_pb10k).id), "quantity_received": "10", "quantity_accepted": "10", "quantity_rejected": "0"},
                        {"po_item_id": str(po_tech.items.get(variant=v_wc15).id),  "quantity_received": "15", "quantity_accepted": "15", "quantity_rejected": "0"},
                    ],
                },
                user=admin,
            )
            inv_tech = proc_svc.create_purchase_invoice(
                shop=shop_del, supplier=supp2,
                data={
                    "grn_id": str(grn_tech.id),
                    "bill_number": "TG-INV-2026-0456",
                    "bill_date": str(date.today() - timedelta(days=10)),
                    "due_date": str(date.today() + timedelta(days=35)),
                    "subtotal": str(grn_tech.subtotal),
                },
                user=admin,
            )
            proc_svc.record_purchase_payment(
                invoice=inv_tech,
                data={"amount": str(inv_tech.grand_total), "method": "neft", "reference_id": "NEFT20260520TG"},
                user=admin,
            )


register(ProcurementDemoSeeder)
