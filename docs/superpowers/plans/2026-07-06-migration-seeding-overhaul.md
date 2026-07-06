# Migration & Seeding Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make tenant migrations correct and drift visible, and replace the 1,775-line `seed_demo` monolith with a per-app seeder registry with an Indian-market reference tier (per spec `docs/superpowers/specs/2026-07-06-migration-seeding-overhaul-design.md`).

**Architecture:** Part 1 (Tasks 1–4) fixes migration correctness and adds the drift doctor — it is independently shippable. Part 2 (Tasks 5–11) builds the `core.seeding` framework (Seeder base + autodiscovered registry + `SeedRun` tracking), ports demo data into per-app `seeds.py`, rewires `seed_demo` as a thin runner, and makes the dev entrypoint drift-proof and non-fatal.

**Tech Stack:** Django 5.1 / DRF, pytest + pytest-django (SQLite in-memory, `config.settings.test`), bash entrypoint.

**Environment notes:**
- Django root is `backend/` — `cd backend` before pytest/manage.py. Run tests: `python3 -m pytest <path> --no-cov`.
- Branch: `feature/migration-seeding-overhaul` (already exists; spec committed on it).
- Key facts discovered up front (do not re-derive):
  - `core.routers.TenantDatabaseRouter` falls back to `'default'` when no tenant context is set — that is why unpinned migration queries silently hit the master DB.
  - Tests run a single SQLite DB with a pass-through `TestDatabaseRouter` and an autouse `tenant_context` fixture that pre-sets the alias to `'default'` (see `backend/conftest.py`).
  - Apps import bare (`from crm import …`), so app configs' `.name` is `crm`, `billing`, etc.
  - `core.context` exposes `set_tenant_db_alias(alias)`, `get_tenant_db_alias()`, `clear_tenant_context()`.
  - Latest `core` migration is `0008_alter_documentcounter_doc_type` → the new one is `0009_seedrun`.

---

## Part 1 — Migration correctness & drift doctor

### Task 1: `ensure_tenant_alias` helper + tenant context in `migrate_all_tenants`

**Files:**
- Modify: `backend/apps/master/services.py` (append at end)
- Modify: `backend/apps/master/management/commands/migrate_all_tenants.py:65-82` (`_migrate_one`)
- Test: `backend/apps/master/tests/test_tenant_migration_tools.py` (new)

- [x] **Step 1: Write the failing tests**

Create `backend/apps/master/tests/test_tenant_migration_tools.py`:

```python
"""master › ensure_tenant_alias + migrate_all_tenants tenant-context handling."""
import pytest
from django.db import connections


@pytest.fixture
def tenant_db(db):
    from master.models import Tenant, TenantDatabase
    tenant = Tenant.objects.using("default").create(
        name="Ctx Shop", slug="ctxshop", status=Tenant.Status.ACTIVE,
        plan="starter", owner_email="o@x.com", owner_phone="+919876500001",
    )
    td = TenantDatabase(
        tenant=tenant, db_name="ctxshop_db", db_host="localhost",
        db_port=5432, db_user="ctxshop_user",
    )
    td.encrypt_password("secret-pw")
    td.save(using="default")
    return td


@pytest.mark.django_db
def test_ensure_tenant_alias_registers_connection(tenant_db):
    from master.services import ensure_tenant_alias

    alias = ensure_tenant_alias(tenant_db)
    assert alias == "tenant_ctxshop"
    cfg = connections.databases[alias]
    assert cfg["NAME"] == "ctxshop_db"
    assert cfg["USER"] == "ctxshop_user"
    assert cfg["PASSWORD"] == "secret-pw"
    assert cfg["CONN_MAX_AGE"] == 0

    # Idempotent: second call returns same alias without rebuilding.
    connections.databases[alias]["NAME"] = "sentinel"
    assert ensure_tenant_alias(tenant_db) == alias
    assert connections.databases[alias]["NAME"] == "sentinel"

    del connections.databases[alias]


@pytest.mark.django_db
def test_migrate_one_sets_and_clears_tenant_context(tenant_db, monkeypatch):
    from core.context import clear_tenant_context, get_tenant_db_alias
    from master.management.commands.migrate_all_tenants import Command

    clear_tenant_context()  # autouse fixture pre-set 'default'; start clean
    seen = {}

    def fake_call_command(name, **kwargs):
        seen["alias_during_migrate"] = get_tenant_db_alias()
        seen["database_kwarg"] = kwargs.get("database")

    monkeypatch.setattr(
        "master.management.commands.migrate_all_tenants.call_command", fake_call_command
    )
    Command()._migrate_one(tenant_db)

    assert seen["alias_during_migrate"] == "tenant_ctxshop"
    assert seen["database_kwarg"] == "tenant_ctxshop"
    assert get_tenant_db_alias() is None  # cleared afterwards

    del connections.databases["tenant_ctxshop"]
```

- [x] **Step 2: Run to verify failure**

Run: `cd backend && python3 -m pytest apps/master/tests/test_tenant_migration_tools.py --no-cov -v`
Expected: FAIL — `ImportError: cannot import name 'ensure_tenant_alias'`.

- [x] **Step 3: Implement**

Append to `backend/apps/master/services.py`:

```python
def ensure_tenant_alias(tenant_db) -> str:
    """Register (once) and return the connection alias for a TenantDatabase.

    Single code path for every command that talks to a tenant DB
    (migrate_all_tenants, check_tenant_migrations, seed_demo).
    """
    from django.db import connections

    alias = f"tenant_{tenant_db.tenant.slug}"
    if alias not in connections.databases:
        base = dict(connections.databases["default"])
        base.update({
            "NAME": tenant_db.db_name,
            "HOST": tenant_db.db_host,
            "PORT": str(tenant_db.db_port),
            "USER": tenant_db.db_user,
            "PASSWORD": tenant_db.decrypt_password(),
            "CONN_MAX_AGE": 0,
            "OPTIONS": {},
        })
        connections.databases[alias] = base
    return alias
```

Replace `_migrate_one` in `backend/apps/master/management/commands/migrate_all_tenants.py` (delete its old alias-registration block entirely):

```python
    def _migrate_one(self, tenant_db) -> None:
        from core.context import clear_tenant_context, set_tenant_db_alias
        from master.services import ensure_tenant_alias

        alias = ensure_tenant_alias(tenant_db)
        # Data migrations may query through the router; pin the context so any
        # unpinned query lands on this tenant DB instead of master.
        set_tenant_db_alias(alias)
        try:
            call_command("migrate", database=alias, verbosity=0)
        finally:
            clear_tenant_context()
```

- [x] **Step 4: Run to verify pass**

Run: `cd backend && python3 -m pytest apps/master/tests/test_tenant_migration_tools.py apps/master --no-cov -q`
Expected: all PASS.

- [x] **Step 5: Commit**

```bash
git add backend/apps/master/services.py backend/apps/master/management/commands/migrate_all_tenants.py backend/apps/master/tests/test_tenant_migration_tools.py
git commit -m "fix(master): tenant context + shared alias helper in migrate_all_tenants"
```

---

### Task 2: Alias-leak guardrail test (fails until Task 3)

**Files:**
- Test: `backend/apps/core/tests/test_migration_alias_leak.py` (new)
- Modify: `backend/config/settings/test.py` (declare scratch alias)

> **As-built deviations (Django 5.2):** (1) aliases added to `connections.databases` at
> runtime are blocked by the test harness — the scratch alias is declared in
> `config/settings/test.py` with `TEST: {"MIGRATE": False}` and allowed via
> `django_db(databases=[...])`; (2) the test router's `allow_migrate` no-ops every
> operation on a non-default alias, so the test swaps in the production
> `core.routers.TenantDatabaseRouter` via `override_settings`; (3) `transaction=True`
> because SQLite's schema editor can't run inside the wrapping test atomic.

- [x] **Step 1: Write the guardrail test**

Create `backend/apps/core/tests/test_migration_alias_leak.py`:

```python
"""Guardrail: running `migrate` against a second alias with NO tenant context must
not leak a single query to the default (master) connection. Catches data migrations
whose RunPython queries the ORM without pinning schema_editor.connection.alias —
the bug class behind the 2026-07-06 `relation "tax_rates" does not exist` failure."""
import pytest
from django.core.management import call_command
from django.db import connections
from django.test.utils import CaptureQueriesContext

SCRATCH = "alias_leak_scratch"


@pytest.mark.django_db
def test_full_migrate_on_second_alias_leaks_nothing_to_default():
    from core.context import clear_tenant_context

    connections.databases[SCRATCH] = {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": ":memory:",
        "HOST": "", "PORT": "", "USER": "", "PASSWORD": "",
        "CONN_MAX_AGE": 0, "CONN_HEALTH_CHECKS": False, "OPTIONS": {},
        "TIME_ZONE": None, "ATOMIC_REQUESTS": False, "AUTOCOMMIT": True, "TEST": {},
    }
    # No tenant context: the router falls back to 'default', so any unpinned
    # migration query lands on — and is captured from — the default connection.
    clear_tenant_context()
    try:
        with CaptureQueriesContext(connections["default"]) as captured:
            call_command("migrate", database=SCRATCH, verbosity=0)
        leaked = [q["sql"] for q in captured.captured_queries]
        assert leaked == [], f"Migrations leaked queries to the master DB: {leaked}"
    finally:
        connections[SCRATCH].close()
        del connections.databases[SCRATCH]
```

- [x] **Step 2: Run to verify it fails for the right reason** *(leaked: tax_rates ×5, employees, job_spare_part_requests — exactly the three unpinned migrations)*

Run: `cd backend && python3 -m pytest apps/core/tests/test_migration_alias_leak.py --no-cov -v`
Expected: FAIL — `leaked` contains queries against `tax_rates` / `employees` / `job_spare_part_requests` (the three unpinned migrations). If it fails with an unrelated error, stop and investigate before Task 3.

- [x] **Step 3: Commit (red on purpose — goes green in Task 3)**

```bash
git add backend/apps/core/tests/test_migration_alias_leak.py
git commit -m "test(core): alias-leak guardrail for data migrations (red until pinning)"
```

---

### Task 3: Pin DB aliases in the three data migrations

**Files:**
- Modify: `backend/apps/billing/migrations/0003_taxrate.py` (`seed_slabs`, `unseed_slabs`)
- Modify: `backend/apps/hr/migrations/0003_backfill_department_ref.py` (`backfill` + reverse)
- Modify: `backend/apps/repair/migrations/0002_spare_part_shop_and_optional_job.py` (`backfill_shop_from_job`)

Editing applied migration files is safe here: semantics are identical, no new migration is created.

- [x] **Step 1: Pin `billing/0003_taxrate.py`**

```python
def seed_slabs(apps, schema_editor):
    alias = schema_editor.connection.alias
    TaxRate = apps.get_model("billing", "TaxRate")
    for name, rate in GST_SLABS:
        TaxRate.objects.using(alias).get_or_create(
            name=name, defaults={"rate": rate, "tax_type": "gst"}
        )


def unseed_slabs(apps, schema_editor):
    alias = schema_editor.connection.alias
    TaxRate = apps.get_model("billing", "TaxRate")
    TaxRate.objects.using(alias).filter(name__in=[n for n, _ in GST_SLABS]).delete()
```

- [x] **Step 2: Pin `hr/0003_backfill_department_ref.py`**

At the top of `backfill(apps, schema_editor)` add `alias = schema_editor.connection.alias`, then pin **every** queryset in the function (and in the reverse function, same pattern):
- `Employee.objects.using(alias).filter(deleted_at__isnull=True)…` (the `shop_ids` query)
- `Department.objects.using(alias).filter(shop_id=shop_id)…` (the `used_codes` query)
- `Employee.objects.using(alias).filter(shop_id=shop_id, …)…` (the `names` query)
- `Department.objects.using(alias).get_or_create(…)`
- `Employee.objects.using(alias).filter(shop_id=shop_id, department=name, …).update(…)`
- the later cleanup block: `Department.objects.using(alias).all().iterator()`, `Employee.objects.using(alias).filter(…).update(…)`, `Department.objects.using(alias).filter(employees__isnull=True).delete()`

- [x] **Step 3: Pin `repair/0002_spare_part_shop_and_optional_job.py`**

```python
def backfill_shop_from_job(apps, schema_editor):
    alias = schema_editor.connection.alias
    JobSparePartRequest = apps.get_model("repair", "JobSparePartRequest")
    JobTicket = apps.get_model("repair", "JobTicket")
    JobSparePartRequest.objects.using(alias).filter(shop__isnull=True).update(
        shop=Subquery(
            JobTicket.objects.using(alias).filter(pk=OuterRef("job_id")).values("shop_id")[:1]
        )
    )
```

(Keep the existing docstrings and `noop_reverse` as they are.)

- [x] **Step 4: Guardrail goes green + affected app suites pass** *(168 passed; 1 known local-only weasyprint failure in hr test_approve_slip)*

Run: `cd backend && python3 -m pytest apps/core/tests/test_migration_alias_leak.py apps/billing apps/hr apps/repair --no-cov -q`
Expected: all PASS (the guardrail from Task 2 now finds zero leaked queries).

- [x] **Step 5: Commit**

```bash
git add backend/apps/billing/migrations/0003_taxrate.py backend/apps/hr/migrations/0003_backfill_department_ref.py backend/apps/repair/migrations/0002_spare_part_shop_and_optional_job.py
git commit -m "fix(migrations): pin DB alias in RunPython data migrations"
```

---

### Task 4: `check_tenant_migrations` drift doctor

**Files:**
- Create: `backend/apps/master/management/commands/check_tenant_migrations.py`
- Test: `backend/apps/master/tests/test_check_tenant_migrations.py` (new)

- [x] **Step 1: Write the failing tests** *(as-built: reuses the settings-declared `alias_leak_scratch` alias + `django_db(databases=[...])` instead of a runtime-registered `doctor_scratch` — Django 5.2 blocks runtime aliases)*

Create `backend/apps/master/tests/test_check_tenant_migrations.py`:

```python
"""master › check_tenant_migrations drift doctor."""
import pytest
from django.core.management import call_command
from django.db import connections
from io import StringIO

SCRATCH = "doctor_scratch"


@pytest.fixture
def drifted_tenant(db, monkeypatch):
    """An active tenant whose alias points at an empty (fully drifted) SQLite DB."""
    from master.models import Tenant, TenantDatabase

    tenant = Tenant.objects.using("default").create(
        name="Drift Shop", slug="driftshop", status=Tenant.Status.ACTIVE,
        plan="starter", owner_email="d@x.com", owner_phone="+919876500002",
    )
    td = TenantDatabase(
        tenant=tenant, db_name="drift_db", db_host="localhost",
        db_port=5432, db_user="drift_user",
    )
    td.encrypt_password("pw")
    td.save(using="default")

    connections.databases[SCRATCH] = {
        "ENGINE": "django.db.backends.sqlite3", "NAME": ":memory:",
        "HOST": "", "PORT": "", "USER": "", "PASSWORD": "",
        "CONN_MAX_AGE": 0, "CONN_HEALTH_CHECKS": False, "OPTIONS": {},
        "TIME_ZONE": None, "ATOMIC_REQUESTS": False, "AUTOCOMMIT": True, "TEST": {},
    }
    monkeypatch.setattr(
        "master.management.commands.check_tenant_migrations.ensure_tenant_alias",
        lambda tenant_db: SCRATCH,
    )
    yield td
    connections[SCRATCH].close()
    del connections.databases[SCRATCH]


@pytest.mark.django_db
def test_reports_drifted_tenant(drifted_tenant):
    out = StringIO()
    call_command("check_tenant_migrations", stdout=out)
    text = out.getvalue()
    assert "driftshop" in text
    assert "behind" in text


@pytest.mark.django_db
def test_fail_on_drift_exits_nonzero(drifted_tenant):
    with pytest.raises(SystemExit):
        call_command("check_tenant_migrations", "--fail-on-drift", stdout=StringIO())


@pytest.mark.django_db
def test_no_tenants_is_clean(db):
    out = StringIO()
    call_command("check_tenant_migrations", stdout=out)
    assert "No active tenants" in out.getvalue()
```

- [x] **Step 2: Run to verify failure**

Run: `cd backend && python3 -m pytest apps/master/tests/test_check_tenant_migrations.py --no-cov -v`
Expected: FAIL — `Unknown command: 'check_tenant_migrations'`.

- [x] **Step 3: Implement the command**

Create `backend/apps/master/management/commands/check_tenant_migrations.py`:

```python
"""
Drift doctor: report unapplied migrations for every active tenant database.

Usage:
    python manage.py check_tenant_migrations [--fail-on-drift]

Read-only — never applies anything. --fail-on-drift exits non-zero when any
tenant is behind, so it can gate deploys.
"""

from django.core.management.base import BaseCommand
from django.db import connections
from django.db.migrations.executor import MigrationExecutor

from master.services import ensure_tenant_alias


class Command(BaseCommand):
    help = "Report unapplied migrations per active tenant DB (read-only)."

    def add_arguments(self, parser):
        parser.add_argument(
            "--fail-on-drift", action="store_true",
            help="Exit non-zero if any tenant has unapplied migrations.",
        )

    def handle(self, *args, **options):
        from master.models import Tenant, TenantDatabase

        tenant_dbs = list(
            TenantDatabase.objects.using("default")
            .select_related("tenant")
            .filter(tenant__status=Tenant.Status.ACTIVE, is_active=True)
        )
        if not tenant_dbs:
            self.stdout.write("No active tenants found.")
            return

        drifted = 0
        for td in tenant_dbs:
            slug = td.tenant.slug
            try:
                alias = ensure_tenant_alias(td)
                executor = MigrationExecutor(connections[alias])
                plan = executor.migration_plan(executor.loader.graph.leaf_nodes())
                pending = [f"{m.app_label}.{m.name}" for m, _ in plan]
            except Exception as exc:  # unreachable DB is drift too — surface it
                drifted += 1
                self.stderr.write(f"  ✗ {slug}: unreachable ({exc})")
                continue
            if pending:
                drifted += 1
                self.stdout.write(
                    f"  ✗ {slug}: behind by {len(pending)} — {', '.join(pending[:5])}"
                    + (" …" if len(pending) > 5 else "")
                )
            else:
                self.stdout.write(f"  ✓ {slug}: up to date")

        self.stdout.write(f"\n{drifted}/{len(tenant_dbs)} tenant(s) drifted.")
        if drifted and options["fail_on_drift"]:
            raise SystemExit(1)
```

- [x] **Step 4: Run to verify pass** *(3 passed; master+core suites 159 passed)*

Run: `cd backend && python3 -m pytest apps/master/tests/test_check_tenant_migrations.py --no-cov -v`
Expected: all PASS.

- [x] **Step 5: Commit**

```bash
git add backend/apps/master/management/commands/check_tenant_migrations.py backend/apps/master/tests/test_check_tenant_migrations.py
git commit -m "feat(master): check_tenant_migrations drift doctor with --fail-on-drift"
```

---

## Part 2 — Seeding framework

### Task 5: `core.seeding` — Seeder base, SeedContext, registry with autodiscovery + topo sort

**Files:**
- Create: `backend/apps/core/seeding/__init__.py`
- Create: `backend/apps/core/seeding/base.py`
- Create: `backend/apps/core/seeding/registry.py`
- Test: `backend/apps/core/tests/test_seeding_registry.py` (new)

- [x] **Step 1: Write the failing tests**

Create `backend/apps/core/tests/test_seeding_registry.py`:

```python
"""core › seeding registry: registration, topo order, cycle/unknown rejection."""
import pytest


@pytest.fixture(autouse=True)
def clean_registry():
    from core.seeding import registry
    saved = dict(registry._registry)
    registry._registry.clear()
    yield
    registry._registry.clear()
    registry._registry.update(saved)


def _make(name, scope="demo", depends_on=()):
    from core.seeding import Seeder, register

    @register
    class _S(Seeder):
        pass
    _S.name = name
    _S.scope = scope
    _S.depends_on = depends_on
    return _S


def test_register_and_topo_order():
    from core.seeding import registry
    _make("shops", scope="reference")
    _make("users", depends_on=("shops",))
    _make("crm", depends_on=("users", "shops"))

    names = [s.name for s in registry.ordered()]
    assert names.index("shops") < names.index("users") < names.index("crm")


def test_ordered_filters_by_scope():
    from core.seeding import registry
    _make("ref1", scope="reference")
    _make("demo1", scope="demo")
    assert [s.name for s in registry.ordered(scope="reference")] == ["ref1"]


def test_duplicate_name_rejected():
    from django.core.exceptions import ImproperlyConfigured
    _make("dup")
    with pytest.raises(ImproperlyConfigured):
        _make("dup")


def test_unknown_dependency_rejected():
    from django.core.exceptions import ImproperlyConfigured
    from core.seeding import registry
    _make("a", depends_on=("nope",))
    with pytest.raises(ImproperlyConfigured):
        registry.ordered()


def test_cycle_rejected():
    from django.core.exceptions import ImproperlyConfigured
    from core.seeding import registry
    _make("a", depends_on=("b",))
    _make("b", depends_on=("a",))
    with pytest.raises(ImproperlyConfigured):
        registry.ordered()
```

*(Note: `register` is called on the class before the test overrides attributes — so `register` must validate at `ordered()` time, not at registration time, except duplicates which need `name` set. Have the test set attributes first via class body instead if this proves awkward — the implementation below registers **instances**, reading attributes lazily, and validates duplicates on register and graph errors on `ordered()`. To make duplicate detection work in `_make`, set the attributes before `register`:)*

```python
def _make(name, scope="demo", depends_on=()):
    from core.seeding import Seeder, register

    class _S(Seeder):
        pass
    _S.name = name
    _S.scope = scope
    _S.depends_on = tuple(depends_on)
    register(_S)
    return _S
```

(Use this second `_make` variant — delete the decorator variant.)

- [x] **Step 2: Run to verify failure**

Run: `cd backend && python3 -m pytest apps/core/tests/test_seeding_registry.py --no-cov -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'core.seeding'`.

- [x] **Step 3: Implement**

Create `backend/apps/core/seeding/base.py`:

```python
"""Seeder contract: upsert-by-natural-key units of seed data, per app."""


class SeedContext(dict):
    """Shared bag passed through a seed run (shops, users, variants, jobs, …).

    Seeders write the objects they create; downstream seeders read them. When a
    seeder is skipped on resume, its load() must repopulate the same keys.
    """


class Seeder:
    """One unit of seed data.

    Contract: run() must UPSERT by natural keys (code / phone / email / SKU /
    document number) — never blind-create — so re-runs are always safe.
    """

    name: str = ""                      # unique, e.g. "billing.gst_tax_rates"
    scope: str = "demo"                 # "reference" (every tenant) | "demo"
    depends_on: tuple[str, ...] = ()

    def run(self, ctx: SeedContext) -> None:
        raise NotImplementedError

    def load(self, ctx: SeedContext) -> None:
        """Repopulate this seeder's ctx keys when run() is skipped on resume.

        Default no-op is correct for seeders that publish nothing to ctx.
        """
```

Create `backend/apps/core/seeding/registry.py`:

```python
"""Autodiscovered seeder registry with dependency-ordered iteration."""
import importlib

from django.apps import apps as django_apps
from django.core.exceptions import ImproperlyConfigured

from .base import Seeder

_registry: dict[str, Seeder] = {}


def register(cls: type[Seeder]) -> type[Seeder]:
    """Class decorator/registrar. Seeders register an instance under their name."""
    instance = cls()
    if not instance.name:
        raise ImproperlyConfigured(f"{cls.__name__} needs a non-empty `name`.")
    if instance.name in _registry:
        raise ImproperlyConfigured(f"Duplicate seeder name: {instance.name}")
    _registry[instance.name] = instance
    return cls


def autodiscover() -> None:
    """Import <app>.seeds for every installed app (Celery tasks.py pattern)."""
    for app_config in django_apps.get_app_configs():
        module = f"{app_config.name}.seeds"
        try:
            importlib.import_module(module)
        except ModuleNotFoundError as exc:
            if exc.name != module:
                raise  # seeds.py exists but has a broken import — surface it


def ordered(scope: str | None = None) -> list[Seeder]:
    """All seeders in dependency order (Kahn), optionally filtered by scope.

    The graph is validated over ALL registered seeders (so a demo seeder may
    depend on a reference seeder); the scope filter applies to the result.
    """
    for seeder in _registry.values():
        for dep in seeder.depends_on:
            if dep not in _registry:
                raise ImproperlyConfigured(
                    f"Seeder '{seeder.name}' depends on unknown seeder '{dep}'."
                )

    in_degree = {name: len(s.depends_on) for name, s in _registry.items()}
    dependents: dict[str, list[str]] = {name: [] for name in _registry}
    for name, seeder in _registry.items():
        for dep in seeder.depends_on:
            dependents[dep].append(name)

    queue = sorted(name for name, deg in in_degree.items() if deg == 0)
    result: list[Seeder] = []
    while queue:
        name = queue.pop(0)
        result.append(_registry[name])
        for child in sorted(dependents[name]):
            in_degree[child] -= 1
            if in_degree[child] == 0:
                queue.append(child)

    if len(result) != len(_registry):
        cyclic = sorted(set(_registry) - {s.name for s in result})
        raise ImproperlyConfigured(f"Seeder dependency cycle involving: {cyclic}")

    if scope is not None:
        result = [s for s in result if s.scope == scope]
    return result
```

Create `backend/apps/core/seeding/__init__.py`:

```python
from .base import SeedContext, Seeder
from .registry import autodiscover, ordered, register

__all__ = ["SeedContext", "Seeder", "autodiscover", "ordered", "register"]
```

- [x] **Step 4: Run to verify pass** *(5 passed)*

Run: `cd backend && python3 -m pytest apps/core/tests/test_seeding_registry.py --no-cov -v`
Expected: all PASS.

- [x] **Step 5: Commit**

```bash
git add backend/apps/core/seeding/ backend/apps/core/tests/test_seeding_registry.py
git commit -m "feat(core): seeding framework — Seeder base, SeedContext, registry"
```

---

### Task 6: `SeedRun` model + runner (`run_seeders`)

**Files:**
- Modify: `backend/apps/core/models.py` (append model)
- Create: `backend/apps/core/migrations/0009_seedrun.py` (via makemigrations)
- Create: `backend/apps/core/seeding/runner.py`
- Modify: `backend/apps/core/seeding/__init__.py` (export runner)
- Test: `backend/apps/core/tests/test_seeding_runner.py` (new)

- [x] **Step 1: Add the model** *(as-built: also sets `app_label`/`db_table = "seed_runs"` per repo convention)*

Append to `backend/apps/core/models.py`:

```python
class SeedRun(models.Model):
    """Marks a Seeder as completed in this tenant DB (resume + --if-empty)."""

    seeder_name = models.CharField(max_length=100, unique=True)
    seeded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["seeder_name"]

    def __str__(self) -> str:
        return self.seeder_name
```

Run: `cd backend && python3 manage.py makemigrations core --name seedrun`
Expected: creates `backend/apps/core/migrations/0009_seedrun.py`. Verify it is reversible (a plain `CreateModel` is).

- [x] **Step 2: Write the failing runner tests**

Create `backend/apps/core/tests/test_seeding_runner.py`:

```python
"""core › run_seeders: resume via SeedRun, --force, load() on skip, failure isolation."""
import pytest

from core.seeding import SeedContext, Seeder


class _Recorder(Seeder):
    def __init__(self):
        self.ran = 0
        self.loaded = 0

    def run(self, ctx):
        self.ran += 1
        ctx[self.name] = f"made-by-{self.name}"

    def load(self, ctx):
        self.loaded += 1
        ctx[self.name] = f"loaded-by-{self.name}"


def _seeder(name, depends_on=()):
    s = _Recorder()
    s.name = name
    s.scope = "demo"
    s.depends_on = tuple(depends_on)
    return s


@pytest.mark.django_db
def test_first_run_runs_all_and_records():
    from core.models import SeedRun
    from core.seeding.runner import run_seeders

    a, b = _seeder("a"), _seeder("b", depends_on=("a",))
    result = run_seeders([a, b], SeedContext())
    assert (a.ran, b.ran) == (1, 1)
    assert result.failed == []
    assert set(SeedRun.objects.values_list("seeder_name", flat=True)) == {"a", "b"}


@pytest.mark.django_db
def test_resume_skips_done_and_calls_load():
    from core.models import SeedRun
    from core.seeding.runner import run_seeders

    SeedRun.objects.create(seeder_name="a")
    a, b = _seeder("a"), _seeder("b", depends_on=("a",))
    ctx = SeedContext()
    run_seeders([a, b], ctx)
    assert (a.ran, a.loaded) == (0, 1)      # skipped → load()
    assert b.ran == 1
    assert ctx["a"] == "loaded-by-a"        # downstream still sees a's objects


@pytest.mark.django_db
def test_force_reruns_everything():
    from core.models import SeedRun
    from core.seeding.runner import run_seeders

    SeedRun.objects.create(seeder_name="a")
    a = _seeder("a")
    run_seeders([a], SeedContext(), force=True)
    assert a.ran == 1
    assert SeedRun.objects.filter(seeder_name="a").count() == 1  # no duplicate row


@pytest.mark.django_db
def test_failure_is_isolated_and_reported():
    from core.models import SeedRun
    from core.seeding.runner import run_seeders

    class _Boom(Seeder):
        name = "boom"
        def run(self, ctx):
            raise RuntimeError("nope")

    ok = _seeder("ok")
    result = run_seeders([_Boom(), ok], SeedContext())
    assert result.failed == ["boom"]
    assert ok.ran == 1                       # later seeders still run
    assert not SeedRun.objects.filter(seeder_name="boom").exists()
```

- [x] **Step 3: Run to verify failure**

Run: `cd backend && python3 -m pytest apps/core/tests/test_seeding_runner.py --no-cov -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'core.seeding.runner'`.

- [x] **Step 4: Implement the runner**

Create `backend/apps/core/seeding/runner.py`:

```python
"""Executes a dependency-ordered list of seeders with SeedRun tracking."""
import logging
from dataclasses import dataclass, field

from .base import SeedContext, Seeder

logger = logging.getLogger(__name__)


@dataclass
class SeedResult:
    ran: list[str] = field(default_factory=list)
    skipped: list[str] = field(default_factory=list)
    failed: list[str] = field(default_factory=list)


def run_seeders(
    seeders: list[Seeder],
    ctx: SeedContext,
    force: bool = False,
    log=lambda msg: None,
) -> SeedResult:
    """Run each seeder unless already recorded in SeedRun (resume semantics).

    Skipped seeders get load(ctx) so downstream seeders still find their objects.
    A failing seeder is reported and does not stop the rest (its SeedRun row is
    not written, so the next run retries it).
    """
    from core.models import SeedRun

    done = set(SeedRun.objects.values_list("seeder_name", flat=True))
    result = SeedResult()
    for seeder in seeders:
        if not force and seeder.name in done:
            seeder.load(ctx)
            result.skipped.append(seeder.name)
            log(f"  ↷ {seeder.name} (already seeded)")
            continue
        try:
            seeder.run(ctx)
        except Exception:
            logger.exception("Seeder %s failed", seeder.name)
            result.failed.append(seeder.name)
            log(f"  ✗ {seeder.name} FAILED (see log)")
            continue
        SeedRun.objects.get_or_create(seeder_name=seeder.name)
        result.ran.append(seeder.name)
        log(f"  ✓ {seeder.name}")
    return result
```

Update `backend/apps/core/seeding/__init__.py`:

```python
from .base import SeedContext, Seeder
from .registry import autodiscover, ordered, register
from .runner import SeedResult, run_seeders

__all__ = [
    "SeedContext", "Seeder", "autodiscover", "ordered", "register",
    "SeedResult", "run_seeders",
]
```

- [x] **Step 5: Run to verify pass, then commit** *(core suite 112 passed)*

Run: `cd backend && python3 -m pytest apps/core/tests/test_seeding_runner.py apps/core --no-cov -q`
Expected: all PASS.

```bash
git add backend/apps/core/models.py backend/apps/core/migrations/0009_seedrun.py backend/apps/core/seeding/ backend/apps/core/tests/test_seeding_runner.py
git commit -m "feat(core): SeedRun tracking + run_seeders runner"
```

---

### Task 7: Reference tier — GST tax rates + Chart of Accounts, wired into both provisioning paths

**Files:**
- Create: `backend/apps/billing/seeds.py`
- Create: `backend/apps/accounts/seeds.py`
- Create: `backend/apps/core/seeding/reference.py` (the `run_reference_tier` entry point)
- Modify: `backend/apps/core/seeding/__init__.py` (export)
- Modify: `backend/apps/master/management/commands/create_tenant.py:100-101` (call after `_seed_roles_and_permissions()`)
- Modify: `backend/apps/master/services.py:653` area (same call in the `register_tenant` provisioning path)
- Test: `backend/apps/billing/tests/test_seeds.py`, `backend/apps/accounts/tests/test_seeds.py` (new)

- [ ] **Step 1: Write the failing tests**

Create `backend/apps/billing/tests/test_seeds.py`:

```python
"""billing › GST tax-rate reference seeder (Indian market baseline)."""
import pytest

from core.seeding import SeedContext


@pytest.mark.django_db
def test_gst_slabs_seeded_and_idempotent():
    from billing.models import TaxRate
    from billing.seeds import GstTaxRateSeeder

    seeder = GstTaxRateSeeder()
    seeder.run(SeedContext())
    names = set(TaxRate.objects.values_list("name", flat=True))
    assert {"GST 0%", "GST 5%", "GST 12%", "GST 18%", "GST 28%"} <= names
    count = TaxRate.objects.count()

    seeder.run(SeedContext())  # upsert: no duplicates
    assert TaxRate.objects.count() == count
```

Create `backend/apps/accounts/tests/test_seeds.py`:

```python
"""accounts › Chart-of-Accounts reference seeder."""
import pytest

from core.seeding import SeedContext


@pytest.fixture
def shop(db):
    from core.models import Shop
    return Shop.objects.create(
        name="Ref Shop", code="REF", address="MG Road", city="Delhi",
        state="Delhi", state_code="07", phone="+919876543299",
    )


@pytest.mark.django_db
def test_chart_seeded_per_shop_and_idempotent(shop):
    from accounts.models import Account, AccountMapping
    from accounts.seeds import ChartOfAccountsSeeder

    seeder = ChartOfAccountsSeeder()
    seeder.run(SeedContext(shops=[shop]))
    assert Account.objects.filter(shop=shop).count() == 17
    assert AccountMapping.objects.filter(shop=shop).count() == 9

    seeder.run(SeedContext(shops=[shop]))  # existing seed helpers are no-op safe
    assert Account.objects.filter(shop=shop).count() == 17


@pytest.mark.django_db
def test_chart_seeder_no_shops_is_noop(db):
    from accounts.seeds import ChartOfAccountsSeeder
    ChartOfAccountsSeeder().run(SeedContext())  # must not raise
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && python3 -m pytest apps/billing/tests/test_seeds.py apps/accounts/tests/test_seeds.py --no-cov -v`
Expected: FAIL — no module `billing.seeds` / `accounts.seeds`.

- [ ] **Step 3: Implement the seeders + tier entry point**

Create `backend/apps/billing/seeds.py`:

```python
"""Reference seed: Indian GST slab tax rates (heals tenants missing any slab)."""
from core.seeding import SeedContext, Seeder, register

GST_SLABS = [("GST 0%", "0"), ("GST 5%", "5"), ("GST 12%", "12"),
             ("GST 18%", "18"), ("GST 28%", "28")]


class GstTaxRateSeeder(Seeder):
    name = "billing.gst_tax_rates"
    scope = "reference"

    def run(self, ctx: SeedContext) -> None:
        from billing.models import TaxRate

        for slab_name, rate in GST_SLABS:
            TaxRate.objects.get_or_create(
                name=slab_name, defaults={"rate": rate, "tax_type": "gst"}
            )


register(GstTaxRateSeeder)
```

Create `backend/apps/accounts/seeds.py`:

```python
"""Reference seed: default Indian-SMB Chart of Accounts + mappings, per shop."""
from core.seeding import SeedContext, Seeder, register


class ChartOfAccountsSeeder(Seeder):
    name = "accounts.default_chart"
    scope = "reference"

    def run(self, ctx: SeedContext) -> None:
        from accounts.services import seed_default_chart

        for shop in ctx.get("shops", []):
            seed_default_chart(shop)  # idempotent; also seeds mappings


register(ChartOfAccountsSeeder)
```

Create `backend/apps/core/seeding/reference.py`:

```python
"""Entry point for provisioning paths: seed the reference tier for the
current tenant (tenant context must already be set by the caller)."""
from .base import SeedContext
from .registry import autodiscover, ordered
from .runner import SeedResult, run_seeders


def run_reference_tier(log=lambda msg: None) -> SeedResult:
    from core.models import Shop

    autodiscover()
    ctx = SeedContext(shops=list(Shop.objects.all()))
    return run_seeders(ordered(scope="reference"), ctx, log=log)
```

Add to `backend/apps/core/seeding/__init__.py` exports: `from .reference import run_reference_tier` (+ `"run_reference_tier"` in `__all__`).

- [ ] **Step 4: Wire into both provisioning paths**

In `backend/apps/master/management/commands/create_tenant.py`, right after `services._seed_roles_and_permissions()` (line ~100, tenant context is already set there):

```python
        from core.seeding import run_reference_tier
        run_reference_tier(log=self.stdout.write)
        self.stdout.write("  ✓ Reference data seeded (GST rates, chart of accounts).")
```

In `backend/apps/master/services.py`, in the provisioning function around line 653, immediately after its `_seed_roles_and_permissions()` call (context is set there too):

```python
        from core.seeding import run_reference_tier
        run_reference_tier()
```

- [ ] **Step 5: Run to verify pass, then commit**

Run: `cd backend && python3 -m pytest apps/billing/tests/test_seeds.py apps/accounts/tests/test_seeds.py apps/master --no-cov -q`
Expected: all PASS.

```bash
git add backend/apps/billing/seeds.py backend/apps/accounts/seeds.py backend/apps/billing/tests/test_seeds.py backend/apps/accounts/tests/test_seeds.py backend/apps/core/seeding/ backend/apps/master/management/commands/create_tenant.py backend/apps/master/services.py
git commit -m "feat(seeding): reference tier — GST slabs + default chart, run at provisioning"
```

---

### Task 8: Port demo seeders out of `seed_demo.py` into per-app `seeds.py`

**Files:**
- Create: `backend/apps/<app>/seeds.py` (or append, for billing/accounts) per the table below
- Modify: `backend/apps/master/management/commands/seed_demo.py` (methods are *moved out*; command shrinks — full rewrite in Task 9)

This is a **mechanical move** of the existing `_seed_*` methods (they already upsert by natural keys — ₹/+91/GSTIN/HSN demo flavor comes along verbatim). Uniform recipe, then the exact mapping.

**Recipe (apply to every row of the table):**
1. Create the class in the target `seeds.py` with the given `name`, `scope = "demo"`, `depends_on`.
2. Move the source method's body into `run(self, ctx)`. The old parameters become ctx reads at the top (e.g. `users = ctx["users"]`); the old return value becomes a ctx write at the bottom (e.g. `ctx["jobs"] = jobs`). Inner helper functions move along unchanged.
3. Replace `self.stdout.write(...)` with nothing (the runner logs per-seeder) and keep any data constants the method uses by moving them to the same `seeds.py`.
4. For producer seeders (those with a ctx write), implement `load(ctx)` that re-fetches the same objects **by the literal natural keys already present in the moved code** (emails, phone numbers, SKUs, shop codes are constants there). `CrmDemoSeeder.load` below is the worked example; non-producers keep the default no-op `load`.
5. `register(TheSeeder)` at the bottom of the file.

**Mapping table** (source methods in `backend/apps/master/management/commands/seed_demo.py`; line numbers as of commit `ad29fa1`):

| Target file | Class | name | depends_on | Source method (lines) | ctx reads → writes |
|---|---|---|---|---|---|
| `commissions/seeds.py` | `CommissionRulesDemoSeeder` | `commissions.demo_rules` | () | `_seed_commission_rules` (178–201) | — → — |
| `core/seeds.py` | `ShopsDemoSeeder` | `core.demo_shops` | () | `_seed_shops` (202–236) | — → `shop_del`, `shop_mum`, `shops` |
| `authentication/seeds.py` | `UsersDemoSeeder` | `authentication.demo_users` | (`core.demo_shops`,) | `_seed_users` (237–317) | `shop_del`,`shop_mum` → `users` |
| `crm/seeds.py` | `CrmDemoSeeder` | `crm.demo` | (`authentication.demo_users`,) | `_seed_crm` (318–543) | `users`,`shop_del`,`shop_mum` → `crm` |
| `inventory/seeds.py` | `InventoryDemoSeeder` | `inventory.demo` | (`authentication.demo_users`,) | `_seed_inventory` (544–685) | `shop_del`,`users` → `variants` |
| `procurement/seeds.py` | `ProcurementDemoSeeder` | `procurement.demo` | (`inventory.demo`,) | `_seed_procurement` (686–891) | `shop_del`,`variants`,`users` → — |
| `repair/seeds.py` | `RepairDemoSeeder` | `repair.demo` | (`crm.demo`, `inventory.demo`, `commissions.demo_rules`) | `_seed_repair` (892–1155) | `shop_del`,`shop_mum`,`crm`,`users`,`variants` → `jobs` |
| `billing/seeds.py` (append) | `BillingDemoSeeder` | `billing.demo` | (`repair.demo`,) | `_seed_billing` (1156–1207) | `jobs`,`users` → — |
| `pos/seeds.py` | `PosDemoSeeder` | `pos.demo` | (`crm.demo`, `inventory.demo`) | `_seed_pos` (1208–1358) | `shop_del`,`crm`,`users`,`variants` → — |
| `amc/seeds.py` | `AmcDemoSeeder` | `amc.demo` | (`crm.demo`,) | `_seed_amc` (1359–1438) | `shop_del`,`crm`,`users` → — |
| `commissions/seeds.py` (append) | `CommissionPayoutDemoSeeder` | `commissions.demo_payout` | (`billing.demo`,) | `_seed_commission_payout` (1439–1458) | `jobs`,`users` → — |
| `hr/seeds.py` | `HrDemoSeeder` | `hr.demo` | (`authentication.demo_users`,) | `_seed_hr` (1459–1583) | `shop_del`,`users` → — |
| `finance/seeds.py` | `FinanceDemoSeeder` | `finance.demo` | (`authentication.demo_users`,) | `_seed_finance` (1584–1751) | `shop_del`,`shop_mum`,`users` → — |

Module-level constants at the top of `seed_demo.py` (`FIXED_SEED`, name/product/phone pools, etc.): move each to the `seeds.py` that uses it; if shared by several, move to `core/seeds.py` and import from there.

**Worked example — `backend/apps/crm/seeds.py` skeleton (body is the verbatim move):**

```python
"""Demo seed: CRM customers/leads (Indian names, +91 phones)."""
from core.seeding import SeedContext, Seeder, register


class CrmDemoSeeder(Seeder):
    name = "crm.demo"
    scope = "demo"
    depends_on = ("authentication.demo_users",)

    def run(self, ctx: SeedContext) -> None:
        users, shop_del, shop_mum = ctx["users"], ctx["shop_del"], ctx["shop_mum"]
        # ← verbatim body of Command._seed_crm (seed_demo.py:318-543),
        #   with `return {...}` replaced by:
        ctx["crm"] = crm

    def load(self, ctx: SeedContext) -> None:
        """Re-fetch by the same natural keys the run() body creates with —
        the customer/lead phone numbers are literals in the moved code."""
        from crm.models import Customer
        ctx["crm"] = {
            "customers": list(Customer.objects.filter(
                phone__in=CUSTOMER_PHONES  # the phone-literal list moved from _seed_crm
            )),
            # …mirror exactly the dict shape run() puts into ctx["crm"],
            # key for key, each re-fetched by its literal natural key.
        }


register(CrmDemoSeeder)
```

- [ ] **Step 1: Port the three producer chain roots** (`core/seeds.py`, `authentication/seeds.py`, `crm/seeds.py`) per the recipe, with `load()` implemented on each (shops by `code`, users by `email`, crm by phone literals).
- [ ] **Step 2: Run the import smoke check** — `cd backend && python3 -c "import django,os; os.environ.setdefault('DJANGO_SETTINGS_MODULE','config.settings.test'); django.setup(); from core.seeding import autodiscover; autodiscover(); from core.seeding import registry" ` — expect no exception.
- [ ] **Step 3: Port the remaining producers** (`inventory/seeds.py` with `load()` by SKU/barcode, `repair/seeds.py` with `load()` by ticket number) and all non-producers (default no-op `load`).
- [ ] **Step 4: Ordering test** — append to `backend/apps/core/tests/test_seeding_registry.py`:

```python
def test_real_demo_seeders_topo_order_is_valid():
    """Autodiscovered production seeders must form a valid DAG whose order
    respects the original seed_demo handle() sequence constraints."""
    from core.seeding import autodiscover, registry

    saved = dict(registry._registry)
    registry._registry.clear()
    try:
        autodiscover()
        names = [s.name for s in registry.ordered()]
        assert names.index("core.demo_shops") < names.index("authentication.demo_users")
        assert names.index("authentication.demo_users") < names.index("crm.demo")
        assert names.index("inventory.demo") < names.index("repair.demo")
        assert names.index("repair.demo") < names.index("billing.demo")
        assert names.index("billing.demo") < names.index("commissions.demo_payout")
    finally:
        registry._registry.clear()
        registry._registry.update(saved)
```

Run: `cd backend && python3 -m pytest apps/core/tests/test_seeding_registry.py --no-cov -v` — expect PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/apps/*/seeds.py backend/apps/core/tests/test_seeding_registry.py backend/apps/master/management/commands/seed_demo.py
git commit -m "refactor(seeding): port demo data from seed_demo monolith to per-app seeders"
```

---

### Task 9: Rewrite `seed_demo` as a thin runner with `--force/--only/--reset/--if-empty`

**Files:**
- Modify: `backend/apps/master/management/commands/seed_demo.py` (keep `_guard`, `_provision_tenant`, `_seed_subscription`, `_print_summary`; replace `handle` and delete all moved `_seed_*` methods)
- Modify: `backend/apps/master/services.py` (add `_drop_pg_resources`, mirroring `_create_pg_resources`'s connection mechanics)
- Test: `backend/apps/master/tests/test_seed_demo_command.py` (new)

- [ ] **Step 1: Write the failing tests**

Create `backend/apps/master/tests/test_seed_demo_command.py`:

```python
"""master › seed_demo thin-runner flags. The heavy seeders are stubbed; these
tests exercise flag plumbing, not demo content."""
import pytest
from django.core.management import call_command
from io import StringIO


@pytest.fixture
def stub_command(monkeypatch):
    """Neutralise provisioning + registry so flags can be tested on SQLite."""
    from core.seeding import SeedContext, Seeder
    ran = []

    class _A(Seeder):
        name = "stub.a"
        scope = "demo"
        def run(self, ctx):
            ran.append("stub.a")

    class _B(Seeder):
        name = "stub.b"
        scope = "demo"
        depends_on = ("stub.a",)
        def run(self, ctx):
            ran.append("stub.b")

    monkeypatch.setattr("master.management.commands.seed_demo.Command._guard", lambda self: None)
    monkeypatch.setattr(
        "master.management.commands.seed_demo.Command._provision_tenant",
        lambda self: "default",
    )
    monkeypatch.setattr(
        "master.management.commands.seed_demo.Command._print_summary",
        lambda self, alias: None,
    )
    monkeypatch.setattr("core.seeding.registry.autodiscover", lambda: None)
    monkeypatch.setattr(
        "master.management.commands.seed_demo.ordered",
        lambda scope=None: [_A(), _B()] if scope in (None, "demo") else [],
    )
    monkeypatch.setattr(
        "master.management.commands.seed_demo.autodiscover", lambda: None
    )
    return ran


@pytest.mark.django_db
def test_default_run_executes_and_records(stub_command):
    from core.models import SeedRun
    call_command("seed_demo", stdout=StringIO())
    assert stub_command == ["stub.a", "stub.b"]
    assert SeedRun.objects.filter(seeder_name__startswith="stub.").count() == 2


@pytest.mark.django_db
def test_if_empty_skips_when_all_recorded(stub_command):
    from core.models import SeedRun
    SeedRun.objects.create(seeder_name="stub.a")
    SeedRun.objects.create(seeder_name="stub.b")
    out = StringIO()
    call_command("seed_demo", "--if-empty", stdout=out)
    assert stub_command == []
    assert "already seeded" in out.getvalue()


@pytest.mark.django_db
def test_only_runs_single_seeder(stub_command):
    call_command("seed_demo", "--only", "stub.b", stdout=StringIO())
    assert stub_command == ["stub.b"]


@pytest.mark.django_db
def test_failed_seeder_exits_nonzero(stub_command, monkeypatch):
    from core.seeding.runner import SeedResult
    monkeypatch.setattr(
        "master.management.commands.seed_demo.run_seeders",
        lambda *a, **k: SeedResult(failed=["stub.a"]),
    )
    with pytest.raises(SystemExit):
        call_command("seed_demo", stdout=StringIO())
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && python3 -m pytest apps/master/tests/test_seed_demo_command.py --no-cov -v`
Expected: FAIL (current command has no flags and no `ordered`/`run_seeders` imports).

- [ ] **Step 3: Rewrite the command**

New `handle` + flags in `backend/apps/master/management/commands/seed_demo.py` (imports at module top: `from core.seeding import SeedContext, autodiscover, ordered, run_seeders`):

```python
    def add_arguments(self, parser):
        parser.add_argument("--force", action="store_true",
                            help="Re-run all seeders (upsert-safe).")
        parser.add_argument("--only", default=None, metavar="NAME",
                            help="Run a single seeder by name.")
        parser.add_argument("--reset", action="store_true",
                            help="Drop + reprovision the demo tenant DB, then seed fresh.")
        parser.add_argument("--if-empty", action="store_true", dest="if_empty",
                            help="Exit immediately when every seeder is recorded (entrypoint fast path).")

    def handle(self, *args, **options):
        self._guard()
        random.seed(FIXED_SEED)

        if options["reset"]:
            self._reset_demo_tenant()

        alias = self._provision_tenant()

        from core.context import clear_tenant_context, set_tenant_db_alias
        set_tenant_db_alias(alias)
        try:
            autodiscover()
            seeders = ordered()          # reference tier first, then demo (deps)
            if options["only"]:
                seeders = [s for s in seeders if s.name == options["only"]]
                if not seeders:
                    raise CommandError(f"Unknown seeder: {options['only']}")

            from core.models import SeedRun
            if options["if_empty"]:
                done = set(SeedRun.objects.values_list("seeder_name", flat=True))
                if {s.name for s in seeders} <= done:
                    self.stdout.write("Demo tenant already seeded — nothing to do.")
                    return

            from core.models import Shop
            ctx = SeedContext(shops=list(Shop.objects.all()))
            result = run_seeders(
                seeders, ctx, force=options["force"], log=self.stdout.write
            )
            self._print_summary(alias)
            if result.failed:
                raise SystemExit(f"{len(result.failed)} seeder(s) failed: {result.failed}")
        finally:
            clear_tenant_context()

    def _reset_demo_tenant(self):
        """DEBUG-only (guarded): drop the demo tenant DB + master rows so
        _provision_tenant recreates everything from scratch."""
        from django.db import connections

        from master import services
        from master.models import Tenant

        tenant = Tenant.objects.using("default").filter(slug=DEMO_SLUG).first()
        if tenant is None:
            return
        alias = f"tenant_{DEMO_SLUG}"
        if alias in connections.databases:
            connections[alias].close()
            del connections.databases[alias]
        tenant_db = tenant.database  # TenantDatabase reverse one-to-one
        services._drop_pg_resources(tenant_db.db_name, tenant_db.db_user)
        tenant_db.delete(using="default")
        tenant.delete(using="default")
        self.stdout.write(f"  ✓ Demo tenant '{DEMO_SLUG}' dropped.")
```

*(Check the actual reverse accessor name for `TenantDatabase.tenant` — `related_name` in `master/models.py`; adjust `tenant.database` accordingly.)*

Add `_drop_pg_resources(db_name, db_user)` to `backend/apps/master/services.py`, mirroring `_create_pg_resources`'s connection handling (same admin connection/autocommit mechanics, located directly below it), executing:

```sql
DROP DATABASE IF EXISTS <db_name> WITH (FORCE);
DROP ROLE IF EXISTS <db_user>;
```

using `psycopg2.sql.Identifier` quoting exactly the way `_create_pg_resources` quotes its identifiers.

Delete the 13 moved `_seed_*` methods and the module-level constants that moved in Task 8. `seed_demo.py` should now be roughly 250 lines (guard, provisioning, subscription, summary, handle, reset).

- [ ] **Step 4: Run to verify pass**

Run: `cd backend && python3 -m pytest apps/master --no-cov -q`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/apps/master/management/commands/seed_demo.py backend/apps/master/services.py backend/apps/master/tests/test_seed_demo_command.py
git commit -m "feat(seeding): seed_demo thin runner — --force/--only/--reset/--if-empty"
```

---

### Task 10: Entrypoint — tenant migrations at startup, non-fatal seed

**Files:**
- Modify: `backend/entrypoint.sh`

- [ ] **Step 1: Replace the seed section**

Keep the wait-for-DB block and master migrate as-is; replace everything from the first `create_tenant` through `seed_demo` with:

```bash
echo "==> [seed] Migrating all tenant databases..."
python manage.py migrate_all_tenants || echo "==> [seed] WARNING: some tenant migrations failed — check above."

echo "==> [seed] Seeding demo tenants (idempotent)..."

python manage.py create_tenant \
  --slug demo \
  --name "Shree Electronics" \
  --email "admin@demo.com" \
  --phone "+919876543210" \
  --admin-password "Demo@1234!" \
  --plan professional \
  2>&1 | grep -v "already exists" || true

python manage.py create_tenant \
  --slug testshop \
  --name "Test Shop" \
  --email "admin@testshop.com" \
  --phone "+919876543211" \
  --admin-password "Demo@1234!" \
  --plan starter \
  2>&1 | grep -v "already exists" || true

echo "==> [seed] Loading demo data (skips if already seeded)..."
if ! python manage.py seed_demo --if-empty; then
  echo "=============================================================="
  echo "==> [seed] WARNING: demo seeding FAILED — backend starts anyway."
  echo "==> [seed] Fix and re-run: docker compose exec backend python manage.py seed_demo"
  echo "=============================================================="
fi

echo "==> [seed] Starting Daphne..."
exec daphne -b 0.0.0.0 -p 8000 config.asgi:application
```

(`set -euo pipefail` stays at the top — the `if !` and `|| echo` guards are what make these two steps non-fatal.)

- [ ] **Step 2: Verify live**

Run: `docker compose up -d --build backend && sleep 40 && docker compose ps backend && docker logs repairos-backend-1 --since 2m | tail -20 && curl -s -o /dev/null -w "HTTP %{http_code}\n" http://localhost:8000/api/v1/health/`
Expected: backend stays `Up` (not restarting), log shows migrate-all-tenants + seed skip/success, HTTP 200.

- [ ] **Step 3: Commit**

```bash
git add backend/entrypoint.sh
git commit -m "feat(dev): entrypoint migrates tenant DBs and survives seed failures"
```

---

### Task 11: Full verification + PR

- [ ] **Step 1: Full backend suite** — `cd backend && python3 -m pytest --no-cov -q`
Expected: green except the 10 known weasyprint PDF failures (local-only; pass in CI).
- [ ] **Step 2: End-to-end seed check** — `docker compose exec backend python manage.py seed_demo --force` then `docker compose exec backend python manage.py check_tenant_migrations`
Expected: seeders all `✓`; doctor reports all tenants up to date.
- [ ] **Step 3: Tick all checkboxes in this plan; commit** — `git add docs/superpowers/plans/2026-07-06-migration-seeding-overhaul.md && git commit -m "docs(plan): tick migration-seeding tasks"`
- [ ] **Step 4: Push + PR**

```bash
git push -u origin feature/migration-seeding-overhaul
gh pr create --base master --title "feat: migration correctness + seeding framework overhaul" --body "<summary of Parts 1-2, test results, spec + plan links>"
```

(Old `gh` CLI: poll `gh pr checks`, no `--watch`. Verify base is `master` before merging.)
