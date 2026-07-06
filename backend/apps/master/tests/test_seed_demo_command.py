"""master › seed_demo thin-runner flags. The heavy seeders are stubbed; these
tests exercise flag plumbing, not demo content."""
from io import StringIO

import pytest
from django.core.management import call_command


@pytest.fixture
def stub_command(monkeypatch):
    """Neutralise provisioning + registry so flags can be tested on SQLite."""
    from core.seeding import Seeder
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
