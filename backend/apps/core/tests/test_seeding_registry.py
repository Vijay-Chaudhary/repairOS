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

    class _S(Seeder):
        pass
    _S.name = name
    _S.scope = scope
    _S.depends_on = tuple(depends_on)
    register(_S)
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
