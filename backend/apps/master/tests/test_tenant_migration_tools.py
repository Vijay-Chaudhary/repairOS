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
