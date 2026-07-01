"""Accounts › AccountMapping + JournalEntry source-of-truth fields (Phase 8b)."""
import uuid

import pytest
from django.db import IntegrityError

from accounts import services
from accounts.models import Account, AccountMapping, JournalEntry


@pytest.fixture
def shop(db):
    from core.models import Shop
    return Shop.objects.create(
        name="Hotspot Repair", code="HTA", address="MG Road",
        city="Delhi", state="Delhi", state_code="07", phone="+919876543210",
    )


def test_seed_chart_also_seeds_mappings(shop):
    services.seed_default_chart(shop)
    keys = set(AccountMapping.objects.filter(shop=shop).values_list("key", flat=True))
    assert keys == {
        "cash", "bank", "debtors", "creditors", "gst_output",
        "gst_input", "sales", "other_income", "expense_default",
    }
    debtors = AccountMapping.objects.get(shop=shop, key="debtors")
    assert debtors.account.code == "1100"
    assert AccountMapping.objects.get(shop=shop, key="sales").account.code == "4000"


def test_seed_default_mappings_idempotent(shop):
    services.seed_default_chart(shop)
    before = AccountMapping.objects.filter(shop=shop).count()
    created = services.seed_default_mappings(shop)
    assert created == 0
    assert AccountMapping.objects.filter(shop=shop).count() == before


def test_seed_default_mappings_standalone_for_prechart_shop(shop):
    services.seed_default_chart(shop)
    AccountMapping.objects.filter(shop=shop).delete()
    created = services.seed_default_mappings(shop)
    assert created == 9
    assert AccountMapping.objects.filter(shop=shop).count() == 9


def test_seed_mappings_skips_key_when_account_absent(shop):
    services.seed_default_chart(shop)
    AccountMapping.objects.filter(shop=shop).delete()
    Account.objects.filter(shop=shop, code="4100").delete()  # remove "other_income" target
    created = services.seed_default_mappings(shop)
    assert created == 8
    assert not AccountMapping.objects.filter(shop=shop, key="other_income").exists()


def test_journal_source_unique_when_source_id_present(shop):
    services.seed_default_chart(shop)
    import datetime as dt
    sid = uuid.uuid4()
    JournalEntry.objects.create(
        shop=shop, entry_number="JV-90001", date=dt.date(2026, 7, 1),
        source_type="billing.invoice", source_id=sid,
    )
    with pytest.raises(IntegrityError):
        JournalEntry.objects.create(
            shop=shop, entry_number="JV-90002", date=dt.date(2026, 7, 1),
            source_type="billing.invoice", source_id=sid,
        )


def test_journal_null_source_id_allows_many(shop):
    import datetime as dt
    JournalEntry.objects.create(shop=shop, entry_number="JV-1", date=dt.date(2026, 7, 1))
    JournalEntry.objects.create(shop=shop, entry_number="JV-2", date=dt.date(2026, 7, 1))
    assert JournalEntry.objects.filter(shop=shop, source_id__isnull=True).count() == 2
