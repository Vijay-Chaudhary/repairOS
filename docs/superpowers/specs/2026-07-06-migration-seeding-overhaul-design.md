# Migration & Seeding Overhaul — Design

**Date:** 2026-07-06
**Status:** Approved (brainstormed with Vijay; scope, seed trigger, idempotency, and architecture chosen explicitly)

## Why

Three real failures on 2026-07-06 exposed structural problems:

1. `migrate_all_tenants` failed 16/16 with `relation "tax_rates" does not exist` — its worker
   threads never set tenant context, so data migrations that query through the router hit the
   master DB. Three shipped migrations have unpinned ORM queries: `billing/0003` (GST slab
   seed), `hr/0003` (department backfill), `repair/0002` (shop backfill).
2. Local tenant DBs had silently drifted (Phase 7 HR migration never applied), and nothing
   reported it.
3. A drifted tenant DB made `seed_demo` throw during container startup, and `entrypoint.sh`
   (`set -euo pipefail`) crash-looped the whole backend on it. `seed_demo.py` is a 1,775-line
   monolith run on **every** start.

## Decisions (locked during brainstorming)

- **Scope:** full overhaul — migration correctness + drift visibility + seeding framework.
- **Seed trigger (dev):** auto on container start **only when not yet seeded**; manual afterwards.
- **Idempotency:** upsert by natural keys as the default; explicit `--reset` for factory-fresh.
- **Architecture:** per-app seeder registry (not a function split, not fixtures).
- **Indian market:** GST rates / INR flavor is a first-class **reference tier** seeded for every
  tenant, not just demo.

---

## 1. Migration correctness

### 1a. Pin DB aliases in the three data migrations
Every ORM call inside `RunPython` of `billing/0003_taxrate.py`, `hr/0003_backfill_department_ref.py`,
and `repair/0002_spare_part_shop_and_optional_job.py` is pinned to
`schema_editor.connection.alias` (`.objects.using(alias)`, `.db_manager(alias)` for
`get_or_create`). Editing the applied migration files in place is safe: semantics are unchanged,
no new migration is created, already-migrated databases are unaffected.

### 1b. Tenant context in `migrate_all_tenants`
`_migrate_one` sets `core.context.set_tenant_db_alias(alias)` before `call_command("migrate", …)`
and clears in `finally`. `core.context` stores per-thread/per-ContextVar, so parallel workers stay
independent. Defense-in-depth on top of 1a — protects against future unpinned queries too.

The tenant-alias registration block (build connection dict from `TenantDatabase`, insert into
`connections.databases`) moves from `migrate_all_tenants` into a shared helper
`master/services.py::ensure_tenant_alias(tenant_db) -> str` used by every command that talks to a
tenant DB (`migrate_all_tenants`, the new doctor, `seed_demo`).

### 1c. Alias-leak guardrail (CI)
A pytest registers a scratch second SQLite alias, runs `call_command("migrate",
database=<scratch>)` with **no** tenant context, while capturing queries on the `default`
connection (`CaptureQueriesContext`). Any migration that leaks a query to `default` fails the
build. This makes the whole bug class unshippable.

## 2. Drift visibility — `check_tenant_migrations`

New management command ("doctor"). For each active tenant DB (via `ensure_tenant_alias`), build
Django's `MigrationExecutor` against that connection and collect the unapplied migration plan.

- Output: one line per tenant — slug, behind-by count, and the `app.migration` names when behind.
- `--fail-on-drift`: exit non-zero if any tenant is behind (deploy/CI gate).
- Read-only; never applies anything.
- Wiring it into the production deploy script is ops' call and out of scope here.

## 3. Seeding framework

### 3a. Framework (`backend/apps/core/seeding/`)
- `base.py` — `Seeder` base class: `name: str`, `scope: "reference" | "demo"`,
  `depends_on: tuple[str, ...]`, `run(shop)`. Contract: `run` **upserts by natural keys**
  (code, phone, document number) — never blind-creates.
- `registry.py` — autodiscovers `apps/<app>/seeds.py` for installed apps (Celery-`tasks.py`
  pattern), topologically sorts by `depends_on`, raises at load time on cycles or unknown names.

### 3b. Two tiers
- **`reference`** — Indian-market baseline for **every** tenant:
  - GST slab `TaxRate`s (0/5/12/18/28%), same natural keys as `billing/0003`, healing tenants
    that predate the migration or lost rows;
  - default Chart of Accounts + account mappings (wraps existing
    `accounts.seed_default_chart` / `seed_default_mappings`);
  - no new currency model — INR is already the platform's implicit currency.
  - `create_tenant` runs the reference tier at provisioning, so real tenants start complete.
- **`demo`** — fake business data for the demo tenant only, ported from `seed_demo.py` along its
  existing section boundaries into per-app `seeds.py` (`crm/seeds.py`, `repair/seeds.py`, …).
  Contract (pinned so it survives the port): ₹ amounts, `+91` phone numbers, GSTIN-formatted tax
  IDs consistent with the shop's `state_code`, HSN codes on inventory products, Indian
  names/cities.

### 3c. Tracking — `SeedRun`
Small model in `core` (lives in each tenant DB; the project's one new migration):
`seeder_name` (unique) + `seeded_at`. Gives resume semantics — a partial seed re-runs only what's
missing instead of being wrongly treated as done.

### 3d. The `seed_demo` command (thin runner)
Runs inside tenant context (`ensure_tenant_alias` + context token). Flags:
- *(default)* run registered seeders lacking a `SeedRun` row, dependency-ordered (resume);
- `--force` — re-run all (safe: upsert);
- `--only <name>` — one seeder, for development;
- `--reset` — drop + reprovision the demo tenant DB through the existing `create_tenant`
  machinery, then seed fresh;
- `--if-empty` — exit 0 immediately when every registered seeder has a `SeedRun` row
  (entrypoint fast path).
Per-seeder try/except with an end-of-run summary; exit non-zero if any seeder failed.

## 4. Entrypoint & error handling

Dev `entrypoint.sh` becomes:
1. migrate master (`--database=default`)
2. **migrate all tenant DBs** (new step — kills drift at the source)
3. `create_tenant` demo + testshop (idempotent, as today; now also seeds reference tier)
4. `seed_demo --if-empty || loud red warning` — **non-fatal**; a broken seeder can no longer
   crash-loop the backend
5. daphne

`entrypoint.production.sh` is untouched apart from inheriting the `migrate_all_tenants` fix.

## 5. Testing

- Registry: topo order respected; cycle and unknown-dependency rejection.
- Seeder idempotency: run reference + demo seeders twice → identical row counts.
- Alias-leak guardrail test (§1c).
- Doctor: report shape when in sync; `--fail-on-drift` exit code when a tenant is behind
  (simulated by unapplying/faking a migration record on the scratch alias).
- `migrate_all_tenants`: context set during `_migrate_one` and cleared after (assert via a stub
  migration/command hook).
- Backend pytest only; no frontend surface.

## Out of scope

- Wiring `--fail-on-drift` into the production deploy pipeline (ops decision).
- Rewriting demo data content (port, don't redesign).
- Multi-currency support.
- Fixture-file based seeding (rejected: fights multi-DB routing and dynamic dates).
