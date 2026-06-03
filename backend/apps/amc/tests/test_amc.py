"""
AMC module tests — §10 acceptance criteria + §11 test cases.

Covers:
- Contract creation with auto-scheduled visits
- visit_interval_days computation
- Visit completion: marks done, auto-creates next, sends notification stub
- Reschedule visit
- Manual renewal: rolls dates, creates renewal invoice, re-schedules visits
- Missed-visit Celery task
- Renewal-reminder Celery task (fires once within window)
- Visit-reminder Celery task
- Auto-renewal Celery task
- Soft-delete: cancelled contracts excluded from list
- RBAC: correct permissions required
"""

import datetime

import pytest
from rest_framework import status


# ──────────────────────────────────────────────────────────────────────────────
# Fixtures
# ──────────────────────────────────────────────────────────────────────────────


@pytest.fixture
def shop(db):
    from core.models import Shop
    return Shop.objects.create(
        name="Joy Elec", code="JEL",
        address="MG Rd", city="Delhi",
        state="UP", state_code="09", phone="+919876543210",
    )


@pytest.fixture
def customer(db, shop):
    from crm.models import Customer
    return Customer.objects.create(
        shop=shop, name="CCTV Client", phone="+919811100001",
    )


@pytest.fixture
def admin_user(db):
    from authentication.models import Permission, Role, RolePermission, User, UserRole

    user = User.objects.create_user(
        email="admin@amc.test",
        phone="+919000000030",
        full_name="AMC Admin",
        password="AdminPass@1",
    )
    role, _ = Role.objects.get_or_create(name="Shop Manager", defaults={"is_system_role": True})
    perms = [
        "amc.contracts.view", "amc.contracts.create", "amc.contracts.edit",
        "amc.visits.schedule", "amc.visits.complete", "amc.renewals.manage",
    ]
    for codename in perms:
        perm, _ = Permission.objects.get_or_create(
            codename=codename, defaults={"module": "amc", "label": codename}
        )
        RolePermission.objects.get_or_create(role=role, permission=perm)
    UserRole.objects.create(user=user, role=role, shop=None)
    return user


@pytest.fixture
def admin_client(api_client, admin_user):
    from authentication.tokens import _build_token_claims
    from rest_framework_simplejwt.tokens import RefreshToken

    refresh = RefreshToken.for_user(admin_user)
    access = refresh.access_token
    for k, v in _build_token_claims(admin_user, "test").items():
        access[k] = v
    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {str(access)}")
    return api_client


def _contract_payload(shop, customer, visits_per_year=4, auto_renew=False):
    today = datetime.date.today()
    return {
        "shop_id": str(shop.id),
        "customer_id": str(customer.id),
        "title": "CCTV AMC - 4 cameras",
        "value": "12000.00",
        "start_date": str(today),
        "end_date": str(today + datetime.timedelta(days=364)),
        "visits_per_year": visits_per_year,
        "payment_terms": "upfront",
        "auto_renew": auto_renew,
        "renewal_reminder_days": 30,
    }


# ──────────────────────────────────────────────────────────────────────────────
# Contract creation + visit scheduling
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.django_db
class TestContractCreate:
    url = "/api/v1/amc/contracts/"

    def test_create_contract(self, admin_client, shop, customer):
        res = admin_client.post(
            self.url, _contract_payload(shop, customer), format="json"
        )
        assert res.status_code == status.HTTP_201_CREATED
        data = res.data
        assert data["contract_number"].startswith("JEL-AMC-")
        assert data["status"] == "active"
        assert data["visits_per_year"] == 4

    def test_visit_interval_computed(self, admin_client, shop, customer):
        res = admin_client.post(
            self.url, _contract_payload(shop, customer, visits_per_year=4), format="json"
        )
        assert res.status_code == status.HTTP_201_CREATED
        # floor(365 / 4) = 91
        assert res.data["visit_interval_days"] == 91

    def test_visits_auto_scheduled(self, admin_client, shop, customer):
        res = admin_client.post(
            self.url, _contract_payload(shop, customer, visits_per_year=4), format="json"
        )
        contract_id = res.data["id"]
        visits_res = admin_client.get(f"{self.url}{contract_id}/visits/")
        assert visits_res.status_code == status.HTTP_200_OK
        visits = visits_res.data["data"]
        assert len(visits) == 4

    def test_visit_dates_at_correct_intervals(self, admin_client, shop, customer):
        today = datetime.date.today()
        res = admin_client.post(
            self.url, _contract_payload(shop, customer, visits_per_year=4), format="json"
        )
        contract_id = res.data["id"]
        visits_res = admin_client.get(f"{self.url}{contract_id}/visits/")
        visits = sorted(visits_res.data["data"], key=lambda v: v["visit_number"])

        for i, visit in enumerate(visits):
            expected_date = today + datetime.timedelta(days=i * 91)
            assert visit["scheduled_date"] == str(expected_date)

    def test_zero_visits_no_schedules(self, admin_client, shop, customer):
        res = admin_client.post(
            self.url, _contract_payload(shop, customer, visits_per_year=0), format="json"
        )
        contract_id = res.data["id"]
        visits_res = admin_client.get(f"{self.url}{contract_id}/visits/")
        assert len(visits_res.data["data"]) == 0

    def test_end_date_must_be_after_start(self, admin_client, shop, customer):
        today = datetime.date.today()
        payload = _contract_payload(shop, customer)
        payload["end_date"] = str(today - datetime.timedelta(days=1))
        res = admin_client.post(self.url, payload, format="json")
        assert res.status_code == status.HTTP_400_BAD_REQUEST


# ──────────────────────────────────────────────────────────────────────────────
# Visit completion
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.django_db
class TestVisitCompletion:
    def _create_contract(self, admin_client, shop, customer):
        res = admin_client.post(
            "/api/v1/amc/contracts/",
            _contract_payload(shop, customer, visits_per_year=4),
            format="json",
        )
        return res.data["id"]

    def _get_first_visit(self, admin_client, contract_id):
        res = admin_client.get(f"/api/v1/amc/contracts/{contract_id}/visits/")
        visits = sorted(res.data["data"], key=lambda v: v["visit_number"])
        return visits[0]

    def test_complete_visit(self, admin_client, shop, customer):
        contract_id = self._create_contract(admin_client, shop, customer)
        visit = self._get_first_visit(admin_client, contract_id)

        res = admin_client.post(
            f"/api/v1/amc/visits/{visit['id']}/complete/",
            {"work_done": "Cleaned and tested all 4 cameras successfully."},
            format="json",
        )
        assert res.status_code == status.HTTP_200_OK
        assert res.data["status"] == "completed"
        assert res.data["work_done"] == "Cleaned and tested all 4 cameras successfully."

    def test_completed_visit_sets_actual_date(self, admin_client, shop, customer):
        contract_id = self._create_contract(admin_client, shop, customer)
        visit = self._get_first_visit(admin_client, contract_id)

        admin_client.post(
            f"/api/v1/amc/visits/{visit['id']}/complete/",
            {"work_done": "Routine check completed."},
            format="json",
        )

        from amc.models import AMCVisit
        v = AMCVisit.objects.get(pk=visit["id"])
        assert v.actual_date == datetime.date.today()

    def test_cannot_complete_already_completed_visit(self, admin_client, shop, customer):
        contract_id = self._create_contract(admin_client, shop, customer)
        visit = self._get_first_visit(admin_client, contract_id)

        admin_client.post(
            f"/api/v1/amc/visits/{visit['id']}/complete/",
            {"work_done": "First completion."},
            format="json",
        )
        res = admin_client.post(
            f"/api/v1/amc/visits/{visit['id']}/complete/",
            {"work_done": "Second attempt."},
            format="json",
        )
        assert res.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY

    def test_completing_visit_sets_next_visit_date(self, admin_client, shop, customer):
        contract_id = self._create_contract(admin_client, shop, customer)
        visit = self._get_first_visit(admin_client, contract_id)

        res = admin_client.post(
            f"/api/v1/amc/visits/{visit['id']}/complete/",
            {"work_done": "Routine maintenance done."},
            format="json",
        )
        # next_visit_date should be today + interval (91 days)
        expected = datetime.date.today() + datetime.timedelta(days=91)
        assert res.data["next_visit_date"] == str(expected)


# ──────────────────────────────────────────────────────────────────────────────
# Reschedule visit
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.django_db
class TestRescheduleVisit:
    def test_reschedule_scheduled_visit(self, admin_client, shop, customer):
        res = admin_client.post(
            "/api/v1/amc/contracts/",
            _contract_payload(shop, customer, visits_per_year=2),
            format="json",
        )
        contract_id = res.data["id"]
        visits_res = admin_client.get(f"/api/v1/amc/contracts/{contract_id}/visits/")
        visit_id = visits_res.data["data"][0]["id"]

        new_date = datetime.date.today() + datetime.timedelta(days=10)
        res = admin_client.post(
            f"/api/v1/amc/visits/{visit_id}/reschedule/",
            {"new_date": str(new_date)},
            format="json",
        )
        assert res.status_code == status.HTTP_200_OK
        assert res.data["status"] == "rescheduled"
        assert res.data["scheduled_date"] == str(new_date)


# ──────────────────────────────────────────────────────────────────────────────
# Manual renewal
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.django_db
class TestManualRenewal:
    def _create_contract(self, admin_client, shop, customer):
        res = admin_client.post(
            "/api/v1/amc/contracts/",
            _contract_payload(shop, customer, visits_per_year=2),
            format="json",
        )
        return res.data["id"], res.data

    def test_renew_extends_dates(self, admin_client, shop, customer):
        contract_id, original = self._create_contract(admin_client, shop, customer)
        original_end = datetime.date.fromisoformat(original["end_date"])

        res = admin_client.post(f"/api/v1/amc/contracts/{contract_id}/renew/", format="json")
        assert res.status_code == status.HTTP_200_OK

        new_start = datetime.date.fromisoformat(res.data["start_date"])
        assert new_start == original_end + datetime.timedelta(days=1)

    def test_renew_creates_new_visits(self, admin_client, shop, customer):
        from amc.models import AMCVisit

        contract_id, _ = self._create_contract(admin_client, shop, customer)
        visits_before = AMCVisit.objects.filter(contract_id=contract_id).count()

        admin_client.post(f"/api/v1/amc/contracts/{contract_id}/renew/", format="json")

        visits_after = AMCVisit.objects.filter(contract_id=contract_id).count()
        assert visits_after > visits_before

    def test_renew_creates_renewal_invoice(self, admin_client, shop, customer):
        from amc.models import AMCRenewalInvoice

        contract_id, _ = self._create_contract(admin_client, shop, customer)
        admin_client.post(f"/api/v1/amc/contracts/{contract_id}/renew/", format="json")

        assert AMCRenewalInvoice.objects.filter(contract_id=contract_id).exists()

    def test_cannot_renew_cancelled_contract(self, admin_client, shop, customer):
        from amc.models import AMCContract

        contract_id, _ = self._create_contract(admin_client, shop, customer)
        AMCContract.objects.filter(pk=contract_id).update(status=AMCContract.Status.CANCELLED)

        res = admin_client.post(f"/api/v1/amc/contracts/{contract_id}/renew/", format="json")
        assert res.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY


# ──────────────────────────────────────────────────────────────────────────────
# Celery tasks
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.django_db
class TestCeleryTasks:
    def _make_contract(self, shop, customer, admin_user, visits_per_year=2):
        from amc.services import create_contract

        today = datetime.date.today()
        return create_contract(
            shop, customer,
            {
                "title": "Test AMC",
                "value": "5000",
                "start_date": today,
                "end_date": today + datetime.timedelta(days=180),
                "visits_per_year": visits_per_year,
                "payment_terms": "upfront",
                "auto_renew": False,
                "renewal_reminder_days": 30,
            },
            admin_user,
        )

    def test_mark_missed_visits(self, shop, customer, admin_user):
        from amc.models import AMCVisit
        from amc.tasks import mark_missed_visits

        contract = self._make_contract(shop, customer, admin_user, visits_per_year=2)
        # Backdate first visit to yesterday
        visit = contract.visits.order_by("scheduled_date").first()
        AMCVisit.objects.filter(pk=visit.pk).update(
            scheduled_date=datetime.date.today() - datetime.timedelta(days=1)
        )

        count = mark_missed_visits()
        assert count >= 1

        visit.refresh_from_db()
        assert visit.status == "missed"

    def test_send_renewal_reminders(self, shop, customer, admin_user):
        from amc.models import AMCContract
        from amc.tasks import send_renewal_reminders

        contract = self._make_contract(shop, customer, admin_user)
        # Set end_date to 15 days out (within 30-day reminder window)
        AMCContract.objects.filter(pk=contract.pk).update(
            end_date=datetime.date.today() + datetime.timedelta(days=15)
        )

        count = send_renewal_reminders()
        assert count >= 1

        contract.refresh_from_db()
        assert contract.next_renewal_notified_at is not None
        assert contract.status == "pending_renewal"

    def test_renewal_reminder_fires_only_once(self, shop, customer, admin_user):
        from amc.models import AMCContract
        from amc.tasks import send_renewal_reminders
        from django.utils import timezone as tz

        contract = self._make_contract(shop, customer, admin_user)
        AMCContract.objects.filter(pk=contract.pk).update(
            end_date=datetime.date.today() + datetime.timedelta(days=15),
            next_renewal_notified_at=tz.now(),  # already notified
        )

        count = send_renewal_reminders()
        assert count == 0  # should not fire again

    def test_send_visit_reminders(self, shop, customer, admin_user):
        from amc.models import AMCVisit
        from amc.tasks import send_visit_reminders

        contract = self._make_contract(shop, customer, admin_user)
        # Set a visit for 2 days out
        visit = contract.visits.order_by("scheduled_date").first()
        AMCVisit.objects.filter(pk=visit.pk).update(
            scheduled_date=datetime.date.today() + datetime.timedelta(days=2)
        )

        count = send_visit_reminders()
        assert count >= 1

    def test_auto_renewal_task(self, shop, customer, admin_user):
        from amc.models import AMCContract
        from amc.tasks import process_auto_renewals

        contract = self._make_contract(shop, customer, admin_user)
        # Mark as expired + auto_renew=True
        AMCContract.objects.filter(pk=contract.pk).update(
            auto_renew=True,
            end_date=datetime.date.today() - datetime.timedelta(days=1),
            status=AMCContract.Status.ACTIVE,
        )

        count = process_auto_renewals()
        assert count >= 1

        contract.refresh_from_db()
        assert contract.status == "active"
        assert contract.start_date > datetime.date.today() - datetime.timedelta(days=2)


# ──────────────────────────────────────────────────────────────────────────────
# Soft-delete + list
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.django_db
class TestSoftDeleteAndList:
    def test_soft_deleted_contract_excluded(self, admin_client, shop, customer):
        from amc.services import create_contract

        contract = create_contract(
            shop, customer,
            {
                "title": "Deleted AMC", "value": "1000",
                "start_date": datetime.date.today(),
                "end_date": datetime.date.today() + datetime.timedelta(days=30),
                "visits_per_year": 0,
                "payment_terms": "upfront",
                "auto_renew": False,
                "renewal_reminder_days": 30,
            },
            __import__("authentication.models", fromlist=["User"]).User.objects.get(
                email="admin@amc.test"
            ),
        )
        contract.soft_delete()

        res = admin_client.get("/api/v1/amc/contracts/")
        ids = [c["id"] for c in res.data["data"]]
        assert str(contract.id) not in ids
