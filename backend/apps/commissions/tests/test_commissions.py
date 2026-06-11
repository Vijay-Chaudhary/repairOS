"""
Commissions module tests — §10 acceptance criteria + §11 test cases.

Covers:
- Single-tech commission = SC × rate%
- Multi-tech: lead gets lead_tech_share%, others split remainder equally; sum = pool exactly
- Warranty job (SC=0) → no commission rows created
- Rule selected by effective date window (not expired, not yet active)
- Rule selected by job_type (None matches all; specific type matches only that type)
- Payout batch creation sums unpaid commissions and marks them is_paid
- Double-payout guard: already-paid commissions excluded from new batch
- API: CRUD rules, technician ledger, payout creation
"""

import datetime
from decimal import Decimal, ROUND_HALF_UP

import pytest
from rest_framework import status


# ──────────────────────────────────────────────────────────────────────────────
# Fixtures
# ──────────────────────────────────────────────────────────────────────────────


@pytest.fixture
def shop(db):
    from core.models import Shop
    return Shop.objects.create(
        name="Test Shop", code="TST",
        address="1 Main St", city="Delhi",
        state="Delhi", state_code="07",
        phone="+919000000001",
    )


@pytest.fixture
def customer(db, shop):
    from crm.models import Customer
    return Customer.objects.create(
        shop=shop, name="Test Customer", phone="+919000000002",
    )


@pytest.fixture
def tech1(db):
    from authentication.models import User
    return User.objects.create_user(
        email="tech1@test.com", phone="+919000000010",
        full_name="Tech One", password="pass",
    )


@pytest.fixture
def tech2(db):
    from authentication.models import User
    return User.objects.create_user(
        email="tech2@test.com", phone="+919000000011",
        full_name="Tech Two", password="pass",
    )


@pytest.fixture
def tech3(db):
    from authentication.models import User
    return User.objects.create_user(
        email="tech3@test.com", phone="+919000000012",
        full_name="Tech Three", password="pass",
    )


@pytest.fixture
def admin_user(db):
    from authentication.models import Permission, Role, RolePermission, User, UserRole
    user = User.objects.create_user(
        email="admin@comm.com", phone="+919000000099",
        full_name="Admin", password="pass",
    )
    role = Role.objects.create(name="CommAdmin", is_system_role=True)
    for code in [
        "settings.commission_rules.manage",
        "hr.salary.view",
        "hr.salary.generate",
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
        "settings.commission_rules.manage",
        "hr.salary.view",
        "hr.salary.generate",
    ]
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {str(access)}")
    return client


@pytest.fixture
def rule(db):
    from commissions.models import CommissionRule
    return CommissionRule.objects.create(
        name="Standard 30%",
        rate=Decimal("30.00"),
        lead_tech_share=Decimal("50.00"),
        effective_from=datetime.date(2026, 1, 1),
        effective_to=None,
    )


def make_job(shop, customer, tech, service_charge, job_number, device_type="Laptop"):
    from repair.models import JobTicket
    return JobTicket.objects.create(
        shop=shop,
        customer=customer,
        created_by=tech,
        job_number=job_number,
        device_type=device_type,
        problem_description="Test issue",
        service_charge=service_charge,
        status=JobTicket.Status.DELIVERED,
    )


def add_stage(job, tech, stage_order=1):
    from repair.models import JobStage
    return JobStage.objects.create(
        job=job,
        stage_order=stage_order,
        stage_type="repair",
        assigned_technician=tech,
        status=JobStage.StageStatus.COMPLETED,
    )


# ──────────────────────────────────────────────────────────────────────────────
# TestAccrual — service-layer tests (no HTTP)
# ──────────────────────────────────────────────────────────────────────────────


class TestAccrual:

    def test_single_tech_commission_equals_sc_times_rate(self, db, shop, customer, tech1, rule):
        from commissions import services
        job = make_job(shop, customer, tech1, Decimal("1000.00"), "TST-2026-0001")
        add_stage(job, tech1, stage_order=1)

        services.accrue_commission(job)

        from commissions.models import TechnicianCommission
        rows = TechnicianCommission.objects.filter(job=job)
        assert rows.count() == 1
        row = rows.first()
        assert row.technician == tech1
        assert row.commission_amount == Decimal("300.00")   # 1000 × 30%
        assert row.is_lead is True

    def test_multi_tech_lead_gets_lead_share_others_split_remainder(
        self, db, shop, customer, tech1, tech2, rule
    ):
        from commissions import services
        job = make_job(shop, customer, tech1, Decimal("1000.00"), "TST-2026-0002")
        add_stage(job, tech1, stage_order=1)  # lead
        add_stage(job, tech2, stage_order=2)

        services.accrue_commission(job)

        from commissions.models import TechnicianCommission
        rows = {r.technician_id: r for r in TechnicianCommission.objects.filter(job=job)}
        assert len(rows) == 2

        pool = Decimal("300.00")   # 1000 × 30%
        lead_amount = Decimal("150.00")   # 300 × 50%
        other_amount = Decimal("150.00")   # remainder for tech2

        assert rows[tech1.id].commission_amount == lead_amount
        assert rows[tech1.id].is_lead is True
        assert rows[tech2.id].commission_amount == other_amount
        assert rows[tech2.id].is_lead is False

        # No rounding leak: sum equals pool
        total = sum(r.commission_amount for r in rows.values())
        assert total == pool

    def test_three_tech_split_sums_to_pool_exactly(
        self, db, shop, customer, tech1, tech2, tech3, rule
    ):
        """Pool=100, lead_share=50% → lead=50; others get 25 each; sum=100."""
        from commissions import services
        # SC=333.33, rate=30% → pool=99.99 → tricky rounding
        job = make_job(shop, customer, tech1, Decimal("333.33"), "TST-2026-0003")
        add_stage(job, tech1, stage_order=1)
        add_stage(job, tech2, stage_order=2)
        add_stage(job, tech3, stage_order=3)

        services.accrue_commission(job)

        from commissions.models import TechnicianCommission
        rows = TechnicianCommission.objects.filter(job=job)
        assert rows.count() == 3
        total = sum(r.commission_amount for r in rows)
        pool = (Decimal("333.33") * Decimal("30") / 100).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        assert total == pool

    def test_warranty_job_sc_zero_no_commission_created(self, db, shop, customer, tech1, rule):
        from commissions import services
        job = make_job(shop, customer, tech1, Decimal("0.00"), "TST-2026-0004")
        add_stage(job, tech1, stage_order=1)

        services.accrue_commission(job)

        from commissions.models import TechnicianCommission
        assert TechnicianCommission.objects.filter(job=job).count() == 0

    def test_no_matching_rule_no_commission_created(self, db, shop, customer, tech1):
        """Without any active rule, accrue_commission silently does nothing."""
        from commissions import services
        job = make_job(shop, customer, tech1, Decimal("500.00"), "TST-2026-0005")
        add_stage(job, tech1, stage_order=1)

        services.accrue_commission(job)   # no CommissionRule exists

        from commissions.models import TechnicianCommission
        assert TechnicianCommission.objects.filter(job=job).count() == 0

    def test_rule_selected_by_effective_date_window(self, db, shop, customer, tech1):
        """Only the rule whose window covers the job's closure date is used."""
        from commissions.models import CommissionRule
        from commissions import services

        old_rule = CommissionRule.objects.create(
            name="Old 20%", rate=Decimal("20.00"),
            effective_from=datetime.date(2025, 1, 1),
            effective_to=datetime.date(2025, 12, 31),
        )
        new_rule = CommissionRule.objects.create(
            name="New 30%", rate=Decimal("30.00"),
            effective_from=datetime.date(2026, 1, 1),
            effective_to=None,
        )

        job = make_job(shop, customer, tech1, Decimal("1000.00"), "TST-2026-0006")
        add_stage(job, tech1, stage_order=1)
        services.accrue_commission(job)

        from commissions.models import TechnicianCommission
        row = TechnicianCommission.objects.get(job=job, technician=tech1)
        assert row.rate == Decimal("30.00")
        assert row.commission_amount == Decimal("300.00")

    def test_rule_with_matching_job_type_takes_precedence(self, db, shop, customer, tech1):
        from commissions.models import CommissionRule
        from commissions import services

        generic_rule = CommissionRule.objects.create(
            name="Generic 20%", rate=Decimal("20.00"),
            effective_from=datetime.date(2026, 1, 1),
        )
        specific_rule = CommissionRule.objects.create(
            name="Phone 40%", rate=Decimal("40.00"),
            applies_to_job_type="Phone",
            effective_from=datetime.date(2026, 1, 1),
        )

        job = make_job(shop, customer, tech1, Decimal("1000.00"), "TST-2026-0007",
                       device_type="Phone")
        add_stage(job, tech1, stage_order=1)
        services.accrue_commission(job)

        from commissions.models import TechnicianCommission
        row = TechnicianCommission.objects.get(job=job, technician=tech1)
        assert row.rate == Decimal("40.00")

    def test_job_with_no_stages_skips_accrual(self, db, shop, customer, tech1, rule):
        """
        Jobs without stages have no reliable technician to attribute commission to —
        job.created_by is typically the receptionist who opened the ticket, and
        JobTicket has no assigned_technician field (only JobStage does). Crediting
        the creator would misattribute commission, so accrual is skipped instead.
        """
        from commissions import services
        job = make_job(shop, customer, tech1, Decimal("500.00"), "TST-2026-0008")

        services.accrue_commission(job)

        from commissions.models import TechnicianCommission
        assert TechnicianCommission.objects.filter(job=job).count() == 0


# ──────────────────────────────────────────────────────────────────────────────
# TestPayout
# ──────────────────────────────────────────────────────────────────────────────


class TestPayout:

    def test_payout_sums_unpaid_commissions_in_period(
        self, db, shop, customer, tech1, rule, admin_user
    ):
        from commissions import services
        job1 = make_job(shop, customer, tech1, Decimal("1000.00"), "TST-PO-001")
        add_stage(job1, tech1, 1)
        services.accrue_commission(job1)

        job2 = make_job(shop, customer, tech1, Decimal("500.00"), "TST-PO-002")
        add_stage(job2, tech1, 1)
        services.accrue_commission(job2)

        payout = services.create_payout(
            technician=tech1,
            period_start=datetime.date(2026, 1, 1),
            period_end=datetime.date(2026, 12, 31),
            created_by=admin_user,
        )

        assert payout.total_commission == Decimal("450.00")   # 300 + 150
        assert payout.status == "draft"

    def test_payout_marks_commissions_is_paid(
        self, db, shop, customer, tech1, rule, admin_user
    ):
        from commissions import services
        job = make_job(shop, customer, tech1, Decimal("1000.00"), "TST-PO-003")
        add_stage(job, tech1, 1)
        services.accrue_commission(job)

        payout = services.create_payout(
            technician=tech1,
            period_start=datetime.date(2026, 1, 1),
            period_end=datetime.date(2026, 12, 31),
            created_by=admin_user,
        )

        from commissions.models import TechnicianCommission
        row = TechnicianCommission.objects.get(job=job, technician=tech1)
        assert row.is_paid is True
        assert row.payout == payout

    def test_already_paid_commissions_excluded_from_new_payout(
        self, db, shop, customer, tech1, rule, admin_user
    ):
        from commissions import services
        job1 = make_job(shop, customer, tech1, Decimal("1000.00"), "TST-PO-004")
        add_stage(job1, tech1, 1)
        services.accrue_commission(job1)

        # First payout covers job1
        services.create_payout(
            technician=tech1,
            period_start=datetime.date(2026, 1, 1),
            period_end=datetime.date(2026, 12, 31),
            created_by=admin_user,
        )

        # New job accrues after first payout
        job2 = make_job(shop, customer, tech1, Decimal("500.00"), "TST-PO-005")
        add_stage(job2, tech1, 1)
        services.accrue_commission(job2)

        # Second payout should only include job2
        payout2 = services.create_payout(
            technician=tech1,
            period_start=datetime.date(2026, 1, 1),
            period_end=datetime.date(2026, 12, 31),
            created_by=admin_user,
        )
        assert payout2.total_commission == Decimal("150.00")

    def test_payout_with_no_unpaid_commissions_raises(
        self, db, tech1, admin_user
    ):
        from core.exceptions import BusinessRuleViolation
        from commissions import services
        with pytest.raises(BusinessRuleViolation):
            services.create_payout(
                technician=tech1,
                period_start=datetime.date(2026, 1, 1),
                period_end=datetime.date(2026, 12, 31),
                created_by=admin_user,
            )


# ──────────────────────────────────────────────────────────────────────────────
# TestAPI
# ──────────────────────────────────────────────────────────────────────────────


class TestRulesAPI:
    url = "/api/v1/commissions/rules/"

    def test_create_rule(self, admin_client):
        res = admin_client.post(self.url, {
            "name": "Standard 30%",
            "rate": "30.00",
            "lead_tech_share": "50.00",
            "effective_from": "2026-01-01",
        }, format="json")
        assert res.status_code == status.HTTP_201_CREATED
        assert res.data["rate"] == "30.00"

    def test_list_rules(self, admin_client, rule):
        res = admin_client.get(self.url)
        assert res.status_code == status.HTTP_200_OK
        assert len(res.data["items"]) >= 1

    def test_create_rule_requires_manage_permission(self, db):
        from rest_framework.test import APIClient
        client = APIClient()
        res = client.post(self.url, {"name": "X", "rate": "10", "effective_from": "2026-01-01"})
        assert res.status_code == status.HTTP_401_UNAUTHORIZED


class TestTechnicianLedgerAPI:
    def test_get_technician_ledger(self, admin_client, shop, customer, tech1, rule, db):
        from commissions import services
        job = make_job(shop, customer, tech1, Decimal("1000.00"), "TST-LED-001")
        add_stage(job, tech1, 1)
        services.accrue_commission(job)

        res = admin_client.get(f"/api/v1/commissions/technician/{tech1.id}/")
        assert res.status_code == status.HTTP_200_OK
        # total_unpaid is now a float (was Decimal string "300.00")
        assert res.data["total_unpaid"] == pytest.approx(300.0)
        assert res.data["total_earned"] == pytest.approx(300.0)
        assert res.data["total_paid"] == pytest.approx(0.0)
        assert res.data["technician_name"] == tech1.full_name
        assert len(res.data["commissions"]) == 1
        assert res.data["commissions"][0]["job_closed_at"] is not None

    def test_get_technician_ledger_period_filter(self, admin_client, shop, customer, tech1, rule, db):
        from commissions import services
        job = make_job(shop, customer, tech1, Decimal("1000.00"), "TST-LED-002")
        add_stage(job, tech1, 1)
        services.accrue_commission(job)

        # Filter to a future period — commission should be excluded
        res = admin_client.get(
            f"/api/v1/commissions/technician/{tech1.id}/",
            {"period_start": "2030-01-01", "period_end": "2030-12-31"},
        )
        assert res.status_code == status.HTTP_200_OK
        assert len(res.data["commissions"]) == 0
        assert res.data["total_earned"] == pytest.approx(0.0)


class TestPayoutAPI:
    url = "/api/v1/commissions/payouts/"

    def test_create_payout_via_api(self, admin_client, shop, customer, tech1, rule, db):
        from commissions import services
        job = make_job(shop, customer, tech1, Decimal("1000.00"), "TST-API-PO-001")
        add_stage(job, tech1, 1)
        services.accrue_commission(job)

        res = admin_client.post(self.url, {
            "technician_id": str(tech1.id),
            "period_start": "2026-01-01",
            "period_end": "2026-12-31",
        }, format="json")
        assert res.status_code == status.HTTP_201_CREATED
        assert res.data["status"] == "draft"
        assert Decimal(res.data["total_commission"]) == Decimal("300.00")

    def test_job_closure_triggers_commission_accrual(
        self, admin_client, shop, customer, tech1, rule, db
    ):
        """Transitioning a job to CLOSED via the repair API accrues commission."""
        from repair.models import JobTicket
        job = make_job(shop, customer, tech1, Decimal("800.00"), "TST-CLOSE-001")
        job.status = JobTicket.Status.DELIVERED
        job.save(update_fields=["status"])
        add_stage(job, tech1, 1)

        from rest_framework.test import APIClient
        from rest_framework_simplejwt.tokens import RefreshToken
        refresh = RefreshToken.for_user(tech1)
        access = refresh.access_token
        access["permissions"] = ["repair.jobs.change_status", "repair.jobs.assign_tech"]
        access["is_tenant_wide"] = True
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {str(access)}")

        res = client.post(
            f"/api/v1/repair/jobs/{job.id}/status/",
            {"to_status": "closed"},
            format="json",
        )
        assert res.status_code == status.HTTP_200_OK

        from commissions.models import TechnicianCommission
        rows = TechnicianCommission.objects.filter(job=job)
        assert rows.count() == 1
        assert rows.first().commission_amount == Decimal("240.00")   # 800 × 30%


# ──────────────────────────────────────────────────────────────────────────────
# TestPayoutPDF — Commissions #13
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.django_db
class TestPayoutPDF:
    """generate_payout_pdf renders a PDF and sets payout.pdf_url."""

    def test_generate_payout_pdf_sets_pdf_url(self, db, shop, customer, tech1, rule):
        """generate_payout_pdf called directly sets payout.pdf_url to a non-empty path."""
        import uuid as uuid_mod
        from commissions.models import CommissionPayout
        from commissions.tasks import generate_payout_pdf

        # Create a bare payout row (no commissions needed — template handles empty list)
        payout = CommissionPayout.objects.create(
            technician=tech1,
            period_start=datetime.date(2026, 6, 1),
            period_end=datetime.date(2026, 6, 30),
            total_commission=Decimal("300.00"),
            status=CommissionPayout.Status.DRAFT,
        )

        generate_payout_pdf(str(payout.id))

        payout.refresh_from_db()
        assert payout.pdf_url != ""
        assert payout.pdf_url.endswith(".pdf")

    def test_generate_payout_pdf_file_is_nonempty(self, db, shop, customer, tech1, rule, tmp_path, settings):
        """The generated PDF file exists and contains actual bytes."""
        import os
        settings.MEDIA_ROOT = str(tmp_path)
        settings.MEDIA_URL = "/media/"

        from commissions.models import CommissionPayout
        from commissions.tasks import generate_payout_pdf

        payout = CommissionPayout.objects.create(
            technician=tech1,
            period_start=datetime.date(2026, 6, 1),
            period_end=datetime.date(2026, 6, 30),
            total_commission=Decimal("600.00"),
            status=CommissionPayout.Status.DRAFT,
        )

        generate_payout_pdf(str(payout.id))
        payout.refresh_from_db()

        full_path = os.path.join(str(tmp_path), payout.pdf_url.removeprefix("/media/"))
        assert os.path.exists(full_path)
        assert os.path.getsize(full_path) > 0

    def test_payout_creation_dispatches_pdf_task(self, db, shop, customer, tech1, rule):
        """create_payout dispatches generate_payout_pdf (ALWAYS_EAGER runs it sync)."""
        from commissions import services

        job = make_job(shop, customer, tech1, Decimal("500.00"), "TST-PDF-003")
        add_stage(job, tech1, 1)
        services.accrue_commission(job)

        # CELERY_TASK_ALWAYS_EAGER = True → task runs synchronously inside create_payout
        payout = services.create_payout(tech1, datetime.date(2026, 1, 1), datetime.date(2026, 12, 31), tech1)
        payout.refresh_from_db()
        assert payout.pdf_url != ""

    def test_generate_payout_pdf_missing_payout_is_no_op(self, db):
        """A missing payout ID must not raise — task exits gracefully."""
        import uuid
        from commissions.tasks import generate_payout_pdf
        generate_payout_pdf(str(uuid.uuid4()))  # should not raise
