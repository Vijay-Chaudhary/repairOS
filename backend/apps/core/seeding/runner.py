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
