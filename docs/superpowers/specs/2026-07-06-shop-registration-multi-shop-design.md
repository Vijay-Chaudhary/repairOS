# Shop-aware registration + multi-shop management — Design

## Problem

Today, tenant registration (`/register` → `RegisterView` → `RegisterVerifyView` → async provisioning) auto-creates exactly one `Shop` per tenant with placeholder data: `name` copied from the business name, `address`/`city` hardcoded to `"TBD"`, `state`/`state_code` hardcoded to Karnataka/`09`. There is no API endpoint to create a shop at all — `backend/apps/core/shop_urls.py` only wires `ShopListView` (GET) and `ShopDetailView` (GET/PATCH). So although the `Shop` model's docstring says "one tenant may have many shops," and the frontend already has multi-shop scaffolding (`useActiveShopStore`, the `ShopSwitcher` in `AppShell.tsx`), a tenant can in practice never have more than the single auto-created shop.

Shop is a required, `PROTECT`-ed foreign key on nearly every operational model (`RepairJob`, `Sale`, `InventoryStock`, plus CRM/HR/AMC/procurement/finance/billing models), so getting the first shop right at registration — and making it possible to add more later — is foundational.

## Goals

1. Registration asks for a real shop name and uses it to create the tenant's first shop (instead of copying the business name with a placeholder address).
2. Tenant Admins can add additional shops after registration, from a proper management UI, subject to the tenant's subscription plan limit.
3. No changes required to downstream operational models — they already scope correctly to `shop` via the existing `activeShopId` mechanism once more than one shop exists.

## Non-goals

- Changing the shop's role/permission model for anything beyond "who can create/manage shops" (Tenant Admin only).
- Backfilling or migrating existing single-shop tenants — no schema change is needed; they already have one shop and gain the ability to add more.
- Building generic multi-instance/"scoped resource" infrastructure beyond shops (YAGNI — no other entity needs this today).
- Async/Celery-based shop provisioning — a shop is a row in the tenant's already-existing database, not a new database, so creation is a plain synchronous CRUD operation.

## 1. Registration flow changes

**Frontend** (`frontend/src/app/(marketing)/register/page.tsx`): add a `shop_name` field to the step-1 form. It defaults to `business_name` and stays synced until the user manually edits it — same auto-sync pattern already used for the `slug` field (lines 331–341). Non-empty validation only; no new failure modes.

**Backend** (`backend/apps/master/`):
- `RegisterTenantSerializer` (`serializers.py:110`) gains an optional `shop_name` field, falling back to `business_name` when omitted (covers direct API callers that don't send it).
- The value is stored in the same pending-registration cache blob as the other step-1 fields and threaded through `register_tenant()` → `do_provision_tenant()` → `_create_default_shop()` (`services.py:578`), which uses `shop_name` for the shop's `name` instead of always reusing `tenant.name`.
- `code` is auto-derived from `shop_name` using the same derivation approach `_create_default_shop` already uses today (derived from the slug).
- `address`/`city`/`state`/`state_code`/`phone` remain today's placeholders — unchanged behavior, edited later by the owner via the shop's detail page.

## 2. Backend — add-shop endpoint

New additions in `backend/apps/core/`:

- **`ShopCreateSerializer`**: `name` (required), `code` (optional — auto-derived from `name` if blank, e.g. "Sunrise Repairs - Whitefield" → `SRWHIT`; validated unique against `Shop.code`), `address`, `city`, `state` (validated against a state → `state_code` lookup), `phone` (all required — this form collects full shop details, unlike registration). `email`/`gstin`/`lat`/`lng`/`working_hours` stay optional, editable later via the existing `ShopDetailView` PATCH.
- **`ShopCreateView`** (`POST /api/v1/shops/`, wired into `shop_urls.py` alongside the existing views): `permission_classes` restrict creation to the Tenant Admin role.
- **Plan-limit enforcement**: before creating, checks the tenant's `SubscriptionPlan.max_shops` (existing field on `apps/master/models.py:90`, currently unused anywhere in the codebase) against the tenant's current shop count. If `max_shops` is not null and the count is at/over the limit, return `403` with a message identifying the plan and limit (e.g. `"Your Starter plan allows 1 shop. Upgrade to add more."`).
  - **Lookup mechanism**: a standalone helper (e.g. `get_tenant_max_shops(slug)` in `apps/core/services.py`) queries `TenantSubscription.objects.using("default").select_related("plan").get(tenant__slug=slug)` against the master DB, cached in Redis with the same short-TTL pattern `TenantMiddleware._load_db_config` already uses (`apps/core/middleware.py:120`). Called directly by `ShopCreateView` — the shared `TenantMiddleware` is not modified, keeping this change scoped to the one place that needs it.
- **Code uniqueness**: `Shop.code` already has `unique=True` at the DB level (each tenant has its own physical database, so this is unique per-tenant automatically). `ShopCreateView` pre-checks uniqueness for a clean `409`, and also catches `IntegrityError` as a backstop against concurrent creation races with the same derived code.

No changes needed to `RepairJob`, `Sale`, `InventoryStock`, etc. — they already have `shop = ForeignKey(..., on_delete=PROTECT)` and scope through the existing `activeShopId` frontend mechanism.

## 3. Frontend — Settings → Shops page

Replaces the current single-shop edit page (`frontend/src/app/(app)/settings/shop/page.tsx`, currently bound implicitly to the active shop) with a list page:

- **List view**: fetches all shops via the existing `settingsApi.listShops()`, renders each as a card (name, city, active/inactive badge). Clicking a card opens the existing per-shop edit form, now parameterized by shop id.
- **"+ Add shop" button** (visible to Tenant Admins only, hidden for other roles via a component-level role check): opens a dialog with the full-detail form (name, code — pre-filled/editable, address, city, state dropdown, phone). On submit, calls `POST /shops/`; on success, closes the dialog, refetches the list, and pushes the new shop into `useActiveShopStore` via `setShops` so it appears immediately in the header `ShopSwitcher` without a page reload.
- **Plan-limit error**: shown inline in the dialog (not a toast), naming the plan and limit, so the user understands why and knows to go to Billing to upgrade.
- The existing header `ShopSwitcher` (`AppShell.tsx:297`) is unchanged — it already supports switching between multiple shops and hiding itself when a tenant has only one; it just starts actually getting used once tenants can have more than one shop.

## 4. Error handling

| Case | Where | Response |
|---|---|---|
| Empty `shop_name` at registration | Frontend form validation | Standard inline field error, same as other required registration fields |
| Duplicate `code` on add-shop | `ShopCreateView` | `409`, inline dialog error naming the conflicting code |
| Concurrent creation race on same derived code | `ShopCreateView` (`IntegrityError` catch) | `409`, same message as the pre-check |
| Plan shop limit reached | `ShopCreateView` | `403`, inline dialog error naming plan + limit |
| Non-admin attempts creation | `ShopCreateView` permission check | `403`, standard permission-denied response |

## 5. Testing

**Backend** (pytest + pytest-django):
- Registration: assert the created shop's `name` matches submitted `shop_name` (not a business-name fallback, when provided).
- `ShopCreateView`: happy path; non-admin rejected (403); plan limit reached (403); duplicate code (409); code auto-derivation from name.

**Frontend** (Vitest + RTL):
- Registration form: new `shop_name` field renders, defaults from and syncs with `business_name` until manually edited.
- Settings → Shops: list renders cards; add-shop dialog validation; plan-limit error displays inline; `useActiveShopStore` picks up a newly created shop and reflects it in the header switcher.

## Open items for the implementation plan

- Exact state → `state_code` lookup table/source (small constant map, likely already implied elsewhere by the `state_code` help text on the `Shop` model).
- Precise Tenant Admin permission-class name to reuse for `ShopCreateView` (matching whatever already gates other admin-only actions in `core`/`settings_views.py`).
