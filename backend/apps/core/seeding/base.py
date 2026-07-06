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
