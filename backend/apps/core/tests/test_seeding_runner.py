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
