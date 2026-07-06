"""Demo seed: the two demo shops (Delhi + Mumbai) and shared demo constants."""
from core.seeding import SeedContext, Seeder, register

DEMO_PASSWORD = "Demo@1234!"


class ShopsDemoSeeder(Seeder):
    name = "core.demo_shops"
    scope = "demo"

    def run(self, ctx: SeedContext) -> None:
        from core.models import Shop

        shop_del, _ = Shop.objects.get_or_create(
            code="SDEL",
            defaults={
                "name": "Shree Electronics – Delhi",
                "address": "12, Nehru Place Market, South Delhi",
                "city": "New Delhi",
                "state": "Delhi",
                "state_code": "07",
                "phone": "+911140001001",
                "email": "delhi@shreeelectronics.in",
                "gstin": "07AABCS1234A1Z5",
                "is_active": True,
            },
        )
        shop_mum, _ = Shop.objects.get_or_create(
            code="SMUM",
            defaults={
                "name": "Shree Electronics – Mumbai",
                "address": "45, SV Road, Andheri West, Mumbai",
                "city": "Mumbai",
                "state": "Maharashtra",
                "state_code": "27",
                "phone": "+912240001001",
                "email": "mumbai@shreeelectronics.in",
                "gstin": "27AABCS1234A2Z5",
                "is_active": True,
            },
        )

        ctx["shop_del"], ctx["shop_mum"] = shop_del, shop_mum
        ctx["shops"] = [shop_del, shop_mum]

    def load(self, ctx: SeedContext) -> None:
        from core.models import Shop

        shop_del = Shop.objects.get(code="SDEL")
        shop_mum = Shop.objects.get(code="SMUM")
        ctx["shop_del"], ctx["shop_mum"] = shop_del, shop_mum
        ctx["shops"] = [shop_del, shop_mum]


register(ShopsDemoSeeder)
