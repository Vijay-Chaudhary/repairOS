"""
Repair module tests — §10 acceptance criteria + §11 test cases.

Covers:
- Job number uniqueness
- Status transition machine (valid + invalid edges)
- check-in-before-open guard
- Estimate flow and SC propagation
- Stage workflow (single in_progress invariant, auto-advance)
- Warranty claim (within period + past expiry)
- Spare-part request lifecycle
- Soft-delete visibility
- RBAC: technician sees only own jobs
"""

import datetime

import pytest
from rest_framework import status


# ──────────────────────────────────────────────────────────────────────────────
# Shared fixtures
# ──────────────────────────────────────────────────────────────────────────────


@pytest.fixture
def shop(db):
    from core.models import Shop

    return Shop.objects.create(
        name="Joy Computer",
        code="JOY",
        address="MG Road",
        city="Delhi",
        state="UP",
        state_code="09",
        phone="+919876543210",
    )


@pytest.fixture
def customer(db, shop):
    from crm.models import Customer

    return Customer.objects.create(shop=shop, name="Ravi Kumar", phone="+919811100001")


@pytest.fixture
def admin_user(db):
    from authentication.models import Permission, Role, RolePermission, User, UserRole

    user = User.objects.create_user(
        email="admin@repair.test",
        phone="+919000000010",
        full_name="Repair Admin",
        password="AdminPass@1",
    )
    role, _ = Role.objects.get_or_create(name="Tenant Admin", defaults={"is_system_role": True})
    perms = [
        "repair.jobs.view", "repair.jobs.create", "repair.jobs.edit",
        "repair.jobs.change_status", "repair.jobs.assign_tech",
        "repair.estimates.send", "repair.estimates.approve",
        "repair.templates.manage", "repair.warranty.view",
        "repair.spare_parts.request", "repair.spare_parts.approve",
    ]
    for codename in perms:
        perm, _ = Permission.objects.get_or_create(
            codename=codename, defaults={"module": "repair", "label": codename}
        )
        RolePermission.objects.get_or_create(role=role, permission=perm)
    UserRole.objects.create(user=user, role=role, shop=None)
    return user


@pytest.fixture
def tech_user(db):
    from authentication.models import Permission, Role, RolePermission, User, UserRole

    user = User.objects.create_user(
        email="tech@repair.test",
        phone="+919000000011",
        full_name="Technician One",
        password="TechPass@1",
    )
    role, _ = Role.objects.get_or_create(name="Technician", defaults={"is_system_role": True})
    # Technician only gets view (own) and spare_parts.request — NOT assign_tech
    for codename in ["repair.jobs.view", "repair.jobs.change_status", "repair.spare_parts.request"]:
        perm, _ = Permission.objects.get_or_create(
            codename=codename, defaults={"module": "repair", "label": codename}
        )
        RolePermission.objects.get_or_create(role=role, permission=perm)
    UserRole.objects.create(user=user, role=role, shop=None)
    return user


def _make_client(api_client, user):
    from authentication.tokens import _build_token_claims
    from rest_framework_simplejwt.tokens import RefreshToken

    refresh = RefreshToken.for_user(user)
    access = refresh.access_token
    for k, v in _build_token_claims(user, "test").items():
        access[k] = v
    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {str(access)}")
    return api_client


@pytest.fixture
def admin_client(api_client, admin_user):
    return _make_client(api_client, admin_user)


@pytest.fixture
def tech_client(api_client, tech_user):
    return _make_client(api_client, tech_user)


@pytest.fixture
def job(db, shop, customer, admin_user):
    from repair.models import JobTicket
    from repair.services import create_job

    return create_job(
        shop, customer,
        {"device_type": "Laptop", "problem_description": "Does not power on.", "priority": "normal"},
        admin_user,
    )


# ──────────────────────────────────────────────────────────────────────────────
# Job number
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.django_db
class TestJobNumber:
    def test_job_number_format(self, job, shop):
        year = datetime.date.today().year
        assert job.job_number.startswith(f"{shop.code}-{year}-")

    def test_job_numbers_unique(self, shop, customer, admin_user):
        from repair.services import create_job

        j1 = create_job(shop, customer, {"device_type": "Phone", "problem_description": "Screen cracked."}, admin_user)
        j2 = create_job(shop, customer, {"device_type": "Phone", "problem_description": "Screen cracked."}, admin_user)
        assert j1.job_number != j2.job_number

    def test_job_number_zero_padded(self, job):
        # e.g. JOY-2026-0001
        parts = job.job_number.split("-")
        assert len(parts[-1]) == 4


# ──────────────────────────────────────────────────────────────────────────────
# Job creation API
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.django_db
class TestJobCreate:
    url = "/api/v1/repair/jobs/"

    def test_create_job(self, admin_client, shop, customer):
        res = admin_client.post(self.url, {
            "shop_id": str(shop.id),
            "customer_id": str(customer.id),
            "device_type": "Laptop",
            "problem_description": "Does not power on, no LED.",
            "priority": "normal",
        }, format="json")
        assert res.status_code == status.HTTP_201_CREATED
        assert res.data["status"] == "draft"
        assert "job_number" in res.data

    def test_problem_description_min_10_chars(self, admin_client, shop, customer):
        res = admin_client.post(self.url, {
            "shop_id": str(shop.id),
            "customer_id": str(customer.id),
            "device_type": "Laptop",
            "problem_description": "Short",
        }, format="json")
        assert res.status_code == status.HTTP_400_BAD_REQUEST

    def test_field_job_requires_location(self, admin_client, shop, customer):
        res = admin_client.post(self.url, {
            "shop_id": str(shop.id),
            "customer_id": str(customer.id),
            "device_type": "Laptop",
            "problem_description": "Client site repair needed.",
            "is_field_job": True,
        }, format="json")
        assert res.status_code == status.HTTP_400_BAD_REQUEST

    def test_create_requires_auth(self, api_client, shop, customer):
        res = api_client.post(self.url, {"device_type": "Laptop"}, format="json")
        assert res.status_code == status.HTTP_401_UNAUTHORIZED

    def test_template_prefills_description(self, admin_client, shop, customer):
        from repair.models import FaultTemplate

        template = FaultTemplate.objects.create(
            shop=shop,
            name="Laptop No Power",
            device_type="Laptop",
            problem_description="Device does not turn on, no charging LED.",
            default_sc="800.00",
        )
        res = admin_client.post(self.url, {
            "shop_id": str(shop.id),
            "customer_id": str(customer.id),
            "device_type": "Laptop",
            "template_id": str(template.id),
            "problem_description": "Device does not turn on, no charging LED.",
        }, format="json")
        assert res.status_code == status.HTTP_201_CREATED


# ──────────────────────────────────────────────────────────────────────────────
# Check-in + open guard
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.django_db
class TestCheckin:
    def test_submit_checkin(self, admin_client, job):
        res = admin_client.post(
            f"/api/v1/repair/jobs/{job.id}/checkin/",
            {"physical_condition": "good"},
            format="json",
        )
        assert res.status_code == status.HTTP_201_CREATED

    def test_open_without_checkin_raises_422(self, admin_client, job):
        res = admin_client.post(
            f"/api/v1/repair/jobs/{job.id}/status/",
            {"to_status": "open"},
            format="json",
        )
        assert res.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY

    def test_open_with_checkin_succeeds(self, admin_client, job):
        admin_client.post(
            f"/api/v1/repair/jobs/{job.id}/checkin/",
            {"physical_condition": "good"},
            format="json",
        )
        res = admin_client.post(
            f"/api/v1/repair/jobs/{job.id}/status/",
            {"to_status": "open"},
            format="json",
        )
        assert res.status_code == status.HTTP_200_OK
        assert res.data["status"] == "open"

    def test_open_with_admin_override_bypasses_checkin(self, admin_client, job):
        res = admin_client.post(
            f"/api/v1/repair/jobs/{job.id}/status/",
            {"to_status": "open", "reason": "Customer confirmed condition verbally"},
            format="json",
        )
        assert res.status_code == status.HTTP_200_OK


# ──────────────────────────────────────────────────────────────────────────────
# Status transitions
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.django_db
class TestStatusTransitions:
    def _transition(self, admin_client, job_id, to_status, reason=""):
        return admin_client.post(
            f"/api/v1/repair/jobs/{job_id}/status/",
            {"to_status": to_status, "reason": reason},
            format="json",
        )

    def _open_job(self, admin_client, job):
        admin_client.post(
            f"/api/v1/repair/jobs/{job.id}/checkin/",
            {"physical_condition": "good"},
            format="json",
        )
        return self._transition(admin_client, job.id, "open")

    def test_valid_draft_to_open(self, admin_client, job):
        self._open_job(admin_client, job)
        job.refresh_from_db()
        assert job.status == "open"

    def test_invalid_transition_returns_400(self, admin_client, job):
        res = self._transition(admin_client, job.id, "delivered")
        assert res.status_code == status.HTTP_400_BAD_REQUEST
        assert res.json()["error"]["code"] == "INVALID_STATUS_TRANSITION"

    def test_on_hold_requires_reason(self, admin_client, job):
        self._open_job(admin_client, job)
        self._transition(admin_client, job.id, "in_progress")
        res = self._transition(admin_client, job.id, "on_hold")
        assert res.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY

    def test_on_hold_with_reason_succeeds(self, admin_client, job):
        self._open_job(admin_client, job)
        self._transition(admin_client, job.id, "in_progress")
        res = self._transition(admin_client, job.id, "on_hold", reason="Waiting for parts")
        assert res.status_code == status.HTTP_200_OK

    def test_closed_sets_warranty_expires_at(self, admin_client, job):
        self._open_job(admin_client, job)
        self._transition(admin_client, job.id, "in_progress")
        self._transition(admin_client, job.id, "ready_for_pickup")
        self._transition(admin_client, job.id, "delivered")
        self._transition(admin_client, job.id, "closed")

        job.refresh_from_db()
        assert job.status == "closed"
        assert job.warranty_expires_at is not None
        from repair.services import DEFAULT_WARRANTY_DAYS
        expected = datetime.date.today() + datetime.timedelta(days=DEFAULT_WARRANTY_DAYS)
        assert job.warranty_expires_at == expected

    def test_cancelled_to_open_reopen(self, admin_client, job):
        self._open_job(admin_client, job)
        self._transition(admin_client, job.id, "cancelled")
        res = self._transition(admin_client, job.id, "open")
        assert res.status_code == status.HTTP_200_OK


# ──────────────────────────────────────────────────────────────────────────────
# Estimate flow
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.django_db
class TestEstimateFlow:
    def _open_job(self, admin_client, job):
        admin_client.post(f"/api/v1/repair/jobs/{job.id}/checkin/", {"physical_condition": "good"}, format="json")
        admin_client.post(f"/api/v1/repair/jobs/{job.id}/status/", {"to_status": "open"}, format="json")

    def test_create_estimate(self, admin_client, job):
        self._open_job(admin_client, job)
        res = admin_client.post(
            f"/api/v1/repair/jobs/{job.id}/estimate/",
            {"labor_charge": "1200.00", "parts_cost": "3500.00", "notes": "SSD 512GB + labor"},
            format="json",
        )
        assert res.status_code == status.HTTP_201_CREATED
        data = res.data
        assert "estimate_number" in data
        assert data["estimate_number"].startswith("JOY-EST-")
        assert float(data["total_estimate"]) == 4700.0

    def test_approve_estimate_sets_service_charge(self, admin_client, job):
        self._open_job(admin_client, job)
        admin_client.post(
            f"/api/v1/repair/jobs/{job.id}/estimate/",
            {"labor_charge": "1200.00"},
            format="json",
        )
        res = admin_client.post(
            f"/api/v1/repair/jobs/{job.id}/estimate/respond/",
            {"response": "approved", "method": "whatsapp"},
            format="json",
        )
        assert res.status_code == status.HTTP_200_OK

        job.refresh_from_db()
        assert float(job.service_charge) == 1200.0
        assert job.status == "estimate_approved"

    def test_reject_estimate(self, admin_client, job):
        self._open_job(admin_client, job)
        admin_client.post(
            f"/api/v1/repair/jobs/{job.id}/estimate/",
            {"labor_charge": "1200.00"},
            format="json",
        )
        res = admin_client.post(
            f"/api/v1/repair/jobs/{job.id}/estimate/respond/",
            {"response": "rejected", "method": "in_person"},
            format="json",
        )
        assert res.status_code == status.HTTP_200_OK
        job.refresh_from_db()
        assert job.status == "estimate_rejected"


# ──────────────────────────────────────────────────────────────────────────────
# Stage workflow
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.django_db
class TestStages:
    def _open_and_progress(self, admin_client, job):
        admin_client.post(f"/api/v1/repair/jobs/{job.id}/checkin/", {"physical_condition": "good"}, format="json")
        admin_client.post(f"/api/v1/repair/jobs/{job.id}/status/", {"to_status": "open"}, format="json")
        admin_client.post(f"/api/v1/repair/jobs/{job.id}/status/", {"to_status": "in_progress"}, format="json")

    def test_set_stages(self, admin_client, job, admin_user):
        self._open_and_progress(admin_client, job)
        res = admin_client.post(
            f"/api/v1/repair/jobs/{job.id}/stages/",
            {
                "stages": [
                    {"stage_order": 1, "stage_type": "diagnosis", "assigned_technician_id": str(admin_user.id)},
                    {"stage_order": 2, "stage_type": "repair", "assigned_technician_id": str(admin_user.id)},
                ]
            },
            format="json",
        )
        assert res.status_code == status.HTTP_200_OK

    def test_complete_stage_auto_advances(self, admin_client, job, admin_user):
        from repair.models import JobStage
        from repair.services import set_stages, start_stage

        self._open_and_progress(admin_client, job)
        stages = set_stages(
            job,
            [
                {"stage_order": 1, "stage_type": "diagnosis", "assigned_technician_id": admin_user.id},
                {"stage_order": 2, "stage_type": "repair", "assigned_technician_id": admin_user.id},
            ],
            admin_user,
        )
        first = stages[0]
        start_stage(first, admin_user)

        res = admin_client.post(
            f"/api/v1/repair/jobs/{job.id}/stages/",
            {"stage_id": str(first.id), "action": "complete", "notes": "Diagnosed: SSD failure"},
            format="json",
        )
        assert res.status_code == status.HTTP_200_OK
        assert res.data["status"] == "completed"

        # Second stage should now be in_progress
        second = JobStage.objects.get(pk=stages[1].id)
        assert second.status == "in_progress"

    def test_single_in_progress_invariant(self, job, admin_user):
        """
        The partial unique index `unique_in_progress_stage_per_job` prevents two
        stages from being in_progress simultaneously at the DB level.
        The service guard provides an additional app-level check.
        """
        from django.db import IntegrityError
        from repair.models import JobStage
        from repair.services import set_stages, start_stage

        stages = set_stages(
            job,
            [
                {"stage_order": 1, "stage_type": "diagnosis", "assigned_technician_id": admin_user.id},
                {"stage_order": 2, "stage_type": "repair", "assigned_technician_id": admin_user.id},
            ],
            admin_user,
        )
        start_stage(stages[0], admin_user)

        # DB (or service) should prevent a second stage from being in_progress
        with pytest.raises((IntegrityError, Exception)):
            stages[1].status = JobStage.StageStatus.IN_PROGRESS
            stages[1].save(update_fields=["status"])

    def test_ready_for_qc_requires_non_qc_stages_done(self, admin_client, job, admin_user):
        from repair.services import set_stages

        admin_client.post(f"/api/v1/repair/jobs/{job.id}/checkin/", {"physical_condition": "good"}, format="json")
        admin_client.post(f"/api/v1/repair/jobs/{job.id}/status/", {"to_status": "open"}, format="json")
        admin_client.post(f"/api/v1/repair/jobs/{job.id}/status/", {"to_status": "in_progress"}, format="json")

        set_stages(
            job,
            [{"stage_order": 1, "stage_type": "diagnosis", "assigned_technician_id": admin_user.id}],
            admin_user,
        )

        res = admin_client.post(
            f"/api/v1/repair/jobs/{job.id}/status/",
            {"to_status": "ready_for_qc"},
            format="json",
        )
        assert res.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY


# ──────────────────────────────────────────────────────────────────────────────
# Warranty claims
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.django_db
class TestWarrantyClaims:
    def _close_job(self, job, admin_user):
        from repair.models import JobTicket
        from repair.services import transition_job, submit_checkin

        submit_checkin(job, {"physical_condition": "good"}, admin_user)
        for s in ["open", "in_progress", "ready_for_pickup", "delivered", "closed"]:
            transition_job(job, s, admin_user, reason="test")
        job.refresh_from_db()

    def test_warranty_claim_within_period(self, admin_client, job, admin_user, shop, customer):
        self._close_job(job, admin_user)
        res = admin_client.post(f"/api/v1/repair/jobs/{job.id}/warranty-claim/", format="json")
        assert res.status_code == status.HTTP_201_CREATED

        warranty_job = res.data
        assert warranty_job["service_charge"] == "0.00"
        assert str(warranty_job["warranty_of_job"]) == str(job.id)

    def test_warranty_claim_past_expiry_returns_422(self, admin_client, job, admin_user):
        self._close_job(job, admin_user)

        # Backdate expiry
        job.warranty_expires_at = datetime.date.today() - datetime.timedelta(days=1)
        job.save(update_fields=["warranty_expires_at"])

        res = admin_client.post(f"/api/v1/repair/jobs/{job.id}/warranty-claim/", format="json")
        assert res.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY

    def test_warranty_claim_no_expiry_returns_422(self, admin_client, job):
        # Job was never closed, so warranty_expires_at is None
        res = admin_client.post(f"/api/v1/repair/jobs/{job.id}/warranty-claim/", format="json")
        assert res.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY


# ──────────────────────────────────────────────────────────────────────────────
# Spare-part requests
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.django_db
class TestSparePartRequests:
    def test_request_spare_part(self, admin_client, job):
        res = admin_client.post(
            f"/api/v1/repair/jobs/{job.id}/spare-parts/",
            {"custom_part_name": "Hinge bracket OEM", "quantity": 2},
            format="json",
        )
        assert res.status_code == status.HTTP_201_CREATED
        assert res.data["status"] == "requested"

    def test_review_approve(self, admin_client, job, admin_user):
        from repair.models import JobSparePartRequest
        from repair.services import request_spare_part

        req = request_spare_part(
            job, {"custom_part_name": "SSD 512GB", "quantity": 1, "is_urgent": False}, admin_user
        )
        res = admin_client.patch(
            f"/api/v1/repair/spare-parts/{req.id}/",
            {"status": "approved"},
            format="json",
        )
        assert res.status_code == status.HTTP_200_OK
        assert res.data["status"] == "approved"

    def test_request_needs_variant_or_name(self, admin_client, job):
        res = admin_client.post(
            f"/api/v1/repair/jobs/{job.id}/spare-parts/",
            {"quantity": 1},
            format="json",
        )
        assert res.status_code == status.HTTP_400_BAD_REQUEST


# ──────────────────────────────────────────────────────────────────────────────
# RBAC: technician scoping
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.django_db
class TestTechnicianScoping:
    def test_technician_sees_only_own_jobs(self, tech_client, tech_user, shop, customer, admin_user):
        from repair.services import create_job, set_stages

        j1 = create_job(shop, customer, {"device_type": "Phone", "problem_description": "Screen broken."}, admin_user)
        j2 = create_job(shop, customer, {"device_type": "Laptop", "problem_description": "No power, no LED."}, admin_user)

        # Assign j2 to tech_user via stages
        set_stages(j2, [{"stage_order": 1, "stage_type": "diagnosis", "assigned_technician_id": tech_user.id}], admin_user)

        res = tech_client.get("/api/v1/repair/jobs/")
        assert res.status_code == status.HTTP_200_OK
        job_ids = [j["id"] for j in res.data["items"]]
        assert str(j2.id) in job_ids
        assert str(j1.id) not in job_ids


# ──────────────────────────────────────────────────────────────────────────────
# Soft-delete visibility
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.django_db
class TestSoftDelete:
    def test_soft_deleted_job_excluded_from_list(self, admin_client, job):
        job.soft_delete()
        res = admin_client.get("/api/v1/repair/jobs/")
        assert res.status_code == status.HTTP_200_OK
        ids = [j["id"] for j in res.data["items"]]
        assert str(job.id) not in ids


# ──────────────────────────────────────────────────────────────────────────────
# Stock deduction on close (Pattern 7)
# ──────────────────────────────────────────────────────────────────────────────


def _drive_to_closed(job, user):
    """Advance a draft job through open → in_progress → ready_for_pickup → delivered → closed."""
    from repair.services import transition_job

    transition_job(job, "open",             user, reason="test bypass", is_tenant_wide=True)
    transition_job(job, "in_progress",      user)
    transition_job(job, "ready_for_pickup", user)
    transition_job(job, "delivered",        user)
    transition_job(job, "closed",           user)
    return job


def _stock_qty(shop, variant):
    from inventory.models import InventoryStock
    return InventoryStock.objects.get(shop=shop, variant=variant).quantity_in_stock


@pytest.mark.django_db
class TestRepairStockDeduction:
    """_on_close must deduct inventory for received spare parts."""

    @pytest.fixture
    def variant(self, db, shop):
        from decimal import Decimal
        from inventory.models import Product, ProductCategory, ProductVariant
        from inventory.services import opening_stock

        cat = ProductCategory.objects.create(name="Parts")
        prod = Product.objects.create(name="Screen Assembly", sku="SCR-001", category=cat)
        v = ProductVariant.objects.create(product=prod, variant_name="Standard", selling_price=Decimal("1000"))
        return v

    def test_received_spare_part_deducted_on_close(self, shop, customer, admin_user, variant):
        from decimal import Decimal
        from inventory.services import opening_stock
        from repair.models import JobSparePartRequest
        from repair.services import create_job, transition_job

        opening_stock(shop, variant, Decimal("10"), admin_user)
        assert _stock_qty(shop, variant) == Decimal("10")

        job = create_job(
            shop, customer,
            {"device_type": "Laptop", "problem_description": "Screen broken badly.", "priority": "normal"},
            admin_user,
        )

        # Mark spare part as received (qty=3)
        JobSparePartRequest.objects.create(
            job=job,
            variant_id=variant.id,
            quantity=3,
            status=JobSparePartRequest.RequestStatus.RECEIVED,
            requested_by=admin_user,
        )

        _drive_to_closed(job, admin_user)

        assert _stock_qty(shop, variant) == Decimal("7")

    def test_only_received_parts_deducted_not_requested(self, shop, customer, admin_user, variant):
        from decimal import Decimal
        from inventory.services import opening_stock
        from repair.models import JobSparePartRequest
        from repair.services import create_job

        opening_stock(shop, variant, Decimal("10"), admin_user)

        job = create_job(
            shop, customer,
            {"device_type": "Phone", "problem_description": "Battery swollen and leaking.", "priority": "normal"},
            admin_user,
        )

        # One received (should deduct) + one still requested (must not deduct)
        JobSparePartRequest.objects.create(
            job=job, variant_id=variant.id, quantity=2,
            status=JobSparePartRequest.RequestStatus.RECEIVED,
            requested_by=admin_user,
        )
        JobSparePartRequest.objects.create(
            job=job, variant_id=variant.id, quantity=5,
            status=JobSparePartRequest.RequestStatus.REQUESTED,
            requested_by=admin_user,
        )

        _drive_to_closed(job, admin_user)

        assert _stock_qty(shop, variant) == Decimal("8")

    def test_no_spare_parts_close_leaves_stock_unchanged(self, shop, customer, admin_user, variant):
        from decimal import Decimal
        from inventory.services import opening_stock
        from repair.services import create_job

        opening_stock(shop, variant, Decimal("10"), admin_user)

        job = create_job(
            shop, customer,
            {"device_type": "Tablet", "problem_description": "Touch screen unresponsive entirely.", "priority": "low"},
            admin_user,
        )

        _drive_to_closed(job, admin_user)

        assert _stock_qty(shop, variant) == Decimal("10")

    def test_missing_variant_skips_without_crashing(self, shop, customer, admin_user):
        import uuid
        from repair.models import JobSparePartRequest
        from repair.services import create_job

        job = create_job(
            shop, customer,
            {"device_type": "Console", "problem_description": "HDMI port not working at all.", "priority": "normal"},
            admin_user,
        )

        # variant_id points to a non-existent variant
        JobSparePartRequest.objects.create(
            job=job,
            variant_id=uuid.uuid4(),
            quantity=1,
            status=JobSparePartRequest.RequestStatus.RECEIVED,
            requested_by=admin_user,
        )

        # Must not raise — missing variant logs a warning and skips
        _drive_to_closed(job, admin_user)
        job.refresh_from_db()
        assert job.status == "closed"


# ──────────────────────────────────────────────────────────────────────────────
# List / kanban query filters (Phase 2)
# ──────────────────────────────────────────────────────────────────────────────

@pytest.mark.django_db
class TestJobListFilters:
    """GET /api/v1/repair/jobs/ filter params (apply to list + kanban)."""

    def _make_job(self, shop, customer, admin_user, **kwargs):
        from repair.services import create_job
        defaults = {"device_type": "Smartphone", "problem_description": "Test.", "priority": "normal"}
        defaults.update(kwargs)
        return create_job(shop, customer, defaults, admin_user)

    def test_search_by_customer_name(self, admin_client, shop, customer, admin_user):
        self._make_job(shop, customer, admin_user)
        res = admin_client.get("/api/v1/repair/jobs/", {"search": customer.name[:4]})
        assert res.status_code == 200
        assert res.data["meta"]["count"] >= 1
        for item in res.data["items"]:
            assert customer.name[:4].lower() in item["customer_name"].lower()

    def test_search_by_job_number(self, admin_client, shop, customer, admin_user):
        job = self._make_job(shop, customer, admin_user)
        res = admin_client.get("/api/v1/repair/jobs/", {"search": job.job_number})
        assert res.status_code == 200
        assert res.data["meta"]["count"] == 1
        assert res.data["items"][0]["job_number"] == job.job_number

    def test_search_no_match_returns_empty(self, admin_client, shop, customer, admin_user):
        self._make_job(shop, customer, admin_user)
        res = admin_client.get("/api/v1/repair/jobs/", {"search": "ZZZNOMATCH999"})
        assert res.status_code == 200
        assert res.data["meta"]["count"] == 0

    def test_filter_device_type_case_insensitive(self, admin_client, shop, customer, admin_user):
        self._make_job(shop, customer, admin_user, device_type="Laptop")
        self._make_job(shop, customer, admin_user, device_type="Smartphone")
        res = admin_client.get("/api/v1/repair/jobs/", {"device_type": "laptop"})
        assert res.status_code == 200
        assert res.data["meta"]["count"] == 1
        assert res.data["items"][0]["device_type"].lower() == "laptop"

    def test_filter_payment_status(self, admin_client, shop, customer, admin_user):
        from repair.models import JobTicket
        unpaid = self._make_job(shop, customer, admin_user)
        JobTicket.objects.filter(pk=unpaid.pk).update(service_charge=500, advance_paid=0)
        partial = self._make_job(shop, customer, admin_user)
        JobTicket.objects.filter(pk=partial.pk).update(service_charge=500, advance_paid=200)
        paid = self._make_job(shop, customer, admin_user)
        JobTicket.objects.filter(pk=paid.pk).update(service_charge=500, advance_paid=500)

        r_unpaid = admin_client.get("/api/v1/repair/jobs/", {"payment_status": "unpaid"})
        assert {r["job_number"] for r in r_unpaid.data["items"]} == {unpaid.job_number}
        r_partial = admin_client.get("/api/v1/repair/jobs/", {"payment_status": "partial"})
        assert {r["job_number"] for r in r_partial.data["items"]} == {partial.job_number}
        r_paid = admin_client.get("/api/v1/repair/jobs/", {"payment_status": "paid"})
        assert paid.job_number in {r["job_number"] for r in r_paid.data["items"]}

    def test_filter_overdue_excludes_terminal(self, admin_client, shop, customer, admin_user):
        import datetime
        from repair.models import JobTicket
        yesterday = datetime.date.today() - datetime.timedelta(days=1)
        od = self._make_job(shop, customer, admin_user)
        JobTicket.objects.filter(pk=od.pk).update(status="open", expected_delivery_date=yesterday)
        done = self._make_job(shop, customer, admin_user)
        JobTicket.objects.filter(pk=done.pk).update(status="delivered", expected_delivery_date=yesterday)

        res = admin_client.get("/api/v1/repair/jobs/", {"overdue": "true"})
        assert res.status_code == 200
        nums = {r["job_number"] for r in res.data["items"]}
        assert od.job_number in nums
        assert done.job_number not in nums

    def test_filter_due_on(self, admin_client, shop, customer, admin_user):
        import datetime
        from repair.models import JobTicket
        today = datetime.date.today()
        due = self._make_job(shop, customer, admin_user)
        JobTicket.objects.filter(pk=due.pk).update(status="open", expected_delivery_date=today)
        other = self._make_job(shop, customer, admin_user)
        JobTicket.objects.filter(pk=other.pk).update(
            status="open", expected_delivery_date=today + datetime.timedelta(days=3)
        )
        res = admin_client.get("/api/v1/repair/jobs/", {"due_on": today.isoformat()})
        assert res.status_code == 200
        assert {r["job_number"] for r in res.data["items"]} == {due.job_number}

    def test_payment_status_zero_charge_not_unpaid(self, admin_client, shop, customer, admin_user):
        from repair.models import JobTicket
        zero = self._make_job(shop, customer, admin_user)
        JobTicket.objects.filter(pk=zero.pk).update(service_charge=0, advance_paid=0)
        res = admin_client.get("/api/v1/repair/jobs/", {"payment_status": "unpaid"})
        assert res.status_code == 200
        assert zero.job_number not in {r["job_number"] for r in res.data["items"]}
        # A zero-charge job has balance 0 → counts as paid, not unpaid
        res_paid = admin_client.get("/api/v1/repair/jobs/", {"payment_status": "paid"})
        assert zero.job_number in {r["job_number"] for r in res_paid.data["items"]}

    def test_payment_status_invalid_value_ignored(self, admin_client, shop, customer, admin_user):
        self._make_job(shop, customer, admin_user)
        res = admin_client.get("/api/v1/repair/jobs/", {"payment_status": "bogus"})
        assert res.status_code == 200
        # Unknown value is ignored → all jobs returned, not an empty set
        assert res.data["meta"]["count"] >= 1

    def test_device_type_blank_ignored(self, admin_client, shop, customer, admin_user):
        self._make_job(shop, customer, admin_user, device_type="Laptop")
        res = admin_client.get("/api/v1/repair/jobs/", {"device_type": "   "})
        assert res.status_code == 200
        # Whitespace-only device_type is stripped to empty → filter not applied
        assert res.data["meta"]["count"] >= 1
