# ERP/CRM Phase 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship CRM Contacts (many per customer) and the Deals pipeline (opportunities with stages + win/loss) from the approved Phase-3 spec, filling the Phase-0 `/crm/contacts` and `/crm/deals` stubs.

**Architecture:** Two net-new `crm` models exposed as DRF ViewSets on the existing CRM `DefaultRouter` (`/api/v1/crm/`), mirroring `LeadViewSet` + `ShopScopedMixin`. The Deals board reuses the shared `KanbanBoard<T>` via a new `DealBoard` mirroring `LeadBoard`; Contacts get a standalone page + a customer-detail tab. Permission slugs already seeded in Phase 0.

**Tech Stack:** Django 4.2 + DRF, pytest; Next.js 14 App Router + TS strict, React Query, Tailwind, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-29-erp-crm-phase-3-design.md`

---

## Reference patterns (read before starting)

- `ShopScopedMixin` (`_shop_filter`) + per-action `get_permissions` + `get_queryset`: `apps/crm/views.py:61-145`.
- Lead `change_status` action + `services.transition_lead`: `apps/crm/views.py:169-180`, `apps/crm/services.py:48`.
- CRM ModelSerializer with `_id`/`_name` aliases: `apps/crm/serializers.py` (`LeadSerializer`).
- CRM router registration: `apps/crm/urls.py`.
- Response envelope `{success, data}`; tests read `.json()["data"]`. JWT `client_with_perms` factory + shop scoping: reuse from `apps/billing/tests/test_outstanding.py` (Phase 1).
- Kanban board + `LeadBoard`: `frontend/src/components/shared/KanbanBoard.tsx` (`KanbanBoardProps`), `frontend/src/components/crm/LeadBoard.tsx`.
- Leads page per-column `useQueries` + `handleCardMove`: `frontend/src/app/(app)/leads/page.tsx:158-205`.
- `crmApi` client (`apiGet/apiPost/apiPatch/apiDelete`), `LEAD_PIPELINE_COLS`, `changeLeadStatus`: `frontend/src/lib/api/crm.ts`.
- Customer-detail shadcn `Tabs`: `frontend/src/app/(app)/customers/[id]/page.tsx:7,78,118-126`.

**Shared backend test fixture** (paste into each new backend test module):

```python
import uuid
import pytest

@pytest.fixture
def shop(db):
    from core.models import Shop
    return Shop.objects.create(name="S", code="HTA", address="a", city="Delhi",
                               state="Delhi", state_code="07", phone="+919876543210")

@pytest.fixture
def client_with_perms(db):
    """APIClient whose JWT carries the given permissions + shop scope. Returns (client, user)."""
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

**Build order:** Tasks 1-4 (Contacts), Tasks 5-8 (Deals), Task 9 (verification). Each task ends in a commit.

---

## Task 1: `crm.Contact` model

**Files:** Modify `backend/apps/crm/models.py`; create migration; test `backend/apps/crm/tests/test_contacts_model.py`.

- [ ] **Step 1: Failing test**

```python
import pytest


@pytest.mark.django_db
def test_contact_belongs_to_customer():
    from core.models import Shop
    from crm.models import Customer, Contact
    shop = Shop.objects.create(name="S", code="HTA", address="a", city="Delhi",
                               state="Delhi", state_code="07", phone="+919876543210")
    cust = Customer.objects.create(shop=shop, name="Acme", phone="+919811111111")
    c = Contact.objects.create(shop=shop, customer=cust, name="Asha", designation="Owner",
                               email="a@acme.com", phone="+919822222222")
    assert c.is_primary is False
    assert cust.contacts.count() == 1
    assert str(c)
```

- [ ] **Step 2: Run → FAIL** (`ImportError: cannot import name 'Contact'`).
Run (from `backend/`): `python -m pytest apps/crm/tests/test_contacts_model.py -p no:cacheprovider -o addopts="" -q`

- [ ] **Step 3: Add the model** — append to `backend/apps/crm/models.py` (file already imports `models`, `settings`; `SoftDeleteModel` from `core.models`):

```python
class Contact(SoftDeleteModel):
    """A contact person belonging to a customer (many per customer)."""

    shop = models.ForeignKey("core.Shop", on_delete=models.PROTECT, related_name="contacts")
    customer = models.ForeignKey("Customer", on_delete=models.CASCADE, related_name="contacts")
    name = models.CharField(max_length=200)
    designation = models.CharField(max_length=100, blank=True, default="")
    email = models.EmailField(null=True, blank=True)
    phone = models.CharField(max_length=20, blank=True, default="")
    notes = models.TextField(blank=True, default="")
    is_primary = models.BooleanField(default=False)

    class Meta:
        app_label = "crm"
        db_table = "contacts"
        indexes = [models.Index(fields=["customer", "is_primary"])]

    def __str__(self) -> str:
        return f"{self.name} ({self.customer_id})"
```

> Confirm `SoftDeleteModel` is imported in `crm/models.py` (it is — `Customer`/`Lead` use it).

- [ ] **Step 4: Migration** — `python manage.py makemigrations crm` (creates `Contact`).

- [ ] **Step 5: Run → PASS.**

- [ ] **Step 6: Commit**
```bash
git add backend/apps/crm/models.py backend/apps/crm/migrations/ backend/apps/crm/tests/test_contacts_model.py
git commit -m "feat(crm): Contact model (many per customer)"
```

---

## Task 2: `ContactViewSet` + serializer + URL + tests

**Files:** Modify `backend/apps/crm/serializers.py`, `backend/apps/crm/views.py`, `backend/apps/crm/urls.py`; test `backend/apps/crm/tests/test_contacts_api.py`.

- [ ] **Step 1: Failing test** (include the shared `shop`/`client_with_perms` fixtures):

```python
import pytest
from rest_framework import status


@pytest.fixture
def customer(db, shop):
    from crm.models import Customer
    return Customer.objects.create(shop=shop, name="Acme", phone="+919811111111")


@pytest.mark.django_db
def test_contact_crud_and_scoping(shop, customer, client_with_perms):
    client, _ = client_with_perms(
        ["crm.contacts.view", "crm.contacts.create", "crm.contacts.edit"], shop_ids=[shop.id])

    # create — shop is derived from the customer
    resp = client.post("/api/v1/crm/contacts/", {
        "customer_id": str(customer.id), "name": "Asha", "designation": "Owner",
        "email": "a@acme.com", "phone": "+919822222222", "is_primary": True,
    }, format="json")
    assert resp.status_code == status.HTTP_201_CREATED, resp.content
    cid = resp.json()["data"]["id"]

    # list, filtered by customer
    resp = client.get(f"/api/v1/crm/contacts/?customer_id={customer.id}")
    assert resp.status_code == status.HTTP_200_OK
    assert any(c["name"] == "Asha" for c in resp.json()["data"]["items"])

    # edit
    resp = client.patch(f"/api/v1/crm/contacts/{cid}/", {"designation": "Director"}, format="json")
    assert resp.status_code == status.HTTP_200_OK
    assert resp.json()["data"]["designation"] == "Director"


@pytest.mark.django_db
def test_contact_requires_permission(shop, customer, client_with_perms):
    client, _ = client_with_perms([], shop_ids=[shop.id])
    assert client.get("/api/v1/crm/contacts/").status_code == status.HTTP_403_FORBIDDEN
```

> Confirm the list envelope shape `{"data": {"items": [...], "meta": {...}}}` matches
> `RepairOSPageNumberPagination` (Lead list uses it). Adjust the assertion if the key differs.

- [ ] **Step 2: Run → FAIL** (404 / no route).

- [ ] **Step 3: Serializer** — append to `backend/apps/crm/serializers.py`:

```python
class ContactSerializer(serializers.ModelSerializer):
    customer_id = serializers.UUIDField(source="customer.id", read_only=True)
    customer_name = serializers.CharField(source="customer.name", read_only=True)
    customer = serializers.PrimaryKeyRelatedField(
        queryset=Customer.objects.all(), write_only=True, source="customer", required=True,
    )

    class Meta:
        model = Contact
        fields = ["id", "customer", "customer_id", "customer_name", "name", "designation",
                  "email", "phone", "notes", "is_primary", "created_at"]
```

> Add `Contact` (and `Customer` if not present) to the model imports at the top of `serializers.py`.
> The FE sends `customer_id`; expose a writable `customer` aliased from `customer_id` — confirm the
> exact alias convention other CRM serializers use and match it (some use a `*_id` write field).

- [ ] **Step 4: ViewSet** — append to `backend/apps/crm/views.py`:

```python
class ContactViewSet(ShopScopedMixin, ModelViewSet):
    pagination_class = RepairOSPageNumberPagination
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]
    serializer_class = ContactSerializer

    def get_permissions(self):
        if self.action in ("list", "retrieve"):
            return [require_permission("crm.contacts.view")()]
        if self.action == "create":
            return [require_permission("crm.contacts.create")()]
        return [require_permission("crm.contacts.edit")()]

    def get_queryset(self):
        qs = Contact.objects.filter(self._shop_filter()).select_related("customer")
        if cid := self.request.query_params.get("customer_id"):
            qs = qs.filter(customer_id=cid)
        return qs.order_by("-is_primary", "name")

    def perform_create(self, serializer):
        customer = serializer.validated_data["customer"]
        serializer.save(shop=customer.shop)
```

> Add `Contact` to model imports and `ContactSerializer` to serializer imports in `views.py`.
> `ShopScopedMixin`, `ModelViewSet`, `require_permission`, `RepairOSPageNumberPagination` already imported.

- [ ] **Step 5: Register route** — in `backend/apps/crm/urls.py` add `from .views import ContactViewSet`
to the import group and `router.register("contacts", ContactViewSet, basename="contacts")`.

- [ ] **Step 6: Run → PASS** (2 tests).

- [ ] **Step 7: Commit**
```bash
git add backend/apps/crm/serializers.py backend/apps/crm/views.py backend/apps/crm/urls.py backend/apps/crm/tests/test_contacts_api.py
git commit -m "feat(crm): Contact CRUD API (shop-scoped, customer-filtered)"
```

---

## Task 3: Contacts frontend — standalone `/crm/contacts` page

**Files:** Modify `frontend/src/lib/api/crm.ts`, `frontend/src/lib/query/keys.ts`; replace `frontend/src/app/(app)/crm/contacts/page.tsx`.

- [ ] **Step 1: API client + types** — in `frontend/src/lib/api/crm.ts` add a `Contact` interface and,
inside the `crmApi` object, methods (match the file's existing `apiGet/apiPost/apiPatch/apiDelete` imports):

```typescript
export interface Contact {
  id: string;
  customer_id: string;
  customer_name: string;
  name: string;
  designation: string;
  email: string | null;
  phone: string;
  notes: string;
  is_primary: boolean;
  created_at: string;
}

// inside crmApi:
  listContacts: (filters: { customer_id?: string; page?: number } = {}) =>
    apiGet<{ items: Contact[]; meta: PageMeta }>('/crm/contacts/', filters as Record<string, string | number | undefined>),
  createContact: (body: { customer_id: string; name: string; designation?: string; email?: string; phone?: string; notes?: string; is_primary?: boolean }) =>
    apiPost<Contact>('/crm/contacts/', body),
  updateContact: (id: string, body: Partial<{ name: string; designation: string; email: string; phone: string; notes: string; is_primary: boolean }>) =>
    apiPatch<Contact>(`/crm/contacts/${id}/`, body),
  deleteContact: (id: string) => apiDelete<void>(`/crm/contacts/${id}/`),
```

> `createContact` sends `customer_id`; ensure the backend serializer accepts it (Task 2 Step 3 note).
> If `apiDelete` isn't imported in `crm.ts`, add it to the `./client` import.

- [ ] **Step 2: Query keys** — in `frontend/src/lib/query/keys.ts`, inside `qk`:

```typescript
  contacts: (filters?: Record<string, unknown>) => ['crm', 'contacts', filters ?? {}] as const,
```

- [ ] **Step 3: Page** — replace `frontend/src/app/(app)/crm/contacts/page.tsx` with a React-Query list +
create/edit dialog. Mirror the structure of `frontend/src/app/(app)/settings/taxes/page.tsx` (rhf+zod
Dialog) but for contacts: columns name / designation / customer / email / phone, and a customer
selector in the dialog (load customers via `crmApi.listCustomers`). Full component:

```tsx
'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/EmptyState';
import { crmApi, type Contact } from '@/lib/api/crm';
import { qk } from '@/lib/query/keys';
import { ApiError } from '@/lib/api/client';

const schema = z.object({
  customer_id: z.string().min(1, 'Customer required'),
  name: z.string().min(2, 'Name required'),
  designation: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().optional(),
});
type FormValues = z.infer<typeof schema>;

export default function ContactsPage() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: qk.contacts(),
    queryFn: () => crmApi.listContacts(),
    staleTime: 60_000,
  });
  const customersQuery = useQuery({
    queryKey: qk.customers(),
    queryFn: () => crmApi.listCustomers(),
    staleTime: 300_000,
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { customer_id: '', name: '', designation: '', email: '', phone: '' },
  });

  const createMutation = useMutation({
    mutationFn: (v: FormValues) => crmApi.createContact(v),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.contacts() });
      setOpen(false); form.reset();
      toast.success('Contact added');
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed to add contact'),
  });

  const contacts: Contact[] = data?.items ?? [];
  const customers = customersQuery.data?.items ?? [];

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-h1 text-[var(--text)]">Contacts</h1>
          <p className="text-body-sm text-[var(--text-muted)] mt-1">People at your customer accounts.</p>
        </div>
        <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1" /> Add contact</Button>
      </div>

      {isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : contacts.length === 0 ? (
        <EmptyState title="No contacts yet" description="Add a contact person to a customer." />
      ) : (
        <div className="rounded-lg border border-[var(--border)] overflow-x-auto">
          <table className="w-full text-body-sm">
            <thead className="bg-[var(--surface-2)] text-[var(--text-muted)]">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Name</th>
                <th className="text-left px-4 py-2 font-medium">Designation</th>
                <th className="text-left px-4 py-2 font-medium">Customer</th>
                <th className="text-left px-4 py-2 font-medium">Email</th>
                <th className="text-left px-4 py-2 font-medium">Phone</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {contacts.map((c) => (
                <tr key={c.id} className="bg-[var(--surface)]">
                  <td className="px-4 py-2 font-medium text-[var(--text)]">{c.name}{c.is_primary && ' ★'}</td>
                  <td className="px-4 py-2">{c.designation || '—'}</td>
                  <td className="px-4 py-2">{c.customer_name}</td>
                  <td className="px-4 py-2">{c.email || '—'}</td>
                  <td className="px-4 py-2">{c.phone || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add contact</DialogTitle></DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit((v) => createMutation.mutate(v))} className="space-y-4">
              <FormField control={form.control} name="customer_id" render={({ field }) => (
                <FormItem><FormLabel>Customer</FormLabel><FormControl>
                  <select className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-body-sm" {...field}>
                    <option value="">Select customer…</option>
                    {customers.map((cu) => <option key={cu.id} value={cu.id}>{cu.name}</option>)}
                  </select>
                </FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem><FormLabel>Name</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="designation" render={({ field }) => (
                <FormItem><FormLabel>Designation</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="email" render={({ field }) => (
                <FormItem><FormLabel>Email</FormLabel><FormControl><Input type="email" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="phone" render={({ field }) => (
                <FormItem><FormLabel>Phone</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={createMutation.isPending}>Save</Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

> Confirm `crmApi.listCustomers` exists and returns `{ items, meta }` (Customer list). If its name
> differs, use the actual one. Confirm `qk.customers` exists (it does — used by the leads page).

- [ ] **Step 4: Verify** — from `frontend/`: `npx tsc --noEmit` (exit 0); `npx vitest run` (no regressions).

- [ ] **Step 5: Commit**
```bash
git add frontend/src/lib/api/crm.ts frontend/src/lib/query/keys.ts frontend/src/app/\(app\)/crm/contacts/page.tsx
git commit -m "feat(crm): Contacts standalone page (list + create)"
```

---

## Task 4: Contacts frontend — customer-detail tab

**Files:** Modify `frontend/src/app/(app)/customers/[id]/page.tsx`.

- [ ] **Step 1: Add a Contacts tab.** In the customer detail page, add a `Contacts` trigger to the
existing `<TabsList>` and a matching `<TabsContent value="contacts">`. Lazy-load like the existing
Sales/AMC tabs:

```tsx
// near other tab queries:
const contactsQuery = useQuery({
  queryKey: qk.contacts({ customer_id: customerId }),
  queryFn: () => crmApi.listContacts({ customer_id: customerId }),
  enabled: !!customer && activeTab === 'contacts',
  staleTime: 60_000,
});
```

```tsx
<TabsTrigger value="contacts">Contacts</TabsTrigger>
...
<TabsContent value="contacts">
  {(contactsQuery.data?.items ?? []).length === 0 ? (
    <EmptyState title="No contacts" description="No contact people for this customer yet." />
  ) : (
    <ul className="divide-y divide-[var(--border)] rounded-lg border border-[var(--border)]">
      {(contactsQuery.data?.items ?? []).map((c) => (
        <li key={c.id} className="px-4 py-3 bg-[var(--surface)]">
          <p className="text-body-sm font-medium text-[var(--text)]">{c.name}{c.is_primary && ' ★'}</p>
          <p className="text-xs text-[var(--text-muted)]">
            {[c.designation, c.email, c.phone].filter(Boolean).join(' · ') || '—'}
          </p>
        </li>
      ))}
    </ul>
  )}
</TabsContent>
```

> Confirm the page's customer-id variable name (e.g. `customerId` / `params.id`) and that `qk`,
> `crmApi`, `EmptyState`, and `Tabs*` are imported. Read-only list is sufficient for v1 (creation is
> available on the standalone page); do not over-build.

- [ ] **Step 2: Verify** — `npx tsc --noEmit` (exit 0); `npx vitest run` (no regressions).

- [ ] **Step 3: Commit**
```bash
git add frontend/src/app/\(app\)/customers/\[id\]/page.tsx
git commit -m "feat(crm): customer-detail Contacts tab"
```

---

## Task 5: `crm.Deal` model

**Files:** Modify `backend/apps/crm/models.py`; migration; test `backend/apps/crm/tests/test_deals_model.py`.

- [ ] **Step 1: Failing test**

```python
import pytest
from decimal import Decimal


@pytest.mark.django_db
def test_deal_defaults():
    from core.models import Shop
    from crm.models import Deal
    shop = Shop.objects.create(name="S", code="HTA", address="a", city="Delhi",
                               state="Delhi", state_code="07", phone="+919876543210")
    d = Deal.objects.create(shop=shop, title="Acme upgrade", expected_revenue=Decimal("50000"), probability=40)
    assert d.stage == Deal.Stage.QUALIFICATION
    assert d.customer_id is None        # customer optional
    assert d.closed_at is None
    assert str(d)
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Add the model** — append to `backend/apps/crm/models.py`:

```python
class Deal(SoftDeleteModel):
    """A sales opportunity moving through fixed pipeline stages."""

    class Stage(models.TextChoices):
        QUALIFICATION = "qualification", "Qualification"
        PROPOSAL = "proposal", "Proposal"
        NEGOTIATION = "negotiation", "Negotiation"
        WON = "won", "Won"
        LOST = "lost", "Lost"

    shop = models.ForeignKey("core.Shop", on_delete=models.PROTECT, related_name="deals")
    title = models.CharField(max_length=200)
    customer = models.ForeignKey("Customer", null=True, blank=True, on_delete=models.SET_NULL, related_name="deals")
    contact = models.ForeignKey("Contact", null=True, blank=True, on_delete=models.SET_NULL, related_name="deals")
    stage = models.CharField(max_length=20, choices=Stage.choices, default=Stage.QUALIFICATION, db_index=True)
    expected_revenue = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    probability = models.IntegerField(default=0)
    expected_close_date = models.DateField(null=True, blank=True)
    assigned_to = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True,
                                    on_delete=models.SET_NULL, related_name="assigned_deals")
    lost_reason = models.TextField(blank=True, default="")
    closed_at = models.DateTimeField(null=True, blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True,
                                   on_delete=models.SET_NULL, related_name="created_deals")

    class Meta:
        app_label = "crm"
        db_table = "deals"
        indexes = [models.Index(fields=["shop", "stage"]), models.Index(fields=["assigned_to"])]

    OPEN_STAGES = ["qualification", "proposal", "negotiation"]

    def __str__(self) -> str:
        return f"{self.title} [{self.stage}]"
```

- [ ] **Step 4: Migration** — `python manage.py makemigrations crm`.

- [ ] **Step 5: Run → PASS.**

- [ ] **Step 6: Commit**
```bash
git add backend/apps/crm/models.py backend/apps/crm/migrations/ backend/apps/crm/tests/test_deals_model.py
git commit -m "feat(crm): Deal model (opportunity pipeline, customer optional)"
```

---

## Task 6: `DealViewSet` + serializer + services + URL + tests

**Files:** Modify `backend/apps/crm/serializers.py`, `backend/apps/crm/services.py`, `backend/apps/crm/views.py`, `backend/apps/crm/urls.py`; test `backend/apps/crm/tests/test_deals_api.py`.

- [ ] **Step 1: Failing test** (include shared `shop`/`client_with_perms`):

```python
import pytest
from rest_framework import status

ALL = ["crm.deals.view", "crm.deals.create", "crm.deals.edit", "crm.deals.change_stage", "crm.deals.close"]


@pytest.mark.django_db
def test_deal_crud_stage_and_close(shop, client_with_perms):
    client, _ = client_with_perms(ALL, shop_ids=[shop.id])

    resp = client.post("/api/v1/crm/deals/", {
        "shop": str(shop.id), "title": "Acme upgrade", "expected_revenue": "50000", "probability": 40,
    }, format="json")
    assert resp.status_code == status.HTTP_201_CREATED, resp.content
    did = resp.json()["data"]["id"]

    # legal stage move (open → open)
    resp = client.post(f"/api/v1/crm/deals/{did}/stage/", {"to_stage": "proposal"}, format="json")
    assert resp.status_code == status.HTTP_200_OK
    assert resp.json()["data"]["stage"] == "proposal"

    # illegal stage move (→ won via stage endpoint) rejected
    resp = client.post(f"/api/v1/crm/deals/{did}/stage/", {"to_stage": "won"}, format="json")
    assert resp.status_code == status.HTTP_400_BAD_REQUEST

    # close as lost requires a reason
    assert client.post(f"/api/v1/crm/deals/{did}/close/", {"outcome": "lost"}, format="json").status_code == status.HTTP_400_BAD_REQUEST
    resp = client.post(f"/api/v1/crm/deals/{did}/close/", {"outcome": "lost", "reason": "Budget"}, format="json")
    assert resp.status_code == status.HTTP_200_OK
    body = resp.json()["data"]
    assert body["stage"] == "lost" and body["lost_reason"] == "Budget" and body["closed_at"]


@pytest.mark.django_db
def test_deal_requires_permission(shop, client_with_perms):
    client, _ = client_with_perms([], shop_ids=[shop.id])
    assert client.get("/api/v1/crm/deals/").status_code == status.HTTP_403_FORBIDDEN
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Services** — append to `backend/apps/crm/services.py`:

```python
from django.utils import timezone

from core.exceptions import BusinessRuleViolation  # confirm import path; used by other crm services
from .models import Deal


def change_deal_stage(deal: Deal, to_stage: str, user) -> Deal:
    """Move a deal between open stages only. Won/Lost go through close_deal."""
    if to_stage not in Deal.OPEN_STAGES or deal.stage not in Deal.OPEN_STAGES:
        raise BusinessRuleViolation("Use the close action to mark a deal won or lost.")
    deal.stage = to_stage
    deal.save(update_fields=["stage", "updated_at"])
    return deal


def close_deal(deal: Deal, outcome: str, reason: str, user) -> Deal:
    """Close a deal as won or lost. `reason` is required when lost."""
    if outcome not in ("won", "lost"):
        raise BusinessRuleViolation("outcome must be 'won' or 'lost'.")
    if outcome == "lost" and not (reason or "").strip():
        raise BusinessRuleViolation("A reason is required when marking a deal lost.")
    deal.stage = Deal.Stage.WON if outcome == "won" else Deal.Stage.LOST
    deal.lost_reason = reason or "" if outcome == "lost" else ""
    deal.closed_at = timezone.now()
    deal.save(update_fields=["stage", "lost_reason", "closed_at", "updated_at"])
    return deal
```

> **Plan-time confirmation:** the exception class CRM services raise for business-rule violations
> and how it maps to HTTP 400 (`apps/crm/services.py` / `core/exceptions.py`). Use the same class so
> the DRF exception handler returns 400. If none maps to 400, raise
> `rest_framework.exceptions.ValidationError` instead.

- [ ] **Step 4: Serializer** — append to `backend/apps/crm/serializers.py`:

```python
class DealSerializer(serializers.ModelSerializer):
    customer_name = serializers.CharField(source="customer.name", read_only=True)
    contact_name = serializers.CharField(source="contact.name", read_only=True)
    assigned_to_name = serializers.CharField(source="assigned_to.full_name", read_only=True)

    class Meta:
        model = Deal
        fields = ["id", "shop", "title", "stage", "customer", "customer_name", "contact",
                  "contact_name", "expected_revenue", "probability", "expected_close_date",
                  "assigned_to", "assigned_to_name", "lost_reason", "closed_at", "created_at"]
        read_only_fields = ["id", "stage", "lost_reason", "closed_at", "created_at"]
```

> `stage` is read-only here (set only via create-default + the stage/close actions). Add `Deal` to
> serializer model imports.

- [ ] **Step 5: ViewSet** — append to `backend/apps/crm/views.py`:

```python
class DealViewSet(ShopScopedMixin, ModelViewSet):
    pagination_class = RepairOSPageNumberPagination
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]
    serializer_class = DealSerializer

    def get_permissions(self):
        if self.action in ("list", "retrieve"):
            return [require_permission("crm.deals.view")()]
        if self.action == "create":
            return [require_permission("crm.deals.create")()]
        if self.action == "change_stage":
            return [require_permission("crm.deals.change_stage")()]
        if self.action == "close":
            return [require_permission("crm.deals.close")()]
        return [require_permission("crm.deals.edit")()]

    def get_queryset(self):
        qs = Deal.objects.filter(self._shop_filter()).select_related("customer", "contact", "assigned_to")
        if stage := self.request.query_params.get("stage"):
            qs = qs.filter(stage=stage)
        if assigned := self.request.query_params.get("assigned_to"):
            qs = qs.filter(assigned_to_id=assigned)
        return qs.order_by("-created_at")

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

    @action(detail=True, methods=["post"], url_path="stage")
    def change_stage(self, request, pk=None):
        deal = self.get_object()
        deal = services.change_deal_stage(deal, request.data.get("to_stage", ""), request.user)
        return Response(DealSerializer(deal).data)

    @action(detail=True, methods=["post"], url_path="close")
    def close(self, request, pk=None):
        deal = self.get_object()
        deal = services.close_deal(deal, request.data.get("outcome", ""), request.data.get("reason", ""), request.user)
        return Response(DealSerializer(deal).data)
```

> Add `Deal` to model imports, `DealSerializer` to serializer imports, ensure `action`, `Response`,
> `services` are imported in `views.py` (they are — used by `LeadViewSet`).

- [ ] **Step 6: Register route** — in `backend/apps/crm/urls.py` import `DealViewSet` and
`router.register("deals", DealViewSet, basename="deals")`.

- [ ] **Step 7: Run → PASS** (2 tests). Then run the CRM suite for regressions:
`python -m pytest apps/crm -p no:cacheprovider -o addopts="" -q`.

- [ ] **Step 8: Commit**
```bash
git add backend/apps/crm/serializers.py backend/apps/crm/services.py backend/apps/crm/views.py backend/apps/crm/urls.py backend/apps/crm/tests/test_deals_api.py
git commit -m "feat(crm): Deal CRUD + change_stage + close (won/lost) API"
```

---

## Task 7: Deals frontend — `crmApi`/`qk` + `DealBoard`

**Files:** Modify `frontend/src/lib/api/crm.ts`, `frontend/src/lib/query/keys.ts`; create `frontend/src/components/crm/DealCard.tsx`, `frontend/src/components/crm/DealBoard.tsx`.

- [ ] **Step 1: API client + types** — in `frontend/src/lib/api/crm.ts`:

```typescript
export type DealStage = 'qualification' | 'proposal' | 'negotiation' | 'won' | 'lost';

export interface Deal {
  id: string;
  title: string;
  stage: DealStage;
  customer: string | null;
  customer_name: string | null;
  contact: string | null;
  contact_name: string | null;
  expected_revenue: string;
  probability: number;
  expected_close_date: string | null;
  assigned_to: string | null;
  assigned_to_name: string | null;
  lost_reason: string;
  closed_at: string | null;
  created_at: string;
}

// inside crmApi:
  listDeals: (filters: { stage?: DealStage; assigned_to?: string; page?: number } = {}) =>
    apiGet<{ items: Deal[]; meta: PageMeta }>('/crm/deals/', filters as Record<string, string | number | undefined>),
  createDeal: (body: { shop: string; title: string; customer?: string; contact?: string; expected_revenue?: number; probability?: number; expected_close_date?: string; assigned_to?: string }) =>
    apiPost<Deal>('/crm/deals/', body),
  updateDeal: (id: string, body: Partial<{ title: string; customer: string; contact: string; expected_revenue: number; probability: number; expected_close_date: string; assigned_to: string }>) =>
    apiPatch<Deal>(`/crm/deals/${id}/`, body),
  changeDealStage: (id: string, toStage: DealStage) =>
    apiPost<Deal>(`/crm/deals/${id}/stage/`, { to_stage: toStage }),
  closeDeal: (id: string, outcome: 'won' | 'lost', reason?: string) =>
    apiPost<Deal>(`/crm/deals/${id}/close/`, { outcome, ...(reason ? { reason } : {}) }),
```

And the column constant:

```typescript
export const DEAL_PIPELINE_COLS: Array<{ stage: DealStage; label: string }> = [
  { stage: 'qualification', label: 'Qualification' },
  { stage: 'proposal',      label: 'Proposal' },
  { stage: 'negotiation',   label: 'Negotiation' },
  { stage: 'won',           label: 'Won' },
  { stage: 'lost',          label: 'Lost' },
];
```

- [ ] **Step 2: Query keys** — in `frontend/src/lib/query/keys.ts`, inside `qk`:

```typescript
  deals: (filters?: Record<string, unknown>) => ['crm', 'deals', filters ?? {}] as const,
```

- [ ] **Step 3: `DealCard`** — create `frontend/src/components/crm/DealCard.tsx`:

```tsx
import type { Deal } from '@/lib/api/crm';

const inr = (v: string) => `₹${Number(v).toLocaleString('en-IN')}`;

export function DealCard({ deal }: { deal: Deal }) {
  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-3 space-y-1">
      <p className="text-body-sm font-medium text-[var(--text)] truncate">{deal.title}</p>
      {deal.customer_name && <p className="text-xs text-[var(--text-muted)] truncate">{deal.customer_name}</p>}
      <div className="flex items-center justify-between text-xs">
        <span className="text-[var(--success)] font-medium">{inr(deal.expected_revenue)}</span>
        <span className="text-[var(--text-muted)]">{deal.probability}%</span>
      </div>
      {deal.assigned_to_name && <p className="text-[10px] text-[var(--text-muted)]">{deal.assigned_to_name}</p>}
    </div>
  );
}
```

- [ ] **Step 4: `DealBoard`** — create `frontend/src/components/crm/DealBoard.tsx` (mirrors `LeadBoard.tsx`):

```tsx
'use client';

import { useCallback } from 'react';
import { KanbanBoard, type KanbanColumnDef, type KanbanCardBase } from '@/components/shared/KanbanBoard';
import { DealCard } from './DealCard';
import type { Deal, DealStage } from '@/lib/api/crm';

export interface DealColumnData {
  stage: DealStage;
  deals: Deal[];
  isLoading: boolean;
  count: number;
}

const DEAL_KANBAN_COLS: KanbanColumnDef[] = [
  { id: 'qualification', label: 'Qualification', colorToken: 'var(--accent)' },
  { id: 'proposal',      label: 'Proposal',      colorToken: 'var(--status-progress)' },
  { id: 'negotiation',   label: 'Negotiation',   colorToken: 'var(--warning)' },
  { id: 'won',           label: 'Won',           colorToken: 'var(--success)', collapsible: true, defaultCollapsed: true },
  { id: 'lost',          label: 'Lost',          colorToken: 'var(--danger)',  collapsible: true, defaultCollapsed: true },
];

const DEAL_VALID_TRANSITIONS: Record<string, string[]> = {
  qualification: ['proposal', 'won', 'lost'],
  proposal:      ['negotiation', 'won', 'lost'],
  negotiation:   ['won', 'lost'],
  won:           [],
  lost:          [],
};

const DEAL_TRANSITION_DIALOGS = {
  lost: { required: ['reason'], label: 'Why was this deal lost?' },
  won:  { required: [], label: 'Mark this deal as won?' },
};

interface DealKanbanCard extends KanbanCardBase {
  deal: Deal;
}

function toKanbanCards(columns: DealColumnData[]): DealKanbanCard[] {
  return columns.flatMap(({ stage, deals }) =>
    deals.map((deal) => ({ id: deal.id, columnId: stage, deal })),
  );
}

interface DealBoardProps {
  columns: DealColumnData[];
  onCardMove: (dealId: string, fromStage: DealStage, toStage: DealStage, fields?: Record<string, string>) => Promise<void>;
}

export function DealBoard({ columns, onCardMove }: DealBoardProps) {
  const cards = toKanbanCards(columns);

  const handleCardMove = useCallback(
    async (cardId: string, fromCol: string, toCol: string, fields?: Record<string, string>) => {
      await onCardMove(cardId, fromCol as DealStage, toCol as DealStage, fields);
    },
    [onCardMove],
  );

  const renderCard = useCallback((card: DealKanbanCard) => <DealCard deal={card.deal} />, []);

  const columnCounts = Object.fromEntries(columns.map((c) => [c.stage, c.count]));
  const isLoadingMap = Object.fromEntries(columns.map((c) => [c.stage, c.isLoading]));

  return (
    <KanbanBoard
      columns={DEAL_KANBAN_COLS}
      cards={cards}
      validTransitions={DEAL_VALID_TRANSITIONS}
      onCardMove={handleCardMove}
      onColumnReorder={() => {}}
      renderCard={renderCard}
      columnOrderStorageKey="repaiross-kanban-deals-column-order"
      transitionDialogs={DEAL_TRANSITION_DIALOGS}
      columnCounts={columnCounts}
      isLoadingMap={isLoadingMap}
      emptyLabel="No deals in this stage"
    />
  );
}
```

- [ ] **Step 5: Verify** — `npx tsc --noEmit` (exit 0).

- [ ] **Step 6: Commit**
```bash
git add frontend/src/lib/api/crm.ts frontend/src/lib/query/keys.ts frontend/src/components/crm/DealCard.tsx frontend/src/components/crm/DealBoard.tsx
git commit -m "feat(crm): Deal api client + DealBoard kanban component"
```

---

## Task 8: Deals frontend — `/crm/deals` page

**Files:** Replace `frontend/src/app/(app)/crm/deals/page.tsx`. Test `frontend/src/app/(app)/crm/deals/__tests__/page.test.tsx`.

- [ ] **Step 1: Page** — replace the stub with the board wired to per-column queries (mirror
`leads/page.tsx:158-205`). Create-deal dialog can reuse the rhf+zod pattern (title required; optional
customer/assignee; expected_revenue/probability/close-date). Core wiring:

```tsx
'use client';

import { useCallback, useState } from 'react';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { crmApi, DEAL_PIPELINE_COLS, type Deal, type DealStage } from '@/lib/api/crm';
import { qk } from '@/lib/query/keys';
import { DealBoard, type DealColumnData } from '@/components/crm/DealBoard';
import { useShopScope } from '@/lib/stores/shopScope'; // confirm actual shop-scope hook used by leads page

export default function DealsPage() {
  const queryClient = useQueryClient();
  const { activeShopId } = useShopScope();
  const [assignedFilter] = useState<string>('');

  const baseFilters = { assigned_to: assignedFilter || undefined };

  const columnQueries = useQueries({
    queries: DEAL_PIPELINE_COLS.map(({ stage }) => ({
      queryKey: qk.deals({ ...baseFilters, stage }),
      queryFn: () => crmApi.listDeals({ ...baseFilters, stage }),
      staleTime: 30_000,
    })),
  });

  const columns: DealColumnData[] = DEAL_PIPELINE_COLS.map(({ stage }, i) => ({
    stage,
    deals: columnQueries[i]?.data?.items ?? [],
    isLoading: columnQueries[i]?.isLoading ?? false,
    count: columnQueries[i]?.data?.meta?.count ?? (columnQueries[i]?.data?.items?.length ?? 0),
  }));

  const handleCardMove = useCallback(async (
    dealId: string, _from: DealStage, toStage: DealStage, fields?: Record<string, string>,
  ) => {
    if (toStage === 'won' || toStage === 'lost') {
      await crmApi.closeDeal(dealId, toStage, fields?.reason);
    } else {
      await crmApi.changeDealStage(dealId, toStage);
    }
    queryClient.invalidateQueries({ queryKey: qk.deals() });
    toast.success(toStage === 'won' ? 'Deal won 🎉' : toStage === 'lost' ? 'Deal marked lost' : 'Deal moved');
  }, [queryClient]);

  return (
    <div className="p-4 md:p-6 h-full flex flex-col">
      <h1 className="text-h1 text-[var(--text)] mb-4">Deals</h1>
      <DealBoard columns={columns} onCardMove={handleCardMove} />
    </div>
  );
}
```

> **Plan-time confirmation:** the actual shop-scope hook/store the leads page uses to get the active
> shop id (the snippet's `useShopScope` is illustrative). Mirror the leads page exactly. For the
> create-deal dialog, reuse the contacts/taxes dialog pattern; `shop` must be supplied — use the
> active shop id. If a board needs a fixed height to scroll, match the leads page container.

- [ ] **Step 2: Smoke test** — create `frontend/src/app/(app)/crm/deals/__tests__/page.test.tsx`
mocking `next/navigation` + wrapping in `QueryClientProvider` (mirror the CommandPalette test), asserting
the "Deals" heading renders. Keep it minimal (the board internals are covered by KanbanBoard's own tests).

- [ ] **Step 3: Verify** — `npx tsc --noEmit` (exit 0); `npx vitest run` (all pass).

- [ ] **Step 4: Commit**
```bash
git add frontend/src/app/\(app\)/crm/deals/page.tsx frontend/src/app/\(app\)/crm/deals/__tests__/page.test.tsx
git commit -m "feat(crm): Deals pipeline board page (/crm/deals)"
```

---

## Task 9: Final verification

- [ ] **Step 1: Backend suites** — from `backend/`:
`python -m pytest apps/crm apps/core apps/authentication -p no:cacheprovider -o addopts="" -q` → PASS.

- [ ] **Step 2: Migration reversibility** — inside the backend container, confirm the two new crm
migrations unapply + reapply cleanly:
```bash
docker compose exec -T backend sh -c "python manage.py showmigrations crm | tail -4"
# migrate crm <pre-contact> then back to <latest> — names from showmigrations
```

- [ ] **Step 3: Frontend** — from `frontend/`: `npx tsc --noEmit`; `npx vitest run`; `npm run lint -- --no-cache` → all clean.

- [ ] **Step 4: Production build** — `docker compose exec -e NODE_ENV=production frontend sh -c "npm run build"` → exit 0; `/crm/contacts` and `/crm/deals` render real (no ComingSoon).

- [ ] **Step 5: CI deny-list** — from `backend/`: `grep -vc '^#\|^$' ci-known-failures.txt` → `0`.

---

## Notes for the implementer

- **Response envelope** `{success, data}`; backend tests read `.json()["data"]` (lists → `.data.items`).
- **Permission gating** reads the JWT `permissions` claim; empty claim → DB fallback → a fresh test user with no roles is denied (use for 403 tests).
- **No `any`, no `console.log`.** App Router pages export only the default component. React Query v5.
- **Slugs already seeded** (Phase 0): `crm.contacts.{view,create,edit}`, `crm.deals.{view,create,edit,change_stage,close}` — no seed changes.
- **Stage moves:** open→open via `change_stage`; →won/lost via `close` (reason required on lost). The board's `onCardMove` routes by target stage; the backend enforces the same rule.
