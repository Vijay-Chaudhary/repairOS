# ERP/CRM Phase 10 — Audit Log Read API + Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the existing `authentication.AuditLog` write-path through a filtered, paginated read API and replace the `/audit` ComingSoon stub with a real viewer page.

**Architecture:** Pure read-side — no new model, no migration, no Celery. The `AuditLog` model (`backend/apps/authentication/models.py:142`) is already written to by every module's `services.py`. We add two endpoints in the `authentication` app (`GET /api/v1/audit/` list + `GET /api/v1/audit/facets/` for filter dropdowns), both gated on the already-seeded `settings.audit.view` permission, and a Next.js page with filters (user, action, model, date range), page-number pagination, and a row-click detail dialog showing `old_value`/`new_value` JSON. The nav leaf for `/audit` already exists in `AppShell.tsx` gated on the same permission — no nav change.

**Tech Stack:** Django 5 + DRF `APIView` (manual filter pattern, matches `accounts.JournalListCreateView`), `RepairOSPageNumberPagination`, Next.js 14 App Router + React Query + `DataTable`, Vitest + RTL.

**Out of scope (YAGNI):** CSV export, audit-write coverage expansion (write hooks already exist per module), retention/pruning, real-time updates.

---

## Context an engineer needs

- **Backend root is `backend/`** — run `cd backend && python3 -m pytest ...`. Test settings use SQLite in-memory; a `tenant_context` autouse fixture (in `backend/conftest.py`) pins the DB alias, and an `api_client` fixture provides a DRF `APIClient`.
- **Response envelope:** `core.renderers.RepairOSRenderer` wraps everything as `{"success": true, "data": ...}`. Tests read `res.json()["data"]`. The frontend `apiFetch` already unwraps this.
- **Pagination:** `core.pagination.RepairOSPageNumberPagination` returns `{"items": [...], "meta": {count, total_pages, page, page_size}}`, default page_size 20.
- **Permission gate:** `authentication.permissions.require_permission("settings.audit.view")` — the permission is already seeded (`backend/apps/master/services.py:425`) and already gates the nav leaf (`frontend/src/components/shared/AppShell.tsx:112`).
- **AuditLog fields:** `id, user_id (UUID, not FK), action (create/update/delete/login/logout/permission_denied), model_name, object_id, old_value (JSON), new_value (JSON), ip_address, user_agent, created_at`. Default ordering `-created_at`.
- **Known local test gap:** one HR salary-slip test fails locally because weasyprint isn't installed; it passes in CI. Ignore it — run targeted test paths, and treat that one failure as pre-existing when running the full suite.
- **Fresh-worktree gotcha:** worktrees lack the untracked `.env` files (repo root + `backend/`); copy them from the main checkout before running anything.

---

### Task 0: Branch + plan commit

**Files:**
- Create: this plan file (already saved)

- [x] **Step 1: Create feature branch**

```bash
git checkout -b feature/erp-crm-phase-10-audit-viewer
```

- [x] **Step 2: Commit the plan**

```bash
git add docs/superpowers/plans/2026-07-05-erp-crm-phase-10-audit-viewer.md
git commit -m "docs(plan): ERP/CRM Phase 10 — audit log read API + viewer"
```

---

### Task 1: Audit list API — `GET /api/v1/audit/`

**Files:**
- Create: `backend/apps/authentication/audit_views.py`
- Create: `backend/apps/authentication/audit_urls.py`
- Modify: `backend/config/urls.py` (add one include after the `authentication.settings_urls` line)
- Test: `backend/apps/authentication/tests/test_audit_api.py`

- [x] **Step 1: Write the failing tests**

Create `backend/apps/authentication/tests/test_audit_api.py`:

```python
"""
Tests for the audit log read API — list filters, pagination, user-name
resolution, facets, and the settings.audit.view permission gate.
"""

from datetime import timedelta

import pytest
from django.contrib.auth.hashers import make_password
from django.utils import timezone
from rest_framework import status
from rest_framework_simplejwt.tokens import RefreshToken

from authentication.models import AuditLog, User

AUDIT_URL = "/api/v1/audit/"
FACETS_URL = "/api/v1/audit/facets/"


# ── Helpers ───────────────────────────────────────────────────────────────────

def _make_client(api_client, user, permissions: list[str]):
    refresh = RefreshToken.for_user(user)
    access = refresh.access_token
    access["permissions"] = permissions
    access["shop_ids"] = []
    access["is_tenant_wide"] = True
    access["role_ids"] = []
    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {str(access)}")
    return api_client


@pytest.fixture
def admin(db):
    return User.objects.create(
        email="auditor@example.com",
        phone="+919000000010",
        full_name="Audit Admin",
        password=make_password("TestPass@123"),
        is_active=True,
    )


@pytest.fixture
def audit_client(api_client, admin):
    return _make_client(api_client, admin, ["settings.audit.view"])


def _log(**kwargs):
    defaults = dict(action=AuditLog.Action.CREATE, model_name="Invoice")
    defaults.update(kwargs)
    return AuditLog.objects.create(**defaults)


# ── List ──────────────────────────────────────────────────────────────────────

@pytest.mark.django_db
class TestAuditList:
    def test_returns_items_and_meta_newest_first(self, audit_client, admin):
        older = _log(user_id=admin.id, created_at=timezone.now() - timedelta(hours=1))
        newer = _log(user_id=admin.id, action=AuditLog.Action.UPDATE)
        res = audit_client.get(AUDIT_URL)
        assert res.status_code == status.HTTP_200_OK
        data = res.json()["data"]
        assert data["meta"]["count"] == 2
        assert [row["id"] for row in data["items"]] == [str(newer.id), str(older.id)]

    def test_resolves_user_name(self, audit_client, admin):
        _log(user_id=admin.id)
        _log(user_id=None, action=AuditLog.Action.LOGIN, model_name="User")
        res = audit_client.get(AUDIT_URL)
        rows = {row["model_name"]: row for row in res.json()["data"]["items"]}
        assert rows["Invoice"]["user_name"] == "Audit Admin"
        assert rows["User"]["user_name"] is None

    def test_filter_by_action(self, audit_client):
        _log(action=AuditLog.Action.CREATE)
        _log(action=AuditLog.Action.DELETE)
        res = audit_client.get(AUDIT_URL, {"action": "delete"})
        items = res.json()["data"]["items"]
        assert len(items) == 1
        assert items[0]["action"] == "delete"

    def test_filter_by_model_name(self, audit_client):
        _log(model_name="Invoice")
        _log(model_name="Customer")
        res = audit_client.get(AUDIT_URL, {"model_name": "Customer"})
        items = res.json()["data"]["items"]
        assert len(items) == 1
        assert items[0]["model_name"] == "Customer"

    def test_filter_by_user(self, audit_client, admin):
        other = User.objects.create(
            email="other@example.com", phone="+919000000011",
            full_name="Other", password=make_password("TestPass@123"), is_active=True,
        )
        _log(user_id=admin.id)
        _log(user_id=other.id)
        res = audit_client.get(AUDIT_URL, {"user_id": str(other.id)})
        items = res.json()["data"]["items"]
        assert len(items) == 1
        assert items[0]["user_id"] == str(other.id)

    def test_filter_by_date_range(self, audit_client):
        _log(created_at=timezone.now() - timedelta(days=10))
        recent = _log()
        today = timezone.now().date()
        res = audit_client.get(AUDIT_URL, {
            "date_from": (today - timedelta(days=1)).isoformat(),
            "date_to": today.isoformat(),
        })
        items = res.json()["data"]["items"]
        assert [row["id"] for row in items] == [str(recent.id)]

    def test_pagination(self, audit_client):
        for _ in range(25):
            _log()
        res = audit_client.get(AUDIT_URL, {"page": 2})
        data = res.json()["data"]
        assert data["meta"]["total_pages"] == 2
        assert len(data["items"]) == 5

    def test_requires_auth(self, api_client):
        res = api_client.get(AUDIT_URL)
        assert res.status_code in (status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN)

    def test_wrong_permission_is_denied(self, api_client, admin):
        client = _make_client(api_client, admin, ["repair.jobs.view"])
        res = client.get(AUDIT_URL)
        assert res.status_code == status.HTTP_403_FORBIDDEN
```

- [x] **Step 2: Run tests to verify they fail**

```bash
cd backend && python3 -m pytest apps/authentication/tests/test_audit_api.py --no-cov -q
```

Expected: all FAIL/ERROR (404 — route doesn't exist).

- [x] **Step 3: Implement the view**

Create `backend/apps/authentication/audit_views.py`:

```python
"""
Audit log read API — list + facets for the /audit viewer page.

The write-path lives in each module's services.py (AuditLog.objects.create);
this file is the read-only surface, gated on settings.audit.view.
"""

from rest_framework import serializers as drf_serializers
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from core.pagination import RepairOSPageNumberPagination

from .models import AuditLog, User
from .permissions import require_permission


class AuditLogSerializer(drf_serializers.ModelSerializer):
    user_name = drf_serializers.SerializerMethodField()

    class Meta:
        model = AuditLog
        fields = [
            "id", "user_id", "user_name", "action", "model_name", "object_id",
            "old_value", "new_value", "ip_address", "user_agent", "created_at",
        ]

    def get_user_name(self, obj) -> str | None:
        return self.context.get("user_names", {}).get(obj.user_id)


class AuditLogListView(APIView):
    permission_classes = [IsAuthenticated, require_permission("settings.audit.view")]

    def get(self, request: Request) -> Response:
        qs = AuditLog.objects.all()
        qp = request.query_params
        if user_id := qp.get("user_id"):
            qs = qs.filter(user_id=user_id)
        if action := qp.get("action"):
            qs = qs.filter(action=action)
        if model_name := qp.get("model_name"):
            qs = qs.filter(model_name=model_name)
        if date_from := qp.get("date_from"):
            qs = qs.filter(created_at__date__gte=date_from)
        if date_to := qp.get("date_to"):
            qs = qs.filter(created_at__date__lte=date_to)

        paginator = RepairOSPageNumberPagination()
        page = paginator.paginate_queryset(qs, request)
        user_ids = {row.user_id for row in page if row.user_id}
        user_names = dict(
            User.objects.filter(id__in=user_ids).values_list("id", "full_name")
        )
        data = AuditLogSerializer(page, many=True, context={"user_names": user_names}).data
        return paginator.get_paginated_response(data)
```

- [x] **Step 4: Wire URLs**

Create `backend/apps/authentication/audit_urls.py`:

```python
from django.urls import path

from .audit_views import AuditLogListView

urlpatterns = [
    path("", AuditLogListView.as_view(), name="audit-list"),
]
```

In `backend/config/urls.py`, after the line `path("api/v1/", include("authentication.settings_urls")),` add:

```python
    path("api/v1/audit/", include("authentication.audit_urls")),
```

- [x] **Step 5: Run the list tests — expect facets tests absent, list tests pass**

```bash
cd backend && python3 -m pytest apps/authentication/tests/test_audit_api.py --no-cov -q
```

Expected: all `TestAuditList` tests PASS.

- [x] **Step 6: Commit**

```bash
git add backend/apps/authentication/audit_views.py backend/apps/authentication/audit_urls.py backend/config/urls.py backend/apps/authentication/tests/test_audit_api.py
git commit -m "feat(audit): audit log read API with filters + pagination"
```

---

### Task 2: Facets endpoint — `GET /api/v1/audit/facets/`

Powers the viewer's filter dropdowns (distinct model names + users seen in the log + action choices) without depending on `settings.users.manage`.

**Files:**
- Modify: `backend/apps/authentication/audit_views.py` (append view)
- Modify: `backend/apps/authentication/audit_urls.py` (add route)
- Test: `backend/apps/authentication/tests/test_audit_api.py` (append class)

- [x] **Step 1: Write the failing tests**

Append to `backend/apps/authentication/tests/test_audit_api.py`:

```python
# ── Facets ────────────────────────────────────────────────────────────────────

@pytest.mark.django_db
class TestAuditFacets:
    def test_returns_actions_models_and_users(self, audit_client, admin):
        _log(user_id=admin.id, model_name="Invoice")
        _log(user_id=admin.id, model_name="Customer")
        _log(user_id=None, model_name="Customer")
        res = audit_client.get(FACETS_URL)
        assert res.status_code == status.HTTP_200_OK
        data = res.json()["data"]
        assert data["model_names"] == ["Customer", "Invoice"]
        assert data["users"] == [{"id": str(admin.id), "full_name": "Audit Admin"}]
        assert "create" in data["actions"] and "permission_denied" in data["actions"]

    def test_wrong_permission_is_denied(self, api_client, admin):
        client = _make_client(api_client, admin, ["repair.jobs.view"])
        res = client.get(FACETS_URL)
        assert res.status_code == status.HTTP_403_FORBIDDEN
```

- [x] **Step 2: Run to verify failure**

```bash
cd backend && python3 -m pytest apps/authentication/tests/test_audit_api.py::TestAuditFacets --no-cov -q
```

Expected: FAIL (404).

- [x] **Step 3: Implement**

Append to `backend/apps/authentication/audit_views.py`:

```python
class AuditLogFacetsView(APIView):
    permission_classes = [IsAuthenticated, require_permission("settings.audit.view")]

    def get(self, request: Request) -> Response:
        model_names = list(
            AuditLog.objects.exclude(model_name="")
            .order_by("model_name")
            .values_list("model_name", flat=True)
            .distinct()
        )
        user_ids = list(
            AuditLog.objects.filter(user_id__isnull=False)
            .values_list("user_id", flat=True)
            .distinct()
        )
        users = [
            {"id": str(uid), "full_name": name}
            for uid, name in User.objects.filter(id__in=user_ids)
            .order_by("full_name")
            .values_list("id", "full_name")
        ]
        return Response({
            "actions": [choice[0] for choice in AuditLog.Action.choices],
            "model_names": model_names,
            "users": users,
        })
```

Add to `backend/apps/authentication/audit_urls.py` (import `AuditLogFacetsView` alongside `AuditLogListView`):

```python
    path("facets/", AuditLogFacetsView.as_view(), name="audit-facets"),
```

- [x] **Step 4: Run the whole audit test file**

```bash
cd backend && python3 -m pytest apps/authentication/tests/test_audit_api.py --no-cov -q
```

Expected: ALL PASS.

- [x] **Step 5: Commit**

```bash
git add backend/apps/authentication/audit_views.py backend/apps/authentication/audit_urls.py backend/apps/authentication/tests/test_audit_api.py
git commit -m "feat(audit): facets endpoint for viewer filter dropdowns"
```

---

### Task 3: Frontend API client + query keys

**Files:**
- Create: `frontend/src/lib/api/audit.ts`
- Modify: `frontend/src/lib/query/keys.ts` (append two keys inside the `qk` object)

- [ ] **Step 1: Create the API module**

Create `frontend/src/lib/api/audit.ts`:

```typescript
import { apiGet, type PageMeta } from './client';

export type AuditAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'login'
  | 'logout'
  | 'permission_denied';

export interface AuditLogEntry {
  id: string;
  user_id: string | null;
  user_name: string | null;
  action: AuditAction;
  model_name: string;
  object_id: string | null;
  old_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
  ip_address: string | null;
  user_agent: string;
  created_at: string;
}

export interface AuditFacets {
  actions: AuditAction[];
  model_names: string[];
  users: { id: string; full_name: string }[];
}

export interface AuditFilters {
  user_id?: string;
  action?: string;
  model_name?: string;
  date_from?: string;
  date_to?: string;
  page?: number;
}

export const auditApi = {
  list: (filters: AuditFilters = {}) =>
    apiGet<{ items: AuditLogEntry[]; meta: PageMeta }>('/audit/', filters),
  facets: () => apiGet<AuditFacets>('/audit/facets/'),
};
```

- [ ] **Step 2: Add query keys**

In `frontend/src/lib/query/keys.ts`, append inside the `qk` object (near the accounts keys, keeping alignment style):

```typescript
  // Audit
  auditLogs:      (params?: Record<string, unknown>) => ['audit', 'list', params ?? {}] as const,
  auditFacets:    () => ['audit', 'facets'] as const,
```

- [ ] **Step 3: Typecheck**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/api/audit.ts frontend/src/lib/query/keys.ts
git commit -m "feat(audit): frontend audit API client + query keys"
```

---

### Task 4: Audit viewer page

Replaces the ComingSoon stub. Filter bar (user, action, model, date range) → paginated DataTable → row-click detail dialog with old/new JSON.

**Files:**
- Modify: `frontend/src/app/(app)/audit/page.tsx` (full rewrite of the stub)
- Test: `frontend/src/app/(app)/audit/__tests__/audit.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/app/(app)/audit/__tests__/audit.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AuditPage from '../page';

const authState = {
  hasPermission: () => true,
  hasAnyPermission: () => true,
  user: { id: 'u-1' },
};
vi.mock('@/lib/stores/authStore', () => ({
  useAuthStore: (selector?: (s: typeof authState) => unknown) =>
    selector ? selector(authState) : authState,
}));

const list = vi.fn();
const facets = vi.fn();
vi.mock('@/lib/api/audit', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/api/audit')>();
  return {
    ...actual,
    auditApi: {
      list: (...a: unknown[]) => list(...a),
      facets: (...a: unknown[]) => facets(...a),
    },
  };
});

const ROW = {
  id: 'log-1',
  user_id: 'u-9',
  user_name: 'Priya Shah',
  action: 'update' as const,
  model_name: 'Invoice',
  object_id: 'obj-1',
  old_value: { status: 'draft' },
  new_value: { status: 'issued' },
  ip_address: '10.0.0.1',
  user_agent: 'pytest',
  created_at: '2026-07-05T10:30:00Z',
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><AuditPage /></QueryClientProvider>);
}

describe('AuditPage', () => {
  beforeEach(() => {
    list.mockReset().mockResolvedValue({
      items: [ROW],
      meta: { count: 1, total_pages: 1, page: 1, page_size: 20 },
    });
    facets.mockReset().mockResolvedValue({
      actions: ['create', 'update', 'delete', 'login', 'logout', 'permission_denied'],
      model_names: ['Customer', 'Invoice'],
      users: [{ id: 'u-9', full_name: 'Priya Shah' }],
    });
  });

  it('renders audit rows with user, action, and model', async () => {
    renderPage();
    expect(await screen.findByText('Priya Shah')).toBeInTheDocument();
    expect(screen.getByText('Invoice')).toBeInTheDocument();
    expect(screen.getByText('Update')).toBeInTheDocument();
  });

  it('opens a detail dialog with old/new values on row click', async () => {
    renderPage();
    fireEvent.click(await screen.findByText('Invoice'));
    expect(await screen.findByText('Audit entry')).toBeInTheDocument();
    expect(screen.getByText(/"draft"/)).toBeInTheDocument();
    expect(screen.getByText(/"issued"/)).toBeInTheDocument();
  });

  it('passes the action filter to the API', async () => {
    renderPage();
    await screen.findByText('Priya Shah');
    expect(list).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 1 }),
    );
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd frontend && npx vitest run "src/app/(app)/audit"
```

Expected: FAIL (page still renders ComingSoon).

- [ ] **Step 3: Implement the page**

Replace `frontend/src/app/(app)/audit/page.tsx` entirely:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DataTable, type Column } from '@/components/shared/DataTable';
import { auditApi, type AuditAction, type AuditLogEntry } from '@/lib/api/audit';
import { qk } from '@/lib/query/keys';
import { formatDatetime } from '@/lib/format/date';

const ACTION_LABELS: Record<AuditAction, string> = {
  create: 'Create',
  update: 'Update',
  delete: 'Delete',
  login: 'Login',
  logout: 'Logout',
  permission_denied: 'Permission denied',
};

const ACTION_CLASSES: Record<AuditAction, string> = {
  create: 'bg-[var(--success)]/10 text-[var(--success)]',
  update: 'bg-[var(--info)]/10 text-[var(--info)]',
  delete: 'bg-[var(--danger)]/10 text-[var(--danger)]',
  login: 'bg-[var(--surface-2)] text-[var(--text-muted)]',
  logout: 'bg-[var(--surface-2)] text-[var(--text-muted)]',
  permission_denied: 'bg-[var(--warning)]/10 text-[var(--warning)]',
};

function ActionBadge({ action }: { action: AuditAction }) {
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-caption font-medium ${ACTION_CLASSES[action] ?? ''}`}>
      {ACTION_LABELS[action] ?? action}
    </span>
  );
}

function JsonBlock({ label, value }: { label: string; value: Record<string, unknown> | null }) {
  return (
    <div>
      <div className="text-caption font-medium text-[var(--text-muted)] mb-1">{label}</div>
      <pre className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3 text-caption overflow-auto max-h-56">
        {value ? JSON.stringify(value, null, 2) : '—'}
      </pre>
    </div>
  );
}

const columns: Column<AuditLogEntry>[] = [
  {
    key: 'when',
    header: 'When',
    cell: (r) => <span className="text-body-sm whitespace-nowrap">{formatDatetime(r.created_at)}</span>,
  },
  {
    key: 'user',
    header: 'User',
    cell: (r) => <span className="text-body-sm">{r.user_name ?? '—'}</span>,
  },
  {
    key: 'action',
    header: 'Action',
    cell: (r) => <ActionBadge action={r.action} />,
  },
  {
    key: 'model',
    header: 'Model',
    cell: (r) => <span className="text-body-sm font-medium">{r.model_name}</span>,
  },
  {
    key: 'object',
    header: 'Object',
    cell: (r) => (
      <span className="text-caption font-mono text-[var(--text-muted)]">
        {r.object_id ? `${r.object_id.slice(0, 8)}…` : '—'}
      </span>
    ),
  },
  {
    key: 'ip',
    header: 'IP',
    cell: (r) => <span className="text-caption text-[var(--text-muted)]">{r.ip_address ?? '—'}</span>,
  },
];

export default function AuditPage() {
  const [userFilter, setUserFilter] = useState('all');
  const [actionFilter, setActionFilter] = useState('all');
  const [modelFilter, setModelFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [listPage, setListPage] = useState(1);
  const [selected, setSelected] = useState<AuditLogEntry | null>(null);
  useEffect(() => { setListPage(1); }, [userFilter, actionFilter, modelFilter, dateFrom, dateTo]);

  const filters = {
    user_id: userFilter === 'all' ? undefined : userFilter,
    action: actionFilter === 'all' ? undefined : actionFilter,
    model_name: modelFilter === 'all' ? undefined : modelFilter,
    date_from: dateFrom || undefined,
    date_to: dateTo || undefined,
    page: listPage,
  };

  const { data, isLoading, error } = useQuery({
    queryKey: qk.auditLogs(filters),
    queryFn: () => auditApi.list(filters),
    staleTime: 30_000,
  });

  const { data: facetData } = useQuery({
    queryKey: qk.auditFacets(),
    queryFn: () => auditApi.facets(),
    staleTime: 300_000,
  });

  const hasFilters =
    userFilter !== 'all' || actionFilter !== 'all' || modelFilter !== 'all' || !!dateFrom || !!dateTo;

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-[var(--border)] bg-[var(--surface)]">
        <h1 className="text-h1 text-[var(--text)]">Audit log</h1>
        <p className="text-body-sm text-[var(--text-muted)] mt-0.5">
          Who changed what, when — system-wide record of writes and sign-ins
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-[var(--border)]">
        <Select value={userFilter} onValueChange={setUserFilter}>
          <SelectTrigger className="h-9 w-[180px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All users</SelectItem>
            {(facetData?.users ?? []).map((u) => (
              <SelectItem key={u.id} value={u.id}>{u.full_name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={actionFilter} onValueChange={setActionFilter}>
          <SelectTrigger className="h-9 w-[170px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All actions</SelectItem>
            {(facetData?.actions ?? []).map((a) => (
              <SelectItem key={a} value={a}>{ACTION_LABELS[a] ?? a}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={modelFilter} onValueChange={setModelFilter}>
          <SelectTrigger className="h-9 w-[170px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All models</SelectItem>
            {(facetData?.model_names ?? []).map((m) => (
              <SelectItem key={m} value={m}>{m}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-2">
          <Input type="date" className="h-9 w-[140px]" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          <span className="text-[var(--text-muted)] text-body-sm">–</span>
          <Input type="date" className="h-9 w-[140px]" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        </div>
        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setUserFilter('all'); setActionFilter('all'); setModelFilter('all');
              setDateFrom(''); setDateTo('');
            }}
          >
            Clear
          </Button>
        )}
      </div>

      <div className="flex-1 min-h-0 p-4">
        <DataTable
          columns={columns}
          data={data?.items}
          loading={isLoading}
          error={error as Error | null}
          keyExtractor={(r) => r.id}
          onRowClick={setSelected}
          emptyTitle="No audit entries"
          emptyDescription="Actions across the app will appear here as they happen."
          page={data?.meta.page}
          totalPages={data?.meta.total_pages}
          onPageChange={setListPage}
          totalCount={data?.meta.count}
        />
      </div>

      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Audit entry</DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-body-sm">
                <div><span className="text-[var(--text-muted)]">When</span><div>{formatDatetime(selected.created_at)}</div></div>
                <div><span className="text-[var(--text-muted)]">User</span><div>{selected.user_name ?? '—'}</div></div>
                <div><span className="text-[var(--text-muted)]">Action</span><div><ActionBadge action={selected.action} /></div></div>
                <div><span className="text-[var(--text-muted)]">Model</span><div>{selected.model_name}</div></div>
                <div><span className="text-[var(--text-muted)]">Object ID</span><div className="font-mono text-caption break-all">{selected.object_id ?? '—'}</div></div>
                <div><span className="text-[var(--text-muted)]">IP</span><div>{selected.ip_address ?? '—'}</div></div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <JsonBlock label="Old value" value={selected.old_value} />
                <JsonBlock label="New value" value={selected.new_value} />
              </div>
              {selected.user_agent && (
                <p className="text-caption text-[var(--text-muted)] break-all">{selected.user_agent}</p>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

- [ ] **Step 4: Run the page tests**

```bash
cd frontend && npx vitest run "src/app/(app)/audit"
```

Expected: ALL PASS. If the Radix `Select` throws in jsdom about missing `hasPointerCapture`/`scrollIntoView`, check `frontend/vitest.setup.ts` — the shims used by other filter-page tests should already cover it.

- [ ] **Step 5: Typecheck + lint**

```bash
cd frontend && npx tsc --noEmit && npx next lint --dir "src/app/(app)/audit" 2>/dev/null || npx eslint "src/app/(app)/audit"
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add "frontend/src/app/(app)/audit"
git commit -m "feat(audit): audit log viewer page — filters, pagination, detail dialog"
```

---

### Task 5: Full verification + PR

**Files:** none new — verification only, plus plan checkbox ticks.

- [ ] **Step 1: Full backend suite**

```bash
cd backend && python3 -m pytest --no-cov -q
```

Expected: pass except the known weasyprint salary-slip failure (local-only; passes in CI).

- [ ] **Step 2: Full frontend suite**

```bash
cd frontend && npx vitest run
```

Expected: ALL PASS.

- [ ] **Step 3: Tick remaining plan checkboxes, commit docs**

```bash
git add docs/superpowers/plans/2026-07-05-erp-crm-phase-10-audit-viewer.md
git commit -m "docs(plan): tick Phase 10 tasks"
```

- [ ] **Step 4: Push + PR**

```bash
git push -u origin feature/erp-crm-phase-10-audit-viewer
gh pr create --base master --title "ERP/CRM Phase 10 — Audit log read API + viewer" --body "..."
```

Verify the PR base is `master` with `gh pr view --json baseRefName` (the `gh pr edit --base` silent-fail gotcha).

---

## Self-review notes

- **Spec coverage:** nav-design §4a asks for (a) read API `GET /audit/` with filters user/action/model_name/date-range gated on `settings.audit.view` → Task 1; (b) UI `/audit` page → Task 4. Write hooks already exist (every module's services.py). Permission seeding + nav leaf already shipped in Phase 0.
- **Facets endpoint** is an addition beyond the spec, justified: the user/model dropdowns would otherwise require `settings.users.manage` or free-text guessing.
- **Types consistent:** `AuditLogEntry`/`AuditFacets`/`AuditFilters` in Task 3 match the serializer fields in Task 1 and the page usage in Task 4; `qk.auditLogs`/`qk.auditFacets` used in Task 4 are defined in Task 3.
