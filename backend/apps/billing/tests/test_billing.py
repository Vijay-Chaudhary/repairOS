"""
Billing module tests — §10 acceptance criteria + §11 test cases.

Covers:
- Invoice created from job: labor line = service_charge, component lines = spare parts
- GST split: intra-state (CGST+SGST), inter-state (IGST)
- Discount applied correctly: subtotal - discount + tax = grand_total
- Partial payment rolls status issued → partially_paid → paid
- Outstanding never goes negative (overpayment blocked)
- CRM denormalized totals updated on invoice creation and payment
- Razorpay webhook records payment exactly once (dedup on razorpay_payment_id)
- Tally CSV export contains expected columns and rows
- Duplicate invoice for same job blocked
"""

import hashlib
import hmac
import json
from decimal import Decimal

import pytest
from rest_framework import status


# ──────────────────────────────────────────────────────────────────────────────
# Fixtures
# ──────────────────────────────────────────────────────────────────────────────


@pytest.fixture
def shop(db):
    from core.models import Shop
    return Shop.objects.create(
        name="Hotspot Repair", code="HTA",
        address="MG Road", city="Delhi",
        state="Delhi", state_code="07",
        phone="+919876543210",
    )


@pytest.fixture
def shop_other_state(db):
    from core.models import Shop
    return Shop.objects.create(
        name="Mumbai Repair", code="MUM",
        address="Andheri", city="Mumbai",
        state="Maharashtra", state_code="27",
        phone="+919876540000",
    )


@pytest.fixture
def customer_intra(db, shop):
    """Customer in same state as shop (Delhi — GSTIN starts with 07)."""
    from crm.models import Customer
    return Customer.objects.create(
        shop=shop, name="Intra Customer",
        phone="+919811100001",
        gstin="07AABCU9603R1ZX",  # Delhi state code 07
    )


@pytest.fixture
def customer_inter(db, shop):
    """Customer in different state (Maharashtra — GSTIN starts with 27)."""
    from crm.models import Customer
    return Customer.objects.create(
        shop=shop, name="Inter Customer",
        phone="+919811100002",
        gstin="27AABCU9603R1ZX",  # Maharashtra state code 27
    )


@pytest.fixture
def customer_no_gstin(db, shop):
    """Customer without GSTIN — defaults to intra-state."""
    from crm.models import Customer
    return Customer.objects.create(
        shop=shop, name="B2C Customer",
        phone="+919811100003",
    )


@pytest.fixture
def tech_user(db):
    from authentication.models import User
    return User.objects.create_user(
        email="tech@test.com", phone="+919800000001",
        full_name="Tech User", password="pass",
    )


@pytest.fixture
def job(db, shop, customer_intra, tech_user):
    from repair.models import JobTicket
    return JobTicket.objects.create(
        shop=shop,
        customer=customer_intra,
        created_by=tech_user,
        job_number="HTA-2026-0001",
        device_type="Laptop",
        device_brand="Dell",
        device_model="Inspiron",
        problem_description="Screen broken",
        service_charge=Decimal("500.00"),
        status=JobTicket.Status.READY_FOR_PICKUP,
    )


@pytest.fixture
def job_with_parts(db, shop, customer_intra, tech_user):
    """Job with spare part requests (received)."""
    from repair.models import JobSparePartRequest, JobTicket
    j = JobTicket.objects.create(
        shop=shop,
        customer=customer_intra,
        created_by=tech_user,
        job_number="HTA-2026-0002",
        device_type="Phone",
        device_brand="Samsung",
        device_model="S21",
        problem_description="Battery dead",
        service_charge=Decimal("200.00"),
        status=JobTicket.Status.READY_FOR_PICKUP,
    )
    JobSparePartRequest.objects.create(
        shop=j.shop,
        job=j,
        requested_by=tech_user,
        custom_part_name="Samsung Battery",
        quantity=1,
        status=JobSparePartRequest.RequestStatus.RECEIVED,
    )
    return j


@pytest.fixture
def admin_user(db):
    from authentication.models import Permission, Role, RolePermission, User, UserRole
    user = User.objects.create_user(
        email="admin@billing.com", phone="+919800000099",
        full_name="Billing Admin", password="pass",
    )
    role = Role.objects.create(name="Admin", is_system_role=True)
    for code in [
        "billing.repair_invoices.view",
        "billing.repair_invoices.create",
        "billing.payments.record",
        "billing.outstanding.view",
        "billing.tally_export",
    ]:
        perm, _ = Permission.objects.get_or_create(codename=code, defaults={"label": code})
        RolePermission.objects.create(role=role, permission=perm)
    UserRole.objects.create(user=user, role=role)
    return user


@pytest.fixture
def admin_client(db, admin_user):
    from rest_framework.test import APIClient
    from rest_framework_simplejwt.tokens import RefreshToken
    refresh = RefreshToken.for_user(admin_user)
    access = refresh.access_token
    access["permissions"] = [
        "billing.repair_invoices.view",
        "billing.repair_invoices.create",
        "billing.payments.record",
        "billing.outstanding.view",
        "billing.tally_export",
    ]
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {str(access)}")
    return client


@pytest.fixture
def repair_invoice(db, shop, job, admin_user):
    """Pre-created invoice for payment tests."""
    from billing import services
    return services.create_repair_invoice(job, {"discount_amount": "0"}, admin_user)


# ──────────────────────────────────────────────────────────────────────────────
# TestInvoiceCreation
# ──────────────────────────────────────────────────────────────────────────────


class TestInvoiceCreation:
    url = "/api/v1/billing/repair-invoices/"

    def test_create_invoice_via_api(self, admin_client, job, shop):
        res = admin_client.post(self.url, {
            "job_id": str(job.id),
            "discount_amount": "0",
        }, format="json")
        assert res.status_code == status.HTTP_201_CREATED
        assert res.data["invoice_number"].startswith("HTA-INV-")
        assert res.data["status"] == "issued"

    def test_invoice_labor_line_equals_service_charge(self, admin_client, job, shop):
        res = admin_client.post(self.url, {
            "job_id": str(job.id),
            "discount_amount": "0",
        }, format="json")
        assert res.status_code == status.HTTP_201_CREATED
        from billing.models import RepairInvoice, RepairInvoiceItem
        inv = RepairInvoice.objects.get(id=res.data["id"])
        labor_items = inv.items.filter(item_type=RepairInvoiceItem.ItemType.LABOR)
        assert labor_items.count() == 1
        assert labor_items.first().unit_price == job.service_charge

    def test_duplicate_invoice_for_same_job_blocked(self, admin_client, job, repair_invoice):
        res = admin_client.post(self.url, {
            "job_id": str(job.id),
            "discount_amount": "0",
        }, format="json")
        # Duplicate invoice is a BusinessRuleViolation → 422 (not a 400 serializer error).
        assert res.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY

    def test_invoice_number_format(self, admin_client, job, shop):
        from django.utils import timezone
        now = timezone.now()
        res = admin_client.post(self.url, {
            "job_id": str(job.id),
            "discount_amount": "0",
        }, format="json")
        assert res.status_code == status.HTTP_201_CREATED
        expected_prefix = f"HTA-INV-{now.year}-{now.month:02d}-"
        assert res.data["invoice_number"].startswith(expected_prefix)

    def test_component_lines_from_received_spare_parts(self, admin_client, job_with_parts):
        res = admin_client.post(self.url, {
            "job_id": str(job_with_parts.id),
            "discount_amount": "0",
        }, format="json")
        assert res.status_code == status.HTTP_201_CREATED
        from billing.models import RepairInvoice, RepairInvoiceItem
        inv = RepairInvoice.objects.get(id=res.data["id"])
        component_items = inv.items.filter(item_type=RepairInvoiceItem.ItemType.COMPONENT)
        assert component_items.count() == 1
        assert "Battery" in component_items.first().description


# ──────────────────────────────────────────────────────────────────────────────
# TestGSTComputation
# ──────────────────────────────────────────────────────────────────────────────


class TestGSTComputation:
    url = "/api/v1/billing/repair-invoices/"

    def test_intra_state_gst_splits_into_cgst_sgst(self, admin_client, shop, customer_intra, tech_user, db):
        """Shop state_code 07 == customer GSTIN prefix 07 → CGST+SGST, IGST=0."""
        from repair.models import JobTicket
        j = JobTicket.objects.create(
            shop=shop, customer=customer_intra, created_by=tech_user,
            job_number="HTA-2026-GST1",
            device_type="PC", device_brand="HP", device_model="Elite",
            problem_description="Boot fail",
            service_charge=Decimal("1000.00"),
            status=JobTicket.Status.READY_FOR_PICKUP,
        )
        res = admin_client.post(self.url, {"job_id": str(j.id), "discount_amount": "0"}, format="json")
        assert res.status_code == status.HTTP_201_CREATED
        # 18% GST on 1000 → 180 tax; intra → CGST=90, SGST=90, IGST=0
        assert Decimal(res.data["cgst"]) == Decimal("90.00")
        assert Decimal(res.data["sgst"]) == Decimal("90.00")
        assert Decimal(res.data["igst"]) == Decimal("0.00")

    def test_inter_state_gst_uses_igst_only(self, admin_client, shop, customer_inter, tech_user, db):
        """Shop state 07, customer GSTIN prefix 27 → IGST only, CGST+SGST=0."""
        from repair.models import JobTicket
        j = JobTicket.objects.create(
            shop=shop, customer=customer_inter, created_by=tech_user,
            job_number="HTA-2026-GST2",
            device_type="PC", device_brand="Lenovo", device_model="ThinkPad",
            problem_description="Hinge broken",
            service_charge=Decimal("1000.00"),
            status=JobTicket.Status.READY_FOR_PICKUP,
        )
        res = admin_client.post(self.url, {"job_id": str(j.id), "discount_amount": "0"}, format="json")
        assert res.status_code == status.HTTP_201_CREATED
        assert Decimal(res.data["cgst"]) == Decimal("0.00")
        assert Decimal(res.data["sgst"]) == Decimal("0.00")
        assert Decimal(res.data["igst"]) == Decimal("180.00")

    def test_no_gstin_defaults_to_intra_state(self, admin_client, shop, customer_no_gstin, tech_user, db):
        from repair.models import JobTicket
        j = JobTicket.objects.create(
            shop=shop, customer=customer_no_gstin, created_by=tech_user,
            job_number="HTA-2026-GST3",
            device_type="Phone", device_brand="Oppo", device_model="F19",
            problem_description="Screen crack",
            service_charge=Decimal("500.00"),
            status=JobTicket.Status.READY_FOR_PICKUP,
        )
        res = admin_client.post(self.url, {"job_id": str(j.id), "discount_amount": "0"}, format="json")
        assert res.status_code == status.HTTP_201_CREATED
        assert Decimal(res.data["igst"]) == Decimal("0.00")
        assert Decimal(res.data["cgst"]) > Decimal("0.00")

    def test_grand_total_equals_subtotal_minus_discount_plus_tax(self, admin_client, shop, customer_intra, tech_user, db):
        from repair.models import JobTicket
        j = JobTicket.objects.create(
            shop=shop, customer=customer_intra, created_by=tech_user,
            job_number="HTA-2026-MATH1",
            device_type="Laptop", device_brand="Asus", device_model="Zen",
            problem_description="Charger issue",
            service_charge=Decimal("1000.00"),
            status=JobTicket.Status.READY_FOR_PICKUP,
        )
        res = admin_client.post(self.url, {
            "job_id": str(j.id), "discount_amount": "100",
        }, format="json")
        assert res.status_code == status.HTTP_201_CREATED
        subtotal = Decimal(res.data["subtotal"])
        discount = Decimal(res.data["discount_amount"])
        cgst = Decimal(res.data["cgst"])
        sgst = Decimal(res.data["sgst"])
        igst = Decimal(res.data["igst"])
        grand_total = Decimal(res.data["grand_total"])
        assert grand_total == subtotal - discount + cgst + sgst + igst


# ──────────────────────────────────────────────────────────────────────────────
# TestPayments
# ──────────────────────────────────────────────────────────────────────────────


class TestPayments:
    url = "/api/v1/billing/payments/"

    def test_full_payment_marks_invoice_paid(self, admin_client, repair_invoice):
        res = admin_client.post(self.url, {
            "invoice_id": str(repair_invoice.id),
            "amount": str(repair_invoice.grand_total),
            "method": "cash",
        }, format="json")
        assert res.status_code == status.HTTP_201_CREATED
        repair_invoice.refresh_from_db()
        assert repair_invoice.status == "paid"
        assert repair_invoice.amount_outstanding == Decimal("0.00")

    def test_partial_payment_sets_partially_paid(self, admin_client, repair_invoice):
        partial = (repair_invoice.grand_total / 2).quantize(Decimal("0.01"))
        res = admin_client.post(self.url, {
            "invoice_id": str(repair_invoice.id),
            "amount": str(partial),
            "method": "upi",
            "reference_id": "UPI123",
        }, format="json")
        assert res.status_code == status.HTTP_201_CREATED
        repair_invoice.refresh_from_db()
        assert repair_invoice.status == "partially_paid"
        assert repair_invoice.amount_outstanding > Decimal("0.00")

    def test_two_partial_payments_complete_invoice(self, admin_client, repair_invoice):
        half = (repair_invoice.grand_total / 2).quantize(Decimal("0.01"))
        admin_client.post(self.url, {
            "invoice_id": str(repair_invoice.id),
            "amount": str(half),
            "method": "upi",
        }, format="json")
        # Pay remaining
        repair_invoice.refresh_from_db()
        remaining = repair_invoice.amount_outstanding
        admin_client.post(self.url, {
            "invoice_id": str(repair_invoice.id),
            "amount": str(remaining),
            "method": "cash",
        }, format="json")
        repair_invoice.refresh_from_db()
        assert repair_invoice.status == "paid"
        assert repair_invoice.amount_outstanding == Decimal("0.00")

    def test_overpayment_blocked(self, admin_client, repair_invoice):
        overpay = repair_invoice.grand_total + Decimal("1.00")
        res = admin_client.post(self.url, {
            "invoice_id": str(repair_invoice.id),
            "amount": str(overpay),
            "method": "cash",
        }, format="json")
        assert res.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY

    def test_outstanding_never_negative(self, admin_client, repair_invoice):
        """After overpayment is blocked, outstanding stays non-negative."""
        overpay = repair_invoice.grand_total + Decimal("100")
        admin_client.post(self.url, {
            "invoice_id": str(repair_invoice.id),
            "amount": str(overpay),
            "method": "cash",
        }, format="json")
        repair_invoice.refresh_from_db()
        assert repair_invoice.amount_outstanding >= Decimal("0.00")

    def test_crm_total_outstanding_decreases_on_payment(self, admin_client, repair_invoice):
        customer = repair_invoice.customer
        customer.refresh_from_db()
        outstanding_before = customer.total_outstanding
        admin_client.post(self.url, {
            "invoice_id": str(repair_invoice.id),
            "amount": str(repair_invoice.grand_total),
            "method": "cash",
        }, format="json")
        customer.refresh_from_db()
        assert customer.total_outstanding < outstanding_before
        assert customer.total_outstanding == Decimal("0.00")


# ──────────────────────────────────────────────────────────────────────────────
# TestCRMDenormalization
# ──────────────────────────────────────────────────────────────────────────────


class TestCRMDenormalization:
    url = "/api/v1/billing/repair-invoices/"

    def test_invoice_creation_increments_total_billed(self, admin_client, job):
        customer = job.customer
        customer.refresh_from_db()
        billed_before = customer.total_billed
        res = admin_client.post(self.url, {
            "job_id": str(job.id), "discount_amount": "0",
        }, format="json")
        assert res.status_code == status.HTTP_201_CREATED
        customer.refresh_from_db()
        assert customer.total_billed > billed_before
        assert customer.total_billed == billed_before + Decimal(res.data["grand_total"])

    def test_invoice_creation_increments_total_outstanding(self, admin_client, job):
        customer = job.customer
        customer.refresh_from_db()
        outstanding_before = customer.total_outstanding
        res = admin_client.post(self.url, {
            "job_id": str(job.id), "discount_amount": "0",
        }, format="json")
        assert res.status_code == status.HTTP_201_CREATED
        customer.refresh_from_db()
        assert customer.total_outstanding == outstanding_before + Decimal(res.data["grand_total"])


# ──────────────────────────────────────────────────────────────────────────────
# TestRazorpayWebhook
# ──────────────────────────────────────────────────────────────────────────────


class TestRazorpayWebhook:
    url = "/api/v1/billing/webhooks/razorpay/"

    def _sign(self, payload: bytes, secret: str) -> str:
        return hmac.new(secret.encode(), payload, hashlib.sha256).hexdigest()

    def test_webhook_records_payment(self, admin_client, repair_invoice, settings):
        secret = "test_webhook_secret"
        settings.RAZORPAY_WEBHOOK_SECRET = secret
        payload = json.dumps({
            "event": "payment.captured",
            "payload": {
                "payment": {
                    "entity": {
                        "id": "pay_test123",
                        "order_id": "order_test456",
                        "amount": int(repair_invoice.grand_total * 100),
                        "notes": {"invoice_id": str(repair_invoice.id)},
                    }
                }
            }
        }).encode()
        sig = self._sign(payload, secret)
        from rest_framework.test import APIClient
        client = APIClient()
        res = client.post(
            self.url, data=payload,
            content_type="application/json",
            HTTP_X_RAZORPAY_SIGNATURE=sig,
        )
        assert res.status_code == status.HTTP_200_OK
        repair_invoice.refresh_from_db()
        assert repair_invoice.status == "paid"

    def test_webhook_replay_recorded_only_once(self, admin_client, repair_invoice, settings):
        """Sending the same webhook twice records payment exactly once."""
        secret = "test_webhook_secret"
        settings.RAZORPAY_WEBHOOK_SECRET = secret
        amount_paise = int(repair_invoice.grand_total * 100)
        payload = json.dumps({
            "event": "payment.captured",
            "payload": {
                "payment": {
                    "entity": {
                        "id": "pay_dedup999",
                        "order_id": "order_dedup456",
                        "amount": amount_paise,
                        "notes": {"invoice_id": str(repair_invoice.id)},
                    }
                }
            }
        }).encode()
        sig = self._sign(payload, secret)
        from rest_framework.test import APIClient
        client = APIClient()
        client.post(self.url, data=payload, content_type="application/json",
                    HTTP_X_RAZORPAY_SIGNATURE=sig)
        res2 = client.post(self.url, data=payload, content_type="application/json",
                           HTTP_X_RAZORPAY_SIGNATURE=sig)
        assert res2.status_code == status.HTTP_200_OK
        from billing.models import Payment
        count = Payment.objects.filter(razorpay_payment_id="pay_dedup999").count()
        assert count == 1

    def test_invalid_signature_rejected(self, repair_invoice, settings):
        settings.RAZORPAY_WEBHOOK_SECRET = "correct_secret"
        payload = b'{"event": "payment.captured"}'
        from rest_framework.test import APIClient
        client = APIClient()
        res = client.post(self.url, data=payload, content_type="application/json",
                          HTTP_X_RAZORPAY_SIGNATURE="bad_signature")
        assert res.status_code == status.HTTP_400_BAD_REQUEST


# ──────────────────────────────────────────────────────────────────────────────
# TestTallyExport
# ──────────────────────────────────────────────────────────────────────────────


class TestTallyExport:
    url = "/api/v1/billing/tally-export/"

    def test_tally_export_returns_csv(self, admin_client, repair_invoice, shop):
        res = admin_client.get(self.url, {
            "shop_id": str(shop.id),
            "from_date": "2026-01-01",
            "to_date": "2026-12-31",
        })
        assert res.status_code == status.HTTP_200_OK
        assert "text/csv" in res["Content-Type"]

    def test_tally_export_contains_invoice_row(self, admin_client, repair_invoice, shop):
        res = admin_client.get(self.url, {
            "shop_id": str(shop.id),
            "from_date": "2026-01-01",
            "to_date": "2026-12-31",
        })
        content = res.content.decode()
        assert repair_invoice.invoice_number in content

    def test_tally_export_has_required_columns(self, admin_client, repair_invoice, shop):
        res = admin_client.get(self.url, {
            "shop_id": str(shop.id),
            "from_date": "2026-01-01",
            "to_date": "2026-12-31",
        })
        header = res.content.decode().splitlines()[0]
        for col in ["invoice_number", "date", "customer_name", "gstin",
                    "subtotal", "cgst", "sgst", "igst", "grand_total"]:
            assert col in header
