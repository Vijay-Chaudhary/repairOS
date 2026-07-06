"""master › check_tenant_migrations drift doctor.

Uses the settings-declared 'alias_leak_scratch' DB (empty: TEST MIGRATE False) as
the drifted tenant DB — Django blocks connections to aliases added at runtime.
"""
from io import StringIO

import pytest
from django.core.management import call_command

SCRATCH = "alias_leak_scratch"


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

    monkeypatch.setattr(
        "master.management.commands.check_tenant_migrations.ensure_tenant_alias",
        lambda tenant_db: SCRATCH,
    )
    return td


@pytest.mark.django_db(databases=["default", SCRATCH])
def test_reports_drifted_tenant(drifted_tenant):
    out = StringIO()
    call_command("check_tenant_migrations", stdout=out)
    text = out.getvalue()
    assert "driftshop" in text
    assert "behind" in text


@pytest.mark.django_db(databases=["default", SCRATCH])
def test_fail_on_drift_exits_nonzero(drifted_tenant):
    with pytest.raises(SystemExit):
        call_command("check_tenant_migrations", "--fail-on-drift", stdout=StringIO())


@pytest.mark.django_db
def test_no_tenants_is_clean(db):
    out = StringIO()
    call_command("check_tenant_migrations", stdout=out)
    assert "No active tenants" in out.getvalue()
