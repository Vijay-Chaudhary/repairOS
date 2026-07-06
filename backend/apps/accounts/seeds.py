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
