"""
CRM — Customer tests.
Covers: create, duplicate phone, merge, timeline, tasks, segments.
"""

import pytest
from rest_framework import status


@pytest.fixture
def shop(db):
    from core.models import Shop
    return Shop.objects.create(
        name="Joy Computer",
        code="JOY2",
        address="MG Road",
        city="Delhi",
        state="Uttar Pradesh",
        state_code="09",
        phone="+919876543210",
    )


@pytest.fixture
def tenant_admin(db):
    from authentication.models import Permission, Role, RolePermission, User, UserRole

    user = User.objects.create_user(
        email="admin2@joy.com",
        phone="+919000000002",
        full_name="Admin 2",
        password="AdminPass@2",
    )
    role, _ = Role.objects.get_or_create(name="Tenant Admin", defaults={"is_system_role": True})
    perms = [
        "crm.leads.view", "crm.leads.create", "crm.leads.edit", "crm.leads.convert",
        "crm.customers.view", "crm.customers.create", "crm.customers.edit",
        "crm.customers.merge", "crm.communications.log",
        "crm.tasks.manage", "crm.segments.manage",
    ]
    for codename in perms:
        perm, _ = Permission.objects.get_or_create(
            codename=codename, defaults={"module": "crm", "label": codename}
        )
        RolePermission.objects.get_or_create(role=role, permission=perm)
    UserRole.objects.create(user=user, role=role, shop=None)
    return user


@pytest.fixture
def admin_client(api_client, tenant_admin):
    from authentication.tokens import _build_token_claims
    from rest_framework_simplejwt.tokens import RefreshToken

    refresh = RefreshToken.for_user(tenant_admin)
    access = refresh.access_token  # property creates a new instance each call
    extra = _build_token_claims(tenant_admin, "test")
    for k, v in extra.items():
        access[k] = v
    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {str(access)}")
    return api_client


@pytest.fixture
def customer(db, shop):
    from crm.models import Customer
    return Customer.objects.create(
        shop=shop,
        name="Ravi Kumar",
        phone="+919811100001",
    )


@pytest.fixture
def customer2(db, shop):
    from crm.models import Customer
    return Customer.objects.create(
        shop=shop,
        name="Priya Sharma",
        phone="+919811100002",
        total_jobs=3,
        total_billed="5000.00",
        tags=["laptop"],
    )


# ──────────────────────────────────────────────────────────────────────────────
# Create / duplicate phone
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.django_db
class TestCustomerCreate:
    url = "/api/v1/crm/customers/"

    def test_create_customer(self, admin_client, shop):
        res = admin_client.post(self.url, {
            "shop_id": str(shop.id),
            "name": "New Customer",
            "phone": "+919900000099",
        }, format="json")
        assert res.status_code == status.HTTP_201_CREATED
        assert res.data["name"] == "New Customer"

    def test_duplicate_phone_returns_400(self, admin_client, shop, customer):
        res = admin_client.post(self.url, {
            "shop_id": str(shop.id),
            "name": "Duplicate",
            "phone": customer.phone,  # same phone
        }, format="json")
        assert res.status_code == status.HTTP_400_BAD_REQUEST
        assert res.json()["error"]["code"] == "DUPLICATE_PHONE"

    def test_list_customers(self, admin_client, customer):
        res = admin_client.get(self.url)
        assert res.status_code == status.HTTP_200_OK
        assert len(res.data["items"]) >= 1

    def test_search_by_name(self, admin_client, customer):
        res = admin_client.get(self.url + "?q=Ravi")
        assert res.status_code == status.HTTP_200_OK
        names = [c["name"] for c in res.data["items"]]
        assert any("Ravi" in n for n in names)

    def test_search_by_phone(self, admin_client, customer):
        res = admin_client.get(self.url + f"?q={customer.phone[-6:]}")
        assert res.status_code == status.HTTP_200_OK
        assert len(res.data["items"]) >= 1


# ──────────────────────────────────────────────────────────────────────────────
# Merge
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.django_db
class TestCustomerMerge:
    url = "/api/v1/crm/customers/merge/"

    def test_merge_sums_counters(self, admin_client, customer, customer2):
        res = admin_client.post(self.url, {
            "source_id": str(customer2.id),
            "target_id": str(customer.id),
        }, format="json")
        assert res.status_code == status.HTTP_200_OK

        customer.refresh_from_db()
        assert customer.total_jobs == 3  # absorbed from customer2

    def test_merge_soft_deletes_source(self, admin_client, customer, customer2):
        admin_client.post(self.url, {
            "source_id": str(customer2.id),
            "target_id": str(customer.id),
        }, format="json")

        from crm.models import Customer
        assert not Customer.objects.filter(pk=customer2.id).exists()  # filtered by default manager
        assert Customer.all_objects.filter(pk=customer2.id, deleted_at__isnull=False).exists()

    def test_merge_same_id_rejected(self, admin_client, customer):
        res = admin_client.post(self.url, {
            "source_id": str(customer.id),
            "target_id": str(customer.id),
        }, format="json")
        assert res.status_code == status.HTTP_400_BAD_REQUEST

    def test_merge_merges_tags(self, admin_client, shop):
        from crm.models import Customer
        c1 = Customer.objects.create(shop=shop, name="A", phone="+919000111001", tags=["vip"])
        c2 = Customer.objects.create(shop=shop, name="B", phone="+919000111002", tags=["laptop"])
        admin_client.post(self.url, {
            "source_id": str(c2.id),
            "target_id": str(c1.id),
        }, format="json")
        c1.refresh_from_db()
        assert "laptop" in c1.tags
        assert "vip" in c1.tags


# ──────────────────────────────────────────────────────────────────────────────
# Communication timeline
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.django_db
class TestTimeline:
    def test_timeline_returns_comms(self, admin_client, customer, tenant_admin):
        from crm.models import CommunicationLog
        from django.utils import timezone

        CommunicationLog.objects.create(
            customer=customer,
            type="call",
            direction="inbound",
            summary="Called to ask about repair status",
            logged_by=tenant_admin,
            logged_at=timezone.now(),
        )
        res = admin_client.get(f"/api/v1/crm/customers/{customer.id}/timeline/")
        assert res.status_code == status.HTTP_200_OK
        assert len(res.data["items"]) >= 1

    def test_timeline_filter_by_type(self, admin_client, customer, tenant_admin):
        from crm.models import CommunicationLog
        from django.utils import timezone

        CommunicationLog.objects.create(
            customer=customer, type="call", direction="inbound",
            summary="Call", logged_by=tenant_admin, logged_at=timezone.now(),
        )
        CommunicationLog.objects.create(
            customer=customer, type="note", summary="Note",
            logged_by=tenant_admin, logged_at=timezone.now(),
        )

        res = admin_client.get(f"/api/v1/crm/customers/{customer.id}/timeline/?type=note")
        assert res.status_code == status.HTTP_200_OK
        for item in res.data["items"]:
            assert item["type"] == "note"


# ──────────────────────────────────────────────────────────────────────────────
# Follow-up tasks
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.django_db
class TestFollowUpTasks:
    url = "/api/v1/crm/tasks/"

    def test_create_task(self, admin_client, customer, tenant_admin):
        import datetime
        res = admin_client.post(self.url, {
            "customer": str(customer.id),
            "title": "Follow up about repair",
            "due_date": str(datetime.date.today() + datetime.timedelta(days=2)),
            "priority": "normal",
            "assigned_to": str(tenant_admin.id),
        }, format="json")
        assert res.status_code == status.HTTP_201_CREATED
        assert res.data["status"] == "pending"

    def test_complete_task(self, admin_client, customer, tenant_admin):
        import datetime
        from crm.models import FollowUpTask

        task = FollowUpTask.objects.create(
            customer=customer,
            title="Call customer",
            due_date=datetime.date.today() + datetime.timedelta(days=1),
            assigned_to=tenant_admin,
        )
        res = admin_client.post(f"{self.url}{task.id}/complete/", format="json")
        assert res.status_code == status.HTTP_200_OK
        assert res.data["status"] == "completed"

    def test_cannot_set_overdue_directly(self, admin_client, customer, tenant_admin):
        import datetime
        from crm.models import FollowUpTask

        task = FollowUpTask.objects.create(
            customer=customer,
            title="Test",
            due_date=datetime.date.today() + datetime.timedelta(days=1),
            assigned_to=tenant_admin,
        )
        res = admin_client.patch(f"{self.url}{task.id}/", {"status": "overdue"}, format="json")
        assert res.status_code == status.HTTP_400_BAD_REQUEST


# ──────────────────────────────────────────────────────────────────────────────
# Segments
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.django_db
class TestSegments:
    url = "/api/v1/crm/segments/"

    def test_create_segment(self, admin_client):
        res = admin_client.post(self.url, {
            "name": "High Value",
            "filter_rules": {"min_total_billed": 10000},
            "is_dynamic": True,
        }, format="json")
        assert res.status_code == status.HTTP_201_CREATED

    def test_dynamic_segment_members(self, admin_client, shop):
        from crm.models import Customer, CustomerSegment

        Customer.objects.create(shop=shop, name="Rich", phone="+919000222001", total_billed="15000")
        Customer.objects.create(shop=shop, name="Poor", phone="+919000222002", total_billed="500")

        segment = CustomerSegment.objects.create(
            name="High Value",
            filter_rules={"min_total_billed": 10000},
            is_dynamic=True,
        )
        res = admin_client.get(f"{self.url}{segment.id}/members/")
        assert res.status_code == status.HTTP_200_OK
        # Only the rich customer should be in the segment
        names = [c["name"] for c in res.data["items"]]
        assert "Rich" in names
        assert "Poor" not in names

    def test_recipient_count_excludes_optout(self, admin_client, shop):
        from crm.models import Customer, CustomerSegment

        Customer.objects.create(shop=shop, name="In", phone="+919000223001", total_billed="20000")
        Customer.objects.create(
            shop=shop, name="Out", phone="+919000223002", total_billed="20000", whatsapp_optout=True,
        )
        seg = CustomerSegment.objects.create(
            name="HV", filter_rules={"min_total_billed": 10000}, is_dynamic=True,
        )
        res = admin_client.get(f"{self.url}{seg.id}/recipient-count/")
        assert res.status_code == status.HTTP_200_OK
        assert res.data == {"total": 2, "recipients": 1, "excluded_optout": 1}


# ──────────────────────────────────────────────────────────────────────────────
# Tenant isolation
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.django_db
class TestIsolation:
    def test_soft_deleted_customer_not_in_list(self, admin_client, customer):
        customer.soft_delete()
        res = admin_client.get("/api/v1/crm/customers/")
        assert res.status_code == status.HTTP_200_OK
        ids = [c["id"] for c in res.data["items"]]
        assert str(customer.id) not in ids

    def test_soft_deleted_customer_returns_404(self, admin_client, customer):
        customer.soft_delete()
        res = admin_client.get(f"/api/v1/crm/customers/{customer.id}/")
        assert res.status_code == status.HTTP_404_NOT_FOUND

    def test_comm_log_requires_customer_or_lead(self, admin_client, tenant_admin):
        from django.utils import timezone
        res = admin_client.post("/api/v1/crm/communications/", {
            "type": "note",
            "summary": "Note without target",
            "logged_at": timezone.now().isoformat(),
        }, format="json")
        assert res.status_code == status.HTTP_400_BAD_REQUEST
