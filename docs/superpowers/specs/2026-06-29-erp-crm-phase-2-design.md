# ERP/CRM Blueprint — Phase 2 Design (Global Search ⌘K + Notification Center)

**Date:** 2026-06-29
**Status:** Approved design — ready for implementation planning
**Parent spec:** `docs/superpowers/specs/2026-06-29-erp-crm-navigation-design.md` (§4b, §4c, §5 roadmap Phase 2)
**Predecessors:** Phase 0 (nav + header shells, PR #22), Phase 1 (Outstanding/Cash Book/Taxes/Reports, PR #23).

---

## 1. Scope

Two independent "daily-UX leverage" features that fill the Phase-0 header shells (the ⌘K palette
shell and the notification bell shell already exist in `AppShell.tsx`, and the ⌘K keyboard
handler is already wired at `AppShell.tsx:341`).

| Feature | Home | Net-new model? | Footprint |
|---|---|---|---|
| A. Global Search (⌘K) | header palette | no | aggregator endpoint + palette UI |
| B. Notification Center | header bell | **yes (`core.Notification`)** | model + API + 5 producers + bell UI |

Both live in the **`core`** app (alongside `NotificationLog`). No new Python/JS dependency — the
palette is a lightweight custom component, not `cmdk`.

**Locked decisions (from brainstorming):**
- Search covers **all 8 entities** (per blueprint): Customers, Leads, Jobs, Invoices, Products,
  Technicians (Employees), Payments, Purchase Orders.
- Notification producers = **in-request 3** (job status change, new lead, payment received) **+
  scheduled 2** (low-stock alert, AMC-renewal-due).
- **Recipient model:** notify the record's assignee/creator; where there is no specific assignee
  (and for the two scheduled producers), fall back to permission-holders in the shop.
- **Delivery:** polling for v1 (React Query `refetchInterval`); WebSocket/Channels deferred.

**Out of scope:** `@mention` and task-assigned producers (Tasks module unbuilt — Phase 6),
WebSocket push, full-text/trigram search (indexed `icontains` only this pass).

---

## 2. Feature A — Global Search (⌘K)

### Backend — `GET /api/v1/search/?q=<term>`

- New `core.SearchView` (`APIView`, `IsAuthenticated`; **no dedicated permission** — per-type
  gating below). Mounted at `/api/v1/search/` via `core.urls`.
- Reject `len(q.strip()) < 2` with an empty result set (`{"results": []}`).
- For each of the 8 entity types, **only if the caller's JWT `permissions` claim contains the
  type's view slug**, run an indexed `icontains` over its field set, shop-scoped (mirror each
  source module's existing `_shop_ids_from_token` logic), ordered by recency, **capped at 5 rows**.
- Result envelope: `{"results": [{type, id, label, sublabel, route}, ...]}` (flat list, ordered
  by a fixed type priority; the FE groups by `type`).

| `type` | Permission gate | `icontains` fields | label / sublabel | route |
|---|---|---|---|---|
| `customer` | `crm.customers.view` | name, phone | name / phone | `/customers/{id}` |
| `lead` | `crm.leads.view` | name, phone | name / phone | `/leads/{id}` |
| `job` | `repair.jobs.view` | job_number, device_brand, device_model, customer__name | job_number / device + customer | `/jobs/{id}` |
| `invoice` | `billing.repair_invoices.view` | invoice_number, customer__name | invoice_number / customer | `/invoices/{id}` |
| `product` | `erp.products.view` | name, sku | name / sku | `/products/{id}` |
| `technician` | `hr.employees.view` | full_name/name, phone | name / role | `/hr/employees/{id}` |
| `payment` | `billing.payments.record` | reference_id, razorpay_payment_id | amount / method | `/payments` |
| `purchase_order` | `erp.purchase_orders.create` | po_number, supplier__name | po_number / supplier | `/purchases/{id}` |

- Logic in `core/services.py` (`global_search(term, token) -> list[dict]`) with one small helper
  per entity. Views stay thin. `select_related` on the joined display fields (no N+1).
- **Security:** gating is by the JWT `permissions` claim, identical to how `require_permission`
  reads it. A type the caller cannot view is silently skipped (never leaks rows or counts).

> **Plan-time confirmations** (exact field/model names): Product `sku` field name; Employee model
> name + name field (`full_name` vs `name`) and its route; `PurchaseOrder` model name + `po_number`
> field in `apps/procurement`; each module's shop-scoping helper. Use the real names; do not invent.

### Frontend — fill the palette shell

- Replace `frontend/src/components/shared/CommandPalette.tsx` body: a debounced (250 ms) controlled
  input → React Query `useQuery` on `['search', q]` (enabled when `q.length >= 2`,
  `keepPreviousData`) → results grouped by `type` with section headers.
- Keyboard nav: ↑/↓ move highlight, Enter navigates (`router.push(route)`) and closes; Esc closes
  (Dialog already handles Esc). Mouse hover/click also selects.
- Empty/short-query state: show a hint ("Type at least 2 characters"); no-results state per query.
- New `searchApi.query(q)` client + typed `SearchResult`. The ⌘K open handler and the palette
  mount in `AppShell` already exist — only the palette internals change.

---

## 3. Feature B — Notification Center

### Model — `core.Notification` (tenant DB)

Reversible migration. Fields:
- `id` (UUID pk), `recipient` (FK `authentication.User`, `related_name="notifications"`),
- `type` (`CharField`, e.g. `job_status` / `new_lead` / `payment_received` / `low_stock` /
  `amc_renewal_due`),
- `title` (`CharField`), `body` (`TextField`, blank ok), `route` (`CharField`, blank ok),
- `read_at` (`DateTimeField`, null/blank), `created_at` (from base model),
- Meta: `db_table = "notifications"`, index `(recipient, read_at)`, `ordering = ["-created_at"]`.

Distinct from `core.NotificationLog` (outbound WhatsApp/email/SMS dispatch log).

### API (all scoped to `request.user`; `IsAuthenticated`, no special permission)

Mounted under `/api/v1/notifications/`:
- `GET /notifications/` — own notifications, newest first, paginated; `?unread=true` filters to
  `read_at__isnull=True`.
- `GET /notifications/unread-count/` — `{"count": <int>}`.
- `POST /notifications/{id}/read/` — set `read_at=now()` (404 if not the caller's).
- `POST /notifications/read-all/` — mark all the caller's unread as read.

Serializer exposes `id, type, title, body, route, read_at, created_at`.

### Producer infrastructure (`core/services.py`)

- `users_with_permission(codename, shop_ids=None)` →
  `User.objects.filter(user_roles__role__role_permissions__permission__codename=codename)` plus
  `user_roles__shop_id__in=shop_ids` when scoping; `.distinct()`.
- `record_notifications(users, *, type, title, body, route, exclude=None)` — bulk-create one
  `Notification` per distinct user, skipping `exclude` (the actor). No-op on empty recipients.
- `notify_dedup(user, type, route)` — true if an **unread** notification of the same `type`+`route`
  already exists for the user (used by scheduled producers so nightly re-runs don't pile up).

### Producers

**In-request** (called inside the existing service, inside the same transaction where reasonable):

1. **Job status change** — in `repair.services.transition_job(job, to_status, user, …)`
   (`apps/repair/services.py:143`). Recipients: `job.assigned_technician` + `job.created_by`,
   exclude `user`. Title e.g. "Job {job_number} → {status}", route `/jobs/{id}`.
2. **New lead** — at the lead-creation call site (service or view; confirm at plan time).
   Recipient: `lead.assigned_to` if set, else `users_with_permission("crm.leads.view", [lead.shop_id])`,
   exclude the creating user. Route `/leads/{id}`.
3. **Payment received** — in `billing.services.record_payment(invoice, data, user)`
   (`apps/billing/services.py:221`). Recipients: `invoice.job.assigned_technician` +
   `invoice.job.created_by`, exclude `user`. Title "Payment ₹{amount} received", route
   `/invoices/{invoice_id}`.

**Scheduled** (Celery beat, per-tenant — mirror the existing `_set_tenant_context` + tenant loop
pattern in `apps/*/tasks.py`; register in `config/settings/base.py` `CELERY_BEAT_SCHEDULE`):

4. **Low-stock** — new `core.scan_low_stock` (daily). For each shop, find stock rows at/below their
   reorder threshold; recipients `users_with_permission("erp.inventory.view", [shop_id])`; dedup via
   `notify_dedup`. Route `/inventory`.
5. **AMC-renewal-due** — new `core.scan_amc_renewals` (daily), or extend the existing
   `amc.send_renewal_reminders`. For contracts whose renewal is due within the existing reminder
   window, recipients `users_with_permission("amc.contracts.view", [shop_id])`; dedup. Route `/amc`.

> **Plan-time confirmations:** the low-stock threshold field (`InventoryStock` reorder level) and
> the AMC contract renewal-date field + reminder window already used by `amc.send_renewal_reminders`.
> Reuse the existing definitions; do not introduce a second notion of "due".

### Frontend — fill the bell shell

- Replace the bell `DropdownMenuContent` stub in `AppShell.tsx`:
  - Unread-count badge on the bell, from `useQuery(['notifications','unread-count'])` with
    `refetchInterval: 45_000` (poll). Badge hidden at 0.
  - Dropdown lists recent notifications (title, body, relative time, unread dot). Clicking an item
    marks it read (`POST …/read/`), closes the menu, and `router.push(route)`.
  - "Mark all read" action (`POST …/read-all/`) invalidating both queries.
- New `notificationsApi` client (`list`, `unreadCount`, `markRead`, `markAllRead`) + typed
  `Notification`. Extract the dropdown into `components/shared/NotificationBell.tsx` to keep
  `AppShell.tsx` from growing (it is already large).

---

## 4. Cross-Cutting Requirements

- Per project rules: serializer + `permission_classes` + tests on every endpoint; business logic in
  `services.py`; `select_related`/`prefetch_related` — no N+1; TypeScript strict, no `any`; Tailwind;
  React Query for server state.
- **Multi-tenant:** `Notification` rows live in the tenant DB; scheduled tasks iterate tenants and
  set tenant context (existing pattern). Search is tenant- and shop-scoped. No hardcoded tenant/shop ids.
- **Tests (before merge):**
  - Search: permission gating (a type the caller lacks is absent from results), min-length, cap of
    5/type, shop scoping.
  - Notifications API: own-scoping (cannot read/mark another user's), unread filter + count, mark
    read / read-all.
  - Producers: each in-request producer creates rows for the right recipients and excludes the actor;
    scheduled producers create rows and are idempotent across two runs (dedup).
  - Frontend (Vitest): search-results grouping/permission-empty rendering; bell unread badge + mark-read.
- **Migration** (`Notification`) reversible. **Production build** must pass with `NODE_ENV=production`;
  App Router pages export only the default component (Phase-0 lesson).

---

## 5. Build Order (independent task-groups)

Search and Notifications are independent and may ship as separate PRs.

1. Search backend (aggregator + per-type helpers + tests).
2. Search frontend (palette internals + client).
3. Notification model + API + tests.
4. Notification frontend (bell badge + dropdown + `NotificationBell.tsx`).
5. In-request producers (job status, new lead, payment) + tests.
6. Scheduled producers (low-stock, AMC-renewal) + beat registration + tests.

---

## 6. Verification (Phase-2 exit criteria)

- `tsc --noEmit` clean · lint clean · all Vitest tests pass (incl. new guards).
- Backend `pytest apps/core apps/repair apps/billing apps/crm apps/inventory apps/amc` passes
  (plus the new search/notification tests).
- `Notification` migration applies and reverses cleanly.
- Production build (`NODE_ENV=production`) succeeds; ⌘K returns live results and the bell shows a
  live unread count (no stubs).
- CI deny-list unchanged (comments-only).
