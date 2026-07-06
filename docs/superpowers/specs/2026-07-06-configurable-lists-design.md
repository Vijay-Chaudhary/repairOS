# Configurable Lists (Reference Dropdown Data) — Design

**Date:** 2026-07-06
**Status:** Approved (brainstormed with Vijay)
**Depends on:** `2026-07-06-migration-seeding-overhaul-design.md` (uses its seeder framework; implement after that plan ships)

## Why

"Which data must always be in the database?" — the dropdown audit found three categories:

1. **Code enums (~60 `TextChoices`)**: statuses, payment methods, priorities, GST tax type,
   leave/employment types, etc. Ship in code; never DB. Currency is INR-only by design — a
   constant, not a list.
2. **Existing lookup tables**: TaxRate, chart of accounts, roles/permissions (all covered by the
   seeding overhaul's reference tier); product categories, departments, budget heads, commission
   rules (tenant-managed domain tables with their own UIs); notification templates (31
   definitions in code, DB rows are lazy per-tenant overrides — no gap).
3. **Free-text fields that should be configurable dropdown lists but have no backing data** —
   the gap this feature closes: device types, device brands, expense/petty-cash categories,
   asset categories, customer tags.

Plus one provisioning gap found during the audit: **`master.SubscriptionPlan` is only created by
`seed_demo`** — `create_tenant` hard-fails on a fresh master DB (`Plan 'starter' not found`).

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

- New reference-tier seeder `core.config_options` in `core/seeds.py` (framework from the
  overhaul plan): upsert each registry default by `(list_key, value)`; existing rows are left
  untouched — **a deactivated system row is never resurrected**. Runs for every tenant at
  provisioning and via `seed_demo`.
- **`seed_plans` management command (master DB)**: idempotent `get_or_create` of
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

## 6. Testing

- Model: unique constraint, ordering.
- API: permission gates, CRUD, system-row delete → 422, unknown list_key → 404, duplicate → 422.
- Seeder: run twice → identical counts; deactivated row stays deactivated.
- Frontend: `ConfigSelect` (options render, free text works, add-new POSTs and selects) and the
  settings page, Vitest + RTL per existing page-test patterns.

## Out of scope

- Hard enforcement (FKs or validate-against-list) — possible later phase.
- Per-shop overrides.
- Tenant-defined *new list types* (registry is code).
- Multi-currency.
- Backfilling/normalising historical free-text values.
