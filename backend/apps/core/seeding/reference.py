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
