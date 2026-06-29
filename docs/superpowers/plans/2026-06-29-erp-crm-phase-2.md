# ERP/CRM Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Global Search (⌘K) and the Notification Center from the approved Phase-2 spec — an 8-entity permission-gated search aggregator + a per-user in-app notification system with 5 producers — filling the Phase-0 header shells.

**Architecture:** Both live in the `core` app. New `core.Notification` model (tenant DB). New endpoints under `/api/v1/search/` and `/api/v1/notifications/` via dedicated url/view modules (mirroring the existing `settings_urls.py`/`settings_views.py` split). Search/notification logic in a new `apps/core/services.py`. Frontend fills the existing `CommandPalette` and bell shells; a new `NotificationBell.tsx` keeps `AppShell.tsx` from growing. Polling for delivery (no WebSocket this pass), no new dependency.

**Tech Stack:** Django 4.2 + DRF, Celery (beat), pytest; Next.js 14 App Router + TS strict, React Query, Tailwind, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-29-erp-crm-phase-2-design.md`

---

## Reference patterns (read before starting)

- Thin APIView + `require_permission` + JWT scoping: `backend/apps/billing/views.py:33-90`.
- JWT claim reads (`permissions`, `shop_ids`, `is_tenant_wide`): `apps/finance/views.py:36-41`, `apps/authentication/permissions.py:30-47`.
- Per-tenant scheduled task + `_set_tenant_context`: `apps/hr/tasks.py:15-40`, `apps/amc/tasks.py`.
- Beat schedule entries: `config/settings/base.py` (`CELERY_BEAT_SCHEDULE`, ~line 215-265).
- Test JWT factory + response envelope `{success, data}`: see `client_with_perms` below (used in Phase 1 `apps/billing/tests/test_outstanding.py`).
- Existing url-module mounting: `config/urls.py` (e.g. `path("api/v1/", include("core.settings_urls"))`).
- DropdownMenu usage + ⌘K handler + palette mount: `frontend/src/components/shared/AppShell.tsx:337-511`.
- React Query list page + client: `frontend/src/lib/api/finance.ts`, `frontend/src/lib/query/keys.ts`.

**Shared backend test fixture** (paste into each new backend test module that needs auth):

```python
import uuid
import pytest

@pytest.fixture
def client_with_perms(db):
    """APIClient whose JWT carries the given permissions + shop scope.
    Non-empty permissions claim is trusted; empty claim falls back to DB (fresh user → 403)."""
    from authentication.models import User
    from rest_framework.test import APIClient
    from rest_framework_simplejwt.tokens import RefreshToken

    def _make(perms, shop_ids=None):
        suffix = uuid.uuid4().hex[:8]
        user = User.objects.create_user(
            email=f"u{suffix}@t.com", phone=f"+9190{uuid.uuid4().int % 100000000:08d}",
            full_name="Tester", password="Pass@123",
        )
        refresh = RefreshToken.for_user(user)
        access = refresh.access_token
        access["permissions"] = perms
        if shop_ids is not None:
            access["shop_ids"] = [str(s) for s in shop_ids]
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {str(access)}")
        return client, user

    return _make
```

> All API responses are wrapped by the project renderer as `{"success": true, "data": ...}`.
> Backend tests read `resp.json()["data"]`.

**Build order:** Task 1 → 2 → 3 → 4 → 5 (Notifications), Task 6 → 7 (Search backend/FE), Task 8 (bell FE), Task 9 (verification). Each task ends in a commit.

---

## Task 1: `core.Notification` model

**Files:**
- Modify: `backend/apps/core/models.py`
- Create: `backend/apps/core/migrations/000N_notification.py` (auto-numbered)
- Test: `backend/apps/core/tests/test_notification_model.py`

- [ ] **Step 1: Write the failing test**

Create `backend/apps/core/tests/test_notification_model.py`:

```python
import pytest


@pytest.mark.django_db
def test_notification_defaults_unread():
    from authentication.models import User
    from core.models import Notification
    u = User.objects.create_user(email="n@t.com", phone="+919800000123", full_name="N", password="p")
    n = Notification.objects.create(recipient=u, type="new_lead", title="New lead", route="/leads/x")
    assert n.read_at is None
    assert n.body == ""
    assert str(n)  # __str__ does not raise
```

- [ ] **Step 2: Run it — expect failure**

Run (from `backend/`): `python -m pytest apps/core/tests/test_notification_model.py -p no:cacheprovider -o addopts="" -q`
Expected: FAIL — `ImportError: cannot import name 'Notification'`.

- [ ] **Step 3: Add the model**

Append to `backend/apps/core/models.py` (it already imports `models`, `settings`/`BaseModel`; confirm `BaseModel` is imported — `NotificationLog` uses it):

```python
class Notification(BaseModel):
    """Per-user in-app notification (distinct from the outbound NotificationLog)."""

    recipient = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="notifications"
    )
    type = models.CharField(max_length=40)
    title = models.CharField(max_length=200)
    body = models.TextField(blank=True, default="")
    route = models.CharField(max_length=300, blank=True, default="")
    read_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        app_label = "core"
        db_table = "notifications"
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["recipient", "read_at"])]

    def __str__(self) -> str:
        return f"{self.type} → {self.recipient_id} ({'read' if self.read_at else 'unread'})"
```

> If `core/models.py` does not already `from django.conf import settings`, add it. Confirm
> `BaseModel` provides `id`/`created_at`/`updated_at` (it does — used by `NotificationLog`).

- [ ] **Step 4: Make the migration**

Run (from `backend/`): `python manage.py makemigrations core`
Expected: creates `apps/core/migrations/000N_notification.py` with `CreateModel`. No data step needed.

- [ ] **Step 5: Run the test — expect pass**

Run: `python -m pytest apps/core/tests/test_notification_model.py -p no:cacheprovider -o addopts="" -q`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/apps/core/models.py backend/apps/core/migrations/ backend/apps/core/tests/test_notification_model.py
git commit -m "feat(core): Notification model (in-app per-user feed)"
```

---

## Task 2: Notification API (list / unread-count / read / read-all)

**Files:**
- Create: `backend/apps/core/serializers.py` (if absent) or modify
- Create: `backend/apps/core/notification_views.py`
- Create: `backend/apps/core/notification_urls.py`
- Modify: `backend/config/urls.py`
- Test: `backend/apps/core/tests/test_notification_api.py`

- [ ] **Step 1: Write the failing test**

Create `backend/apps/core/tests/test_notification_api.py` (include the `client_with_perms` fixture from the Reference section), plus:

```python
import pytest
from rest_framework import status


def _notif(user, **kw):
    from core.models import Notification
    defaults = dict(type="new_lead", title="T", route="/x")
    defaults.update(kw)
    return Notification.objects.create(recipient=user, **defaults)


@pytest.mark.django_db
def test_list_unread_count_and_mark(client_with_perms):
    client, user = client_with_perms([])  # notifications need no special permission
    a = _notif(user, title="A")
    _notif(user, title="B")

    # unread count
    resp = client.get("/api/v1/notifications/unread-count/")
    assert resp.status_code == status.HTTP_200_OK
    assert resp.json()["data"]["count"] == 2

    # list
    resp = client.get("/api/v1/notifications/")
    assert resp.status_code == status.HTTP_200_OK

    # mark one read
    resp = client.post(f"/api/v1/notifications/{a.id}/read/")
    assert resp.status_code == status.HTTP_200_OK
    resp = client.get("/api/v1/notifications/unread-count/")
    assert resp.json()["data"]["count"] == 1

    # read-all
    resp = client.post("/api/v1/notifications/read-all/")
    assert resp.status_code == status.HTTP_200_OK
    assert client.get("/api/v1/notifications/unread-count/").json()["data"]["count"] == 0


@pytest.mark.django_db
def test_cannot_touch_other_users_notification(client_with_perms):
    from authentication.models import User
    other = User.objects.create_user(email="o@t.com", phone="+919800000999", full_name="O", password="p")
    n = _notif(other, title="theirs")
    client, _ = client_with_perms([])
    assert client.post(f"/api/v1/notifications/{n.id}/read/").status_code == status.HTTP_404_NOT_FOUND
```

- [ ] **Step 2: Run it — expect failure (404 / no route)**

Run: `python -m pytest apps/core/tests/test_notification_api.py -p no:cacheprovider -o addopts="" -q`
Expected: FAIL.

- [ ] **Step 3: Add the serializer**

Append to `backend/apps/core/serializers.py` (create the file with `from rest_framework import serializers` + `from .models import Notification` if it does not exist):

```python
class NotificationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Notification
        fields = ["id", "type", "title", "body", "route", "read_at", "created_at"]
```

- [ ] **Step 4: Add the views**

Create `backend/apps/core/notification_views.py`:

```python
from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from core.pagination import RepairOSPageNumberPagination

from .models import Notification
from .serializers import NotificationSerializer


class NotificationListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request: Request) -> Response:
        qs = Notification.objects.filter(recipient=request.user)
        if request.query_params.get("unread", "").lower() == "true":
            qs = qs.filter(read_at__isnull=True)
        paginator = RepairOSPageNumberPagination()
        page = paginator.paginate_queryset(qs, request)
        return paginator.get_paginated_response(NotificationSerializer(page, many=True).data)


class UnreadCountView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request: Request) -> Response:
        count = Notification.objects.filter(recipient=request.user, read_at__isnull=True).count()
        return Response({"count": count})


class MarkReadView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request: Request, notification_id) -> Response:
        from django.shortcuts import get_object_or_404
        n = get_object_or_404(Notification, id=notification_id, recipient=request.user)
        if n.read_at is None:
            n.read_at = timezone.now()
            n.save(update_fields=["read_at", "updated_at"])
        return Response(NotificationSerializer(n).data)


class MarkAllReadView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request: Request) -> Response:
        Notification.objects.filter(recipient=request.user, read_at__isnull=True).update(
            read_at=timezone.now()
        )
        return Response({"ok": True})
```

> Confirm `RepairOSPageNumberPagination` exists in `core.pagination` (it does — used by billing).

- [ ] **Step 5: Add the urls + mount**

Create `backend/apps/core/notification_urls.py`:

```python
from django.urls import path

from . import notification_views as views

urlpatterns = [
    path("", views.NotificationListView.as_view(), name="notifications"),
    path("unread-count/", views.UnreadCountView.as_view(), name="notifications-unread-count"),
    path("read-all/", views.MarkAllReadView.as_view(), name="notifications-read-all"),
    path("<uuid:notification_id>/read/", views.MarkReadView.as_view(), name="notification-read"),
]
```

In `backend/config/urls.py`, add alongside the other `core.*` includes:

```python
    path("api/v1/notifications/", include("core.notification_urls")),
```

- [ ] **Step 6: Run the tests — expect pass**

Run: `python -m pytest apps/core/tests/test_notification_api.py -p no:cacheprovider -o addopts="" -q`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add backend/apps/core/serializers.py backend/apps/core/notification_views.py backend/apps/core/notification_urls.py backend/config/urls.py backend/apps/core/tests/test_notification_api.py
git commit -m "feat(core): notification API (list, unread-count, read, read-all)"
```

---

## Task 3: Producer infrastructure (`core/services.py`)

**Files:**
- Create: `backend/apps/core/services.py`
- Test: `backend/apps/core/tests/test_notification_producers.py`

- [ ] **Step 1: Write the failing test**

Create `backend/apps/core/tests/test_notification_producers.py`:

```python
import pytest


@pytest.fixture
def shop(db):
    from core.models import Shop
    return Shop.objects.create(name="S", code="HTA", address="a", city="Delhi",
                               state="Delhi", state_code="07", phone="+919876543210")


def _user_with_perm(codename, shop):
    from authentication.models import Permission, Role, RolePermission, User, UserRole
    import uuid
    u = User.objects.create_user(email=f"{uuid.uuid4().hex[:6]}@t.com",
                                 phone=f"+9190{uuid.uuid4().int % 100000000:08d}",
                                 full_name="U", password="p")
    role = Role.objects.create(name=f"R-{uuid.uuid4().hex[:4]}", is_system_role=False)
    perm, _ = Permission.objects.get_or_create(codename=codename, defaults={"label": codename})
    RolePermission.objects.create(role=role, permission=perm)
    UserRole.objects.create(user=u, role=role, shop=shop)
    return u


@pytest.mark.django_db
def test_users_with_permission_scopes_by_shop(shop):
    from core.services import users_with_permission
    u = _user_with_perm("erp.inventory.view", shop)
    found = list(users_with_permission("erp.inventory.view", [shop.id]))
    assert u in found


@pytest.mark.django_db
def test_record_notifications_excludes_actor_and_dedups(shop):
    from authentication.models import User
    from core.models import Notification
    from core.services import record_notifications, notify_dedup
    actor = _user_with_perm("erp.inventory.view", shop)
    target = _user_with_perm("erp.inventory.view", shop)

    record_notifications([actor, target], type="low_stock", title="Low", body="", route="/inventory", exclude=actor)
    assert Notification.objects.filter(recipient=target).count() == 1
    assert Notification.objects.filter(recipient=actor).count() == 0

    # dedup: an unread low_stock for /inventory already exists for target
    assert notify_dedup(target, "low_stock", "/inventory") is True
```

- [ ] **Step 2: Run it — expect failure**

Run: `python -m pytest apps/core/tests/test_notification_producers.py -p no:cacheprovider -o addopts="" -q`
Expected: FAIL — `ModuleNotFoundError`/`ImportError` (no `core.services`).

- [ ] **Step 3: Implement the helpers**

Create `backend/apps/core/services.py`:

```python
"""Core cross-module services: in-app notification producers + global search."""

from .models import Notification


def users_with_permission(codename, shop_ids=None):
    """Distinct users holding `codename` (optionally scoped to shops via their UserRole)."""
    from authentication.models import User

    qs = User.objects.filter(
        user_roles__role__role_permissions__permission__codename=codename
    )
    if shop_ids is not None:
        qs = qs.filter(user_roles__shop_id__in=shop_ids)
    return qs.distinct()


def record_notifications(users, *, type, title, body="", route="", exclude=None):
    """Bulk-create one Notification per distinct user, skipping `exclude` (the actor)."""
    exclude_id = getattr(exclude, "id", None)
    seen = set()
    rows = []
    for u in users:
        if u is None or u.id == exclude_id or u.id in seen:
            continue
        seen.add(u.id)
        rows.append(Notification(recipient=u, type=type, title=title, body=body, route=route))
    if rows:
        Notification.objects.bulk_create(rows)
    return len(rows)


def notify_dedup(user, type, route) -> bool:
    """True if an unread notification of the same type+route already exists for `user`."""
    return Notification.objects.filter(
        recipient=user, type=type, route=route, read_at__isnull=True
    ).exists()
```

- [ ] **Step 4: Run the tests — expect pass**

Run: `python -m pytest apps/core/tests/test_notification_producers.py -p no:cacheprovider -o addopts="" -q`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/apps/core/services.py backend/apps/core/tests/test_notification_producers.py
git commit -m "feat(core): notification producer helpers (resolver, recorder, dedup)"
```

---

## Task 4: In-request producers (job status, new lead, payment)

**Files:**
- Modify: `backend/apps/repair/services.py` (`transition_job`)
- Modify: `backend/apps/billing/services.py` (`record_payment`)
- Modify: the Lead create view (confirm class) in `backend/apps/crm/views.py`
- Test: `backend/apps/core/tests/test_inrequest_producers.py`

- [ ] **Step 1: Write the failing test**

Create `backend/apps/core/tests/test_inrequest_producers.py` covering the job-status producer (the most self-contained). Build a shop, two users (tech + creator), a job assigned to tech and created by creator, then transition status as a third actor and assert both get a notification and the actor does not:

```python
import pytest
from decimal import Decimal


@pytest.fixture
def shop(db):
    from core.models import Shop
    return Shop.objects.create(name="S", code="HTA", address="a", city="Delhi",
                               state="Delhi", state_code="07", phone="+919876543210")


def _user(email):
    from authentication.models import User
    import uuid
    return User.objects.create_user(email=email, phone=f"+9190{uuid.uuid4().int % 100000000:08d}",
                                    full_name="U", password="p")


@pytest.mark.django_db
def test_job_status_change_notifies_tech_and_creator_not_actor(shop):
    from repair.models import JobTicket
    from repair.services import transition_job
    from core.models import Notification
    from crm.models import Customer

    tech = _user("tech@t.com")
    creator = _user("creator@t.com")
    actor = _user("actor@t.com")
    cust = Customer.objects.create(shop=shop, name="C", phone="+919811111111")
    job = JobTicket.objects.create(
        shop=shop, customer=cust, created_by=creator, assigned_technician=tech,
        job_number="HTA-1", device_type="Laptop", device_brand="Dell", device_model="X",
        problem_description="p", service_charge=Decimal("100"),
        status=JobTicket.Status.OPEN,
    )
    # pick any valid transition from OPEN per VALID_TRANSITIONS
    transition_job(job, JobTicket.Status.IN_PROGRESS, actor)

    recipients = set(Notification.objects.filter(type="job_status").values_list("recipient_id", flat=True))
    assert tech.id in recipients
    assert creator.id in recipients
    assert actor.id not in recipients
```

> **Plan-time confirmation:** the exact valid transition from `OPEN` (read `VALID_TRANSITIONS` in
> `apps/repair/services.py`). Use a legal target so `transition_job` does not raise.

- [ ] **Step 2: Run it — expect failure**

Run: `python -m pytest apps/core/tests/test_inrequest_producers.py -p no:cacheprovider -o addopts="" -q`
Expected: FAIL — no `job_status` notifications created.

- [ ] **Step 3: Hook the job-status producer**

In `backend/apps/repair/services.py`, inside `transition_job`, after `job.save(...)` and the existing
audit/broadcast calls (around `apps/repair/services.py:143-185`), add:

```python
    from core.services import record_notifications
    record_notifications(
        [job.assigned_technician, job.created_by],
        type="job_status",
        title=f"Job {job.job_number} → {job.get_status_display()}",
        body=reason or "",
        route=f"/jobs/{job.id}",
        exclude=user,
    )
```

> `assigned_technician`/`created_by` are User FKs nullable — `record_notifications` already skips
> `None`. Import inside the function to avoid any import cycle between `repair` and `core`.

- [ ] **Step 4: Hook the payment producer**

In `backend/apps/billing/services.py`, inside `record_payment(invoice, data, user)` (around
`apps/billing/services.py:221`), after the payment is created and totals updated, add:

```python
    from core.services import record_notifications
    job = getattr(invoice, "job", None)
    record_notifications(
        [getattr(job, "assigned_technician", None), getattr(job, "created_by", None)],
        type="payment_received",
        title=f"Payment ₹{payment.amount} received",
        body=f"Invoice {invoice.invoice_number}",
        route=f"/invoices/{invoice.id}",
        exclude=user,
    )
```

> Use the variable name the function assigns to the created `Payment` (confirm — likely `payment`).

- [ ] **Step 5: Hook the new-lead producer**

Identify the Lead create view in `backend/apps/crm/views.py` (the ViewSet whose `perform_create`
creates a `Lead`; confirm which of the `perform_create` methods at ~lines 379/465 is the Lead one).
In its `perform_create`, after `lead = serializer.save(...)`, add:

```python
        from core.services import record_notifications, users_with_permission
        recipients = (
            [lead.assigned_to] if lead.assigned_to_id
            else list(users_with_permission("crm.leads.view", [lead.shop_id]))
        )
        record_notifications(
            recipients, type="new_lead",
            title=f"New lead: {lead.name}", body=lead.phone or "",
            route=f"/leads/{lead.id}", exclude=self.request.user,
        )
```

> Confirm `Lead` field names: `assigned_to`, `shop_id`, `name`, `phone` (verified to exist in
> `apps/crm/models.py`). Keep the producer in the view's `perform_create`; CRM uses ViewSets, not
> the thin-APIView+services pattern.

- [ ] **Step 6: Run tests + the relevant app suites**

Run (from `backend/`):
```bash
python -m pytest apps/core/tests/test_inrequest_producers.py apps/repair apps/billing apps/crm -p no:cacheprovider -o addopts="" -q
```
Expected: new test PASS; no regressions in repair/billing/crm.

- [ ] **Step 7: Commit**

```bash
git add backend/apps/repair/services.py backend/apps/billing/services.py backend/apps/crm/views.py backend/apps/core/tests/test_inrequest_producers.py
git commit -m "feat(notifications): in-request producers (job status, new lead, payment received)"
```

---

## Task 5: Scheduled producers (low-stock, AMC-renewal-due)

**Files:**
- Modify: `backend/apps/core/tasks.py` (add `scan_low_stock`, `scan_amc_renewals`)
- Modify: `backend/config/settings/base.py` (`CELERY_BEAT_SCHEDULE`)
- Test: `backend/apps/core/tests/test_scheduled_producers.py`

- [ ] **Step 1: Write the failing test**

Create `backend/apps/core/tests/test_scheduled_producers.py`. Test the producer *logic* directly
(call a plain function, not the Celery task wrapper, to avoid beat/tenant machinery). Build a shop,
a user with `erp.inventory.view` in that shop, an `InventoryStock` row at/below `reorder_level`, then
call the low-stock scan for that shop and assert a `low_stock` notification exists and is idempotent
on a second call:

```python
import pytest
from decimal import Decimal


@pytest.fixture
def shop(db):
    from core.models import Shop
    return Shop.objects.create(name="S", code="HTA", address="a", city="Delhi",
                               state="Delhi", state_code="07", phone="+919876543210")


def _mgr(codename, shop):
    from authentication.models import Permission, Role, RolePermission, User, UserRole
    import uuid
    u = User.objects.create_user(email=f"{uuid.uuid4().hex[:6]}@t.com",
                                 phone=f"+9190{uuid.uuid4().int % 100000000:08d}", full_name="M", password="p")
    role = Role.objects.create(name=f"R-{uuid.uuid4().hex[:4]}")
    perm, _ = Permission.objects.get_or_create(codename=codename, defaults={"label": codename})
    RolePermission.objects.create(role=role, permission=perm)
    UserRole.objects.create(user=u, role=role, shop=shop)
    return u


@pytest.mark.django_db
def test_low_stock_scan_notifies_managers_idempotently(shop):
    from core.tasks import _scan_low_stock_for_db
    from core.models import Notification
    # Build a low stock row (quantity <= reorder_level) — see plan note for the exact chain.
    # ... create Product → ProductVariant → InventoryStock(shop, quantity_in_stock=0, reorder_level=5) ...
    mgr = _mgr("erp.inventory.view", shop)

    _scan_low_stock_for_db()
    _scan_low_stock_for_db()  # second run must not duplicate
    assert Notification.objects.filter(recipient=mgr, type="low_stock").count() == 1
```

> **Plan-time confirmation:** the `Product → ProductVariant → InventoryStock` creation chain and
> required fields (read `apps/inventory/models.py:40-110`). `InventoryStock` has `shop`,
> `quantity_in_stock`, `reorder_level`, `variant`. Fill the helper accordingly.

- [ ] **Step 2: Run it — expect failure**

Run: `python -m pytest apps/core/tests/test_scheduled_producers.py -p no:cacheprovider -o addopts="" -q`
Expected: FAIL — `ImportError` (`_scan_low_stock_for_db`).

- [ ] **Step 3: Implement the per-DB scan functions + Celery tasks**

In `backend/apps/core/tasks.py`, add plain functions that operate on the current tenant DB, plus
thin Celery wrappers that iterate tenants (mirror `apps/hr/tasks.py` `_set_tenant_context` + the
tenant loop used by `amc` tasks):

```python
def _scan_low_stock_for_db():
    """Create low_stock notifications for managers of shops with stock at/below reorder level."""
    from inventory.models import InventoryStock
    from core.services import record_notifications, users_with_permission, notify_dedup

    low = (
        InventoryStock.objects.select_related("shop", "variant__product")
        .filter(quantity_in_stock__lte=models.F("reorder_level"))
    )
    by_shop: dict = {}
    for s in low:
        by_shop.setdefault(s.shop_id, []).append(s)
    for shop_id, rows in by_shop.items():
        managers = users_with_permission("erp.inventory.view", [shop_id])
        for u in managers:
            if notify_dedup(u, "low_stock", "/inventory"):
                continue
            record_notifications(
                [u], type="low_stock",
                title=f"{len(rows)} item(s) low on stock",
                body="", route="/inventory",
            )


def _scan_amc_renewals_for_db():
    """Create amc_renewal_due notifications for contracts within their reminder window."""
    from datetime import timedelta
    from django.utils import timezone
    from amc.models import AMCContract
    from core.services import record_notifications, users_with_permission, notify_dedup

    today = timezone.now().date()
    due = AMCContract.objects.select_related("shop").exclude(
        status=AMCContract.Status.CANCELLED
    ).filter(end_date__lte=today + timedelta(days=30))  # window: see plan note
    for c in due:
        route = f"/amc/{c.id}"
        for u in users_with_permission("amc.contracts.view", [c.shop_id]):
            if notify_dedup(u, "amc_renewal_due", route):
                continue
            record_notifications([u], type="amc_renewal_due",
                                 title=f"AMC renewal due: {c}", body="", route=route)
```

Add `import` of `from django.db import models` at the top of `tasks.py` if not present (for `models.F`).
Then add the Celery wrappers (mirror the existing per-tenant pattern in this file / `amc/tasks.py`):

```python
@shared_task(name="core.scan_low_stock", bind=True, ignore_result=True)
def scan_low_stock(self):
    _run_for_all_tenants(_scan_low_stock_for_db)


@shared_task(name="core.scan_amc_renewals", bind=True, ignore_result=True)
def scan_amc_renewals(self):
    _run_for_all_tenants(_scan_amc_renewals_for_db)
```

> **Plan-time confirmation:** the exact per-tenant iteration helper. If `core/tasks.py` (or a shared
> util) already has a "run for all active tenants" loop, reuse it as `_run_for_all_tenants`; otherwise
> write one mirroring `apps/amc/tasks.py` (iterate `TenantDatabase.objects.using('default').filter(
> is_active=True)`, `set_tenant_db_alias`, call fn, `set_tenant_db_alias(None)` in a finally).
> Confirm the AMC reminder window (`renewal_reminder_days`, default 30) and use it instead of the
> hard-coded 30 if you prefer per-contract windows.

- [ ] **Step 4: Register beat schedule**

In `backend/config/settings/base.py` `CELERY_BEAT_SCHEDULE`, add two daily entries (mirror existing
crontab entries):

```python
    "core-scan-low-stock": {
        "task": "core.scan_low_stock",
        "schedule": crontab(hour=7, minute=30),
    },
    "core-scan-amc-renewals": {
        "task": "core.scan_amc_renewals",
        "schedule": crontab(hour=7, minute=45),
    },
```

- [ ] **Step 5: Run the test — expect pass**

Run: `python -m pytest apps/core/tests/test_scheduled_producers.py -p no:cacheprovider -o addopts="" -q`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/apps/core/tasks.py backend/config/settings/base.py backend/apps/core/tests/test_scheduled_producers.py
git commit -m "feat(notifications): scheduled producers (low-stock, AMC-renewal-due) + beat"
```

---

## Task 6: Global Search backend

**Files:**
- Modify: `backend/apps/core/services.py` (add `global_search`)
- Create: `backend/apps/core/search_views.py`
- Create: `backend/apps/core/search_urls.py`
- Modify: `backend/config/urls.py`
- Test: `backend/apps/core/tests/test_search.py`

- [ ] **Step 1: Write the failing test**

Create `backend/apps/core/tests/test_search.py` (include `client_with_perms`). Create a customer and
a lead in a shop; query `?q=` and assert: (a) with only `crm.customers.view`, customer appears and
lead does not; (b) `q` shorter than 2 returns empty; (c) result rows have `type/id/label/route`.

```python
import pytest
from rest_framework import status


@pytest.fixture
def shop(db):
    from core.models import Shop
    return Shop.objects.create(name="S", code="HTA", address="a", city="Delhi",
                               state="Delhi", state_code="07", phone="+919876543210")


@pytest.mark.django_db
def test_search_respects_permission_gates(shop, client_with_perms):
    from crm.models import Customer, Lead
    Customer.objects.create(shop=shop, name="Ramesh Kumar", phone="+919811111111")
    Lead.objects.create(shop=shop, name="Ramesh Traders", phone="+919822222222")

    client, _ = client_with_perms(["crm.customers.view"], shop_ids=[shop.id])
    body = client.get("/api/v1/search/?q=Ramesh").json()["data"]
    types = {r["type"] for r in body["results"]}
    assert "customer" in types
    assert "lead" not in types  # caller lacks crm.leads.view

    # short query → empty
    assert client.get("/api/v1/search/?q=R").json()["data"]["results"] == []
```

> **Plan-time confirmation:** `Lead` required fields for creation (read `apps/crm/models.py`).

- [ ] **Step 2: Run it — expect failure (404)**

Run: `python -m pytest apps/core/tests/test_search.py -p no:cacheprovider -o addopts="" -q`
Expected: FAIL.

- [ ] **Step 3: Implement `global_search`**

Append to `backend/apps/core/services.py`. Use a table of per-type specs; each entry has the
permission slug, a function returning up to 5 result dicts for a shop-scoped queryset. Implement all
8 types per the spec table. Representative entry (Customer) — implement the rest by the same shape:

```python
from django.db.models import Q

SEARCH_CAP = 5


def _shop_scope(token):
    """Return shop_ids list, or None for tenant-wide (mirrors billing/finance helpers)."""
    if token is None:
        return []
    if token.get("is_tenant_wide") or token.get("is_platform_admin"):
        return None
    return token.get("shop_ids", [])


def global_search(term, token):
    term = (term or "").strip()
    if len(term) < 2:
        return []
    perms = (token or {}).get("permissions", []) if token else []
    shop_ids = _shop_scope(token)
    results = []

    if "crm.customers.view" in perms:
        from crm.models import Customer
        qs = Customer.objects.all()
        if shop_ids is not None:
            qs = qs.filter(shop_id__in=shop_ids)
        qs = qs.filter(Q(name__icontains=term) | Q(phone__icontains=term))[:SEARCH_CAP]
        results += [{"type": "customer", "id": str(c.id), "label": c.name,
                     "sublabel": c.phone or "", "route": f"/customers/{c.id}"} for c in qs]

    # ... implement lead, job, invoice, product, technician, payment, purchase_order
    #     following the spec table (permission gate + icontains fields + label/sublabel + route),
    #     each shop-scoped where the model has a shop FK and capped at SEARCH_CAP.
    return results
```

Per-type details (gate → model → fields → label/sublabel → route):
- `lead` → `crm.leads.view` → `crm.models.Lead`, name/phone → name / phone → `/leads/{id}`
- `job` → `repair.jobs.view` → `repair.models.JobTicket`, `Q(job_number__icontains)|Q(device_brand__icontains)|Q(device_model__icontains)|Q(customer__name__icontains)`, `select_related("customer")` → job_number / f"{device_brand} {device_model}" → `/jobs/{id}`
- `invoice` → `billing.repair_invoices.view` → `billing.models.RepairInvoice`, `Q(invoice_number__icontains)|Q(customer__name__icontains)`, `select_related("customer")` → invoice_number / customer.name → `/invoices/{id}`
- `product` → `erp.products.view` → `inventory.models.Product`, name/sku → name / sku → `/products/{id}` (Product has no shop FK — do not shop-filter)
- `technician` → `hr.employees.view` → `hr.models.Employee`, `full_name`/`designation` → full_name / designation → `/hr/employees/{id}`
- `payment` → `billing.payments.record` → `billing.models.Payment`, `reference_id`/`razorpay_payment_id`, scope via `invoice__shop_id__in` → amount / method → `/payments`
- `purchase_order` → `erp.purchase_orders.create` → `procurement.models.PurchaseOrder`, `Q(po_number__icontains)|Q(supplier__name__icontains)`, `select_related("supplier")` → po_number / supplier.name → `/purchases/{id}`

> Products are tenant-global (no shop FK); skip shop scoping for product. For models without a
> `shop` FK, do not apply `shop_ids` filtering. Confirm each model's shop field before scoping.

- [ ] **Step 4: Add the view + url + mount**

Create `backend/apps/core/search_views.py`:

```python
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from . import services


class SearchView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request: Request) -> Response:
        token = getattr(request, "auth", None)
        results = services.global_search(request.query_params.get("q", ""), token)
        return Response({"results": results})
```

Create `backend/apps/core/search_urls.py`:

```python
from django.urls import path

from .search_views import SearchView

urlpatterns = [path("", SearchView.as_view(), name="search")]
```

In `backend/config/urls.py`, add:

```python
    path("api/v1/search/", include("core.search_urls")),
```

- [ ] **Step 5: Run the test — expect pass**

Run: `python -m pytest apps/core/tests/test_search.py -p no:cacheprovider -o addopts="" -q`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/apps/core/services.py backend/apps/core/search_views.py backend/apps/core/search_urls.py backend/config/urls.py backend/apps/core/tests/test_search.py
git commit -m "feat(core): global search aggregator (8 entities, permission-gated)"
```

---

## Task 7: Global Search frontend (palette)

**Files:**
- Create: `frontend/src/lib/api/search.ts`
- Modify: `frontend/src/lib/query/keys.ts`
- Modify: `frontend/src/components/shared/CommandPalette.tsx`

- [ ] **Step 1: Add the API client + type**

Create `frontend/src/lib/api/search.ts`:

```typescript
import { apiGet } from './client';

export type SearchType =
  | 'customer' | 'lead' | 'job' | 'invoice' | 'product' | 'technician' | 'payment' | 'purchase_order';

export interface SearchResult {
  type: SearchType;
  id: string;
  label: string;
  sublabel: string;
  route: string;
}

export const searchApi = {
  query: (q: string) => apiGet<{ results: SearchResult[] }>('/search/', { q }),
};
```

- [ ] **Step 2: Add the query key**

In `frontend/src/lib/query/keys.ts`, inside `qk`, add:

```typescript
  search: (q: string) => ['search', q] as const,
```

- [ ] **Step 3: Rebuild the palette**

Replace `frontend/src/components/shared/CommandPalette.tsx` with a debounced search palette:

```tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { searchApi, type SearchResult, type SearchType } from '@/lib/api/search';
import { qk } from '@/lib/query/keys';

const TYPE_LABELS: Record<SearchType, string> = {
  customer: 'Customers', lead: 'Leads', job: 'Jobs', invoice: 'Invoices',
  product: 'Products', technician: 'Technicians', payment: 'Payments', purchase_order: 'Purchase Orders',
};
const TYPE_ORDER: SearchType[] = ['customer', 'lead', 'job', 'invoice', 'product', 'technician', 'payment', 'purchase_order'];

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [active, setActive] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 250);
    return () => clearTimeout(t);
  }, [q]);

  // reset on close
  useEffect(() => { if (!open) { setQ(''); setDebounced(''); setActive(0); } }, [open]);

  const enabled = debounced.trim().length >= 2;
  const { data } = useQuery({
    queryKey: qk.search(debounced),
    queryFn: () => searchApi.query(debounced),
    enabled,
    placeholderData: (prev) => prev,
  });

  const results: SearchResult[] = useMemo(() => {
    const rows = data?.results ?? [];
    return [...rows].sort((a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type));
  }, [data]);

  useEffect(() => { setActive(0); }, [debounced, data]);

  const go = (r: SearchResult) => { onOpenChange(false); router.push(r.route); };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter' && results[active]) { e.preventDefault(); go(results[active]); }
  };

  // group for rendering while keeping a flat index for keyboard nav
  let flatIndex = -1;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-[20%] translate-y-0">
        <DialogHeader><DialogTitle className="sr-only">Search</DialogTitle></DialogHeader>
        <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKeyDown}
               placeholder="Search customers, jobs, invoices…" />
        {!enabled ? (
          <p className="text-body-sm text-[var(--text-muted)] py-6 text-center">Type at least 2 characters.</p>
        ) : results.length === 0 ? (
          <p className="text-body-sm text-[var(--text-muted)] py-6 text-center">No results for “{debounced}”.</p>
        ) : (
          <div className="max-h-80 overflow-auto py-1">
            {TYPE_ORDER.filter((t) => results.some((r) => r.type === t)).map((t) => (
              <div key={t}>
                <div className="px-2 py-1 text-xs font-semibold text-[var(--text-muted)]">{TYPE_LABELS[t]}</div>
                {results.filter((r) => r.type === t).map((r) => {
                  flatIndex += 1;
                  const idx = flatIndex;
                  return (
                    <button key={`${r.type}-${r.id}`} onClick={() => go(r)} onMouseEnter={() => setActive(idx)}
                      className={`w-full text-left px-3 py-2 rounded-md ${idx === active ? 'bg-[var(--surface-2)]' : ''}`}>
                      <span className="text-body-sm text-[var(--text)]">{r.label}</span>
                      {r.sublabel && <span className="ml-2 text-xs text-[var(--text-muted)]">{r.sublabel}</span>}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

> `placeholderData: (prev) => prev` is the React Query v5 spelling of `keepPreviousData`. Confirm the
> installed React Query major (v5 in this repo) and adjust if needed.

- [ ] **Step 4: Verify**

Run (from `frontend/`): `npx tsc --noEmit` (exit 0) and `npx vitest run` (no regressions).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/api/search.ts frontend/src/lib/query/keys.ts frontend/src/components/shared/CommandPalette.tsx
git commit -m "feat(search): wire ⌘K palette to /search aggregator"
```

---

## Task 8: Notification bell frontend

**Files:**
- Create: `frontend/src/lib/api/notifications.ts`
- Modify: `frontend/src/lib/query/keys.ts`
- Create: `frontend/src/components/shared/NotificationBell.tsx`
- Modify: `frontend/src/components/shared/AppShell.tsx` (replace bell stub with `<NotificationBell/>`)

- [ ] **Step 1: Add the API client + types**

Create `frontend/src/lib/api/notifications.ts`:

```typescript
import { apiGet, apiPost, type PageMeta } from './client';

export interface AppNotification {
  id: string;
  type: string;
  title: string;
  body: string;
  route: string;
  read_at: string | null;
  created_at: string;
}

export const notificationsApi = {
  list: () => apiGet<{ items: AppNotification[]; meta: PageMeta }>('/notifications/'),
  unreadCount: () => apiGet<{ count: number }>('/notifications/unread-count/'),
  markRead: (id: string) => apiPost<AppNotification>(`/notifications/${id}/read/`, {}),
  markAllRead: () => apiPost<{ ok: boolean }>('/notifications/read-all/', {}),
};
```

> Confirm the list endpoint's paginated shape (`{items, meta}` from `RepairOSPageNumberPagination`)
> matches how other paginated clients in `billing.ts` type it; adjust the generic if the wrapper
> differs.

- [ ] **Step 2: Add query keys**

In `frontend/src/lib/query/keys.ts`, inside `qk`, add:

```typescript
  notifications: () => ['notifications'] as const,
  notificationsUnread: () => ['notifications', 'unread-count'] as const,
```

- [ ] **Step 3: Build `NotificationBell.tsx`**

Create `frontend/src/components/shared/NotificationBell.tsx` (move the bell here; poll unread count):

```tsx
'use client';

import { Bell } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent } from '@/components/ui/dropdown-menu';
import { notificationsApi, type AppNotification } from '@/lib/api/notifications';
import { qk } from '@/lib/query/keys';
import { formatRelative } from '@/lib/format/date';

export function NotificationBell() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: countData } = useQuery({
    queryKey: qk.notificationsUnread(),
    queryFn: () => notificationsApi.unreadCount(),
    refetchInterval: 45_000,
  });
  const unread = countData?.count ?? 0;

  const { data: listData } = useQuery({
    queryKey: qk.notifications(),
    queryFn: () => notificationsApi.list(),
    staleTime: 30_000,
  });
  const items: AppNotification[] = listData?.items ?? [];

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: qk.notifications() });
    queryClient.invalidateQueries({ queryKey: qk.notificationsUnread() });
  };
  const markRead = useMutation({ mutationFn: (id: string) => notificationsApi.markRead(id), onSuccess: invalidate });
  const markAll = useMutation({ mutationFn: () => notificationsApi.markAllRead(), onSuccess: invalidate });

  const open = (n: AppNotification) => {
    if (!n.read_at) markRead.mutate(n.id);
    if (n.route) router.push(n.route);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="relative p-2 rounded-md hover:bg-[var(--surface-2)] text-[var(--text-muted)] min-h-[auto] min-w-[auto]" aria-label="Notifications">
          <Bell className="h-5 w-5" />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 rounded-full bg-[var(--danger)] text-white text-[10px] leading-4 text-center">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <div className="flex items-center justify-between px-2 py-1.5">
          <span className="text-xs font-semibold text-[var(--text-muted)]">Notifications</span>
          {unread > 0 && (
            <button className="text-xs text-[var(--accent)]" onClick={() => markAll.mutate()}>Mark all read</button>
          )}
        </div>
        {items.length === 0 ? (
          <div className="px-2 py-6 text-center text-body-sm text-[var(--text-muted)]">You&apos;re all caught up.</div>
        ) : (
          <div className="max-h-96 overflow-auto">
            {items.map((n) => (
              <button key={n.id} onClick={() => open(n)}
                className="w-full text-left px-3 py-2 hover:bg-[var(--surface-2)] flex gap-2">
                {!n.read_at && <span className="mt-1.5 h-2 w-2 rounded-full bg-[var(--accent)] shrink-0" />}
                <span className="min-w-0">
                  <span className="block text-body-sm text-[var(--text)] truncate">{n.title}</span>
                  {n.body && <span className="block text-xs text-[var(--text-muted)] truncate">{n.body}</span>}
                  <span className="block text-[10px] text-[var(--text-muted)]">{formatRelative(n.created_at)}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

> Confirm dropdown-menu import path + `formatRelative` export (both used elsewhere:
> `AppShell.tsx`, `lib/format/date.ts`).

- [ ] **Step 4: Wire it into AppShell**

In `frontend/src/components/shared/AppShell.tsx`: import `NotificationBell` and replace the entire
`<DropdownMenu>…</DropdownMenu>` bell block (the stub at ~lines 472-487) with `<NotificationBell />`.
Remove the now-unused `Bell`/`DropdownMenu*` imports **only if** they are no longer referenced
elsewhere in the file (check first — `DropdownMenu` may be used for the user menu).

- [ ] **Step 5: Verify**

Run (from `frontend/`): `npx tsc --noEmit` (exit 0); `npx vitest run` (no regressions).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/api/notifications.ts frontend/src/lib/query/keys.ts frontend/src/components/shared/NotificationBell.tsx frontend/src/components/shared/AppShell.tsx
git commit -m "feat(notifications): live bell badge + dropdown feed (polling)"
```

---

## Task 9: Final verification

- [ ] **Step 1: Backend — Phase-2 + dependency suites**

Run (from `backend/`):
```bash
python -m pytest apps/core apps/repair apps/billing apps/crm apps/inventory apps/amc apps/master apps/authentication -p no:cacheprovider -o addopts="" -q
```
Expected: PASS (pre-existing `weasyprint` PDF-export failures in `apps/reports` are not in this set;
if any unrelated pre-existing failure appears, confirm it exists on `master` before treating it as a regression).

- [ ] **Step 2: Notification migration reversibility**

Run inside the backend container (host can't reach the DB directly):
```bash
docker compose exec -T backend sh -c "python manage.py migrate core <N-1> && python manage.py migrate core <N> "
```
Where `<N>` is the new notification migration and `<N-1>` its predecessor — confirm names with
`python manage.py showmigrations core`. Expected: unapply then re-apply cleanly.

- [ ] **Step 3: Frontend — full suite + typecheck + lint**

Run (from `frontend/`):
```bash
npx tsc --noEmit
npx vitest run
npm run lint -- --no-cache
```
Expected: tsc exit 0; all Vitest pass; lint clean.

- [ ] **Step 4: Frontend — production build**

Run: `docker compose exec -e NODE_ENV=production frontend sh -c "npm run build"`
Expected: build exit 0; no new SSR/prerender errors.

- [ ] **Step 5: Confirm CI deny-list unaffected**

Run (from `backend/`): `grep -vc '^#\|^$' ci-known-failures.txt`
Expected: `0`.

---

## Notes for the implementer

- **Response envelope:** every API response is wrapped `{success, data}`; backend tests read `.json()["data"]`. `apiGet`/`apiPost` already unwrap `data`.
- **Permission gating** reads the JWT `permissions` claim; a non-empty claim is trusted, an empty claim falls back to DB role lookup (a fresh test user with no roles → denied). Use this for 403 tests.
- **No `any`, no `console.log`.** App Router pages/components export only what's needed; keep helpers in modules. React Query v5 (`placeholderData`, object signatures).
- **Notifications need no permission slug** — they are owner-scoped. Search needs no new slug — it reuses each module's `view` slug.
- **Import producers lazily** (`from core.services import …` inside functions) to avoid app import cycles.
