"""Guardrail: running `migrate` against a second alias with NO tenant context must
not leak a single query to the default (master) connection. Catches data migrations
whose RunPython queries the ORM without pinning schema_editor.connection.alias —
the bug class behind the 2026-07-06 `relation "tax_rates" does not exist` failure.

The scratch alias is declared in config.settings.test (Django blocks connections
to aliases added at runtime), and the production router is swapped in because the
test router's allow_migrate would no-op every operation on a non-default alias.
"""
import pytest
from django.core.management import call_command
from django.db import connections
from django.test import override_settings
from django.test.utils import CaptureQueriesContext

SCRATCH = "alias_leak_scratch"


# transaction=True: SQLite's schema editor cannot run inside the wrapping
# atomic a plain django_db test opens on every declared alias.
@pytest.mark.django_db(databases=["default", SCRATCH], transaction=True)
@override_settings(DATABASE_ROUTERS=["core.routers.TenantDatabaseRouter"])
def test_full_migrate_on_second_alias_leaks_nothing_to_default():
    from core.context import clear_tenant_context

    # No tenant context: the router falls back to 'default', so any unpinned
    # migration query lands on — and is captured from — the default connection.
    clear_tenant_context()
    with CaptureQueriesContext(connections["default"]) as captured:
        call_command("migrate", database=SCRATCH, verbosity=0)
    leaked = [q["sql"] for q in captured.captured_queries]
    assert leaked == [], f"Migrations leaked queries to the master DB: {leaked}"
