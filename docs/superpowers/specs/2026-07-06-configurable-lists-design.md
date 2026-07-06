# Configurable Lists (Reference Dropdown Data) — Design

**Date:** 2026-07-06
**Status:** Approved (brainstormed with Vijay)
**Depends on:** `2026-07-06-migration-seeding-overhaul-design.md` (uses its seeder framework; implement after that plan ships)

## Why

"Which data must always be in the database?" — the dropdown audit found three categories:

1. **Code enums (~60 `TextChoices`)**: statuses, payment methods, priorities, GST tax type,
   leave/employment types, etc. Ship in code; never DB. Currency is INR-only by design — a
   constant, not a list.
2. **Existing lookup tables**: TaxRate + chart of accounts (covered by the seeding overhaul's
   reference tier); product categories, departments, budget heads, commission rules
   (tenant-managed domain tables with their own UIs); notification templates (31 definitions in
   code, DB rows are lazy per-tenant overrides — no gap).
3. **Free-text fields that should be configurable dropdown lists but have no backing data** —
   the gap this feature closes: device types, device brands, expense/petty-cash categories,
   asset categories, customer tags.

Plus one provisioning gap found during the audit: **`master.SubscriptionPlan` is only created by
`seed_demo`** — `create_tenant` hard-fails on a fresh master DB (`Plan 'starter' not found`).

### Extended audit (roles, commissions, WhatsApp, segments, users, fault templates)

- **Roles + permissions**: seeded at provisioning (7 system roles + ~120-permission catalogue in
  `master.services._seed_roles_and_permissions`), but tenants provisioned in earlier phases miss
  later-added permissions — the reason `backfill_role_permissions` exists. → becomes a
  reference-tier **healer seeder** (§4) so every seed run tops up older tenants.
- **Commission rules**: no rule ⇒ no commission created; jobs close fine. Any seeded default
  would silently pay out money. **Intentionally excluded** — tenant-configured.
- **WhatsApp**: template definitions live in code; `NotificationTemplate`, `WhatsAppConnection`
  and `TenantSettings` are lazy `get_or_create` singletons/overrides. No gap.
- **Customer segments**: new tenants start with zero — → seed **3 starter dynamic segments**
  (§4), pairing with the seeded `customer_tags`.
- **Default users**: provisioning creates exactly one Tenant Admin; automated actors are
  nullable everywhere, so no bot/system user is needed. No gap.
- **Fault templates**: per-**shop** with a mandatory `default_sc` price — generic seeds would
  plant wrong prices. **Intentionally excluded.**
- **Document counters**: created on demand (`DocumentCounter.next` does `get_or_create`). No gap.

### UI-side sweep (every `<select>`/combobox verified)

Entity pickers are API-fed; every other dropdown is a code enum; the check-in damage checklist
is fixed boolean model fields. Two findings:

- **Indian states**: fixed statutory data — stays in **code**, but `INDIA_STATES` is duplicated
  in `onboarding/page.tsx` and `settings/shop/page.tsx` with no GST state-code mapping. →
  §5 adds a shared `frontend/src/lib/constants/indiaStates.ts` exporting `{name, gst_code}`
  pairs; both pages consume it (and can auto-fill `state_code` from the selected state).
- **Onboarding role dropdown** hardcodes 3 of the 7 seeded system roles instead of using the
  roles API — frontend wiring quirk, not a data gap. Observation only; not fixed here.

## Decisions (locked during brainstorming)

- Build the **configurable-lists feature** (not defaults-only, not a doc).
- **Soft binding**: consuming fields keep storing plain text; forms offer configured options with
  add-new. No FK migrations, no backfills. (Hard enforcement is a possible later phase.)
- **Per-tenant** lists (per-tenant DB ⇒ automatic), not per-shop.
- **One `ConfigOption` model; list types live in a code registry** — tenants manage entries, not
  list types.

---

## 1. Data model — `core.ConfigOption`

```python
class ConfigOption(BaseModel):
    list_key   = models.CharField(max_length=40, choices=<from LIST_REGISTRY>)
    value      = models.CharField(max_length=120)
    sort_order = models.PositiveSmallIntegerField(default=0)
    is_active  = models.BooleanField(default=True)    # deactivate ≠ delete
    is_system  = models.BooleanField(default=False)   # seeded default; not deletable

    class Meta:
        unique_together = (("list_key", "value"),)
        ordering = ["list_key", "sort_order", "value"]
```

Deactivating an option hides it from dropdowns; rows already storing that text are untouched
(soft binding). Migration is a plain reversible `CreateModel`.

## 2. `LIST_REGISTRY` (code, `backend/apps/core/config_lists.py`)

The definitive catalog. Each entry: key, label, consumer fields, seeded Indian defaults.

| list_key | Consumers (soft) | Seeded defaults (`is_system=True`, in this order) |
|---|---|---|
| `device_types` | `repair.JobTicket.device_type`, `crm.Lead.device_type` (job wizard, lead form) | Mobile, Laptop, Desktop, Tablet, TV, AC, Refrigerator, Washing Machine, Printer, Smartwatch, Speaker, Camera, Other |
| `device_brands` | `repair.JobTicket.device_brand`, `inventory.Product.brand` | Samsung, Apple, Xiaomi, Vivo, Oppo, Realme, OnePlus, Motorola, HP, Dell, Lenovo, Asus, Acer, LG, Sony, Whirlpool, Godrej, Voltas, Haier, Canon, Epson, Other |
| `expense_categories` | `finance.Expense.category`, `finance.PettyCashTransaction.category` | Rent, Salaries, Electricity, Internet & Phone, Spare Parts Purchase, Tools & Equipment, Transport & Fuel, Marketing, Stationery, Refreshments, Repairs & Maintenance, Bank Charges, Miscellaneous |
| `asset_categories` | `finance.ShopAsset.category` | Furniture, Tools & Equipment, Electronics, Computers, Vehicles |
| `customer_tags` | `crm.Customer.tags` (suggestions) | VIP, Regular, Wholesale, Corporate, AMC, Warranty, Referral |

Adding a future list type = one registry entry + one seeded-defaults tuple; no migration.

## 3. API

- `GET /api/v1/config/lists/` — every list with its **active** options in sort order, one
  response (form bootstrapping; React-Query cached). Any authenticated tenant user.
- `POST /api/v1/config/lists/{list_key}/options/` — create (used by both the settings page and
  the "add new" affordance in forms).
- `PATCH /api/v1/config/options/{id}/` — rename / reorder / activate / deactivate.
- `DELETE /api/v1/config/options/{id}/` — hard delete; **422 for `is_system` rows** (deactivate
  instead).
- Write endpoints gated on the existing settings-management permission (same one the
  templates/branding settings pages use); serializer + permission_classes + tests per house
  rules. Errors: unknown `list_key` → 404; duplicate `(list_key, value)` → 422 in the standard
  error envelope.

## 4. Seeding

Three new reference-tier seeders (framework from the overhaul plan; all run for every tenant at
provisioning and via `seed_demo`):

- **`core.config_options`** (`core/seeds.py`): upsert each registry default by
  `(list_key, value)`; existing rows are left untouched — **a deactivated system row is never
  resurrected**.
- **`authentication.roles_permissions`** (`authentication/seeds.py`): wraps the existing
  idempotent `master.services._seed_roles_and_permissions()` so tenants provisioned before new
  permissions were added get healed on every seed run (replaces ad-hoc
  `backfill_role_permissions` runs; that command stays for targeted use).
- **`crm.starter_segments`** (`crm/seeds.py`, depends on `core.config_options`): three dynamic
  starter segments, upserted by name, created only if absent (they are ordinary deletable
  segments — no `is_system` field on `CustomerSegment`):
  - *VIP Customers* — `{"tags": ["VIP"]}`
  - *Business Customers* — `{"customer_type": "business"}`
  - *High Value* — `{"min_total_billed": 10000}`

Plus, master-DB side:

- **`seed_plans` management command**: idempotent `get_or_create` of
  starter/professional/enterprise using the plan values currently in
  `seed_demo._seed_subscription`. Called by the dev entrypoint before `create_tenant`;
  documented in the prod runbook. Closes the fresh-install provisioning failure.

## 5. Frontend

- **`ConfigSelect`** (`frontend/src/components/shared/ConfigSelect.tsx`): combobox for a given
  `list_key`, fed by the cached lists query. Shows active options in order; free typing allowed
  (soft binding); users with the manage permission get an "Add ‹typed value›…" row that POSTs
  and selects. Mobile-first.
- **Form adoption** (input swap only, no schema/API changes): job wizard + lead form
  (`device_types`, `device_brands`); expense + petty-cash forms (`expense_categories`);
  shop-asset form (`asset_categories`); customer tag input (`customer_tags` suggestions).
- **Settings → Lists** (`/settings/lists`): the five lists on one screen — add, rename,
  reorder, activate/deactivate; system rows show a lock instead of delete. Follows the existing
  settings-page patterns (React Query, permission gate, Tailwind, PWA).
- **Shared India-states constant**: `frontend/src/lib/constants/indiaStates.ts` exporting
  `INDIA_STATES: {name, gst_code}[]` (statutory list, 36 states/UTs with GST codes);
  `onboarding/page.tsx` and `settings/shop/page.tsx` drop their duplicated inline arrays and
  auto-fill `state_code` from the selection.

## 6. Testing

- Model: unique constraint, ordering.
- API: permission gates, CRUD, system-row delete → 422, unknown list_key → 404, duplicate → 422.
- Seeders: run twice → identical counts; deactivated config row stays deactivated; renamed
  starter segment is not re-created; roles/permissions healer adds a missing permission row.
- Frontend: `ConfigSelect` (options render, free text works, add-new POSTs and selects) and the
  settings page, Vitest + RTL per existing page-test patterns.

## Out of scope (intentional exclusions)

- Hard enforcement (FKs or validate-against-list) — possible later phase.
- Per-shop overrides.
- Tenant-defined *new list types* (registry is code).
- Multi-currency.
- Backfilling/normalising historical free-text values.
- Default commission rules (would silently pay out money — tenant must configure).
- Seeded fault templates (per-shop, price-bearing — wrong defaults are worse than none).
- Bot/system users beyond the provisioned Tenant Admin (nothing requires one).
