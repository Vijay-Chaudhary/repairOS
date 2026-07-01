# ERP/CRM Phase 8b — Auto-Posting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically generate **balanced, posted double-entry journal entries** in `apps/accounts` whenever a money-moving business event occurs (repair invoice, POS sale, customer/POS payment, expense) and **reversing entries** when they are undone (POS returns, billing credit notes, billing refunds) — synchronous, atomic, idempotent, and opt-in per shop.

**Architecture:** A new posting engine `apps/accounts/posting.py` (pure recipe functions + `post_event`/`reverse_event`) drives an `AccountMapping` (semantic key → account) lookup and reuses 8a's `create_journal_entry` + `post_journal_entry` to persist balanced, immutable entries. Business services (`billing`, `pos`, `finance`) call the engine at the tail of their existing `transaction.atomic()` blocks via lazy imports, so posting commits or rolls back with the event. No frontend, no new permissions, no Celery.

**Tech Stack:** Django 4.2 + DRF, pytest + pytest-django. All money `Decimal(14,2)`.

**Spec:** `docs/superpowers/specs/2026-06-30-erp-crm-phase-8b-auto-posting-design.md`

---

## Reference patterns (read before starting)

- **8a services to reuse (do not duplicate):** `apps/accounts/services.py` — `seed_default_chart(shop)` (idempotent, `is_system=True`), `create_journal_entry(shop, data)` (validates balance + debit-xor-credit; builds a **draft**), `post_journal_entry(entry, user, source_ref=None)` (re-validates, sets posted + immutable). `DEFAULT_CHART` codes live at the top of that file.
- **8a models:** `apps/accounts/models.py` — `Account` (`code`, `account_type`, `normal_balance` property), `JournalEntry` (`entry_number`, `date`, `narration`, `reference`, `status`, `is_posted`), `JournalLine` (`entry`, `account`, `debit`, `credit`). Base class `core.models.BaseModel` (uuid `id`, `created_at`, `updated_at`).
- **Errors:** raise `core.exceptions.BusinessRuleViolation` (surfaces as HTTP 422 in views) — mirrors 8a/`apps/finance`.
- **Lazy cross-app imports:** every hook imports `from accounts import posting` **inside** the function, matching the existing convention (e.g. `apps/billing/services.py:50` `from core.exceptions import BusinessRuleViolation`, `apps/pos/services.py` `from core.models import DocumentCounter`).
- **Test fixtures to copy:** the `shop` + `client_with_perms` fixtures at the top of `apps/accounts/tests/test_journal.py` (JWT with `permissions` + `shop_ids`). POS/billing/finance service tests construct a `core.models.Shop` directly and call services with a `user` from `authentication.models.User`.
- **Method enums (for cash-vs-bank):** billing `Payment.Method` = cash/upi/card/cheque/neft/other; pos `SalePayment.Method` = cash/upi/card/cheque/neft/credit/other; billing `Refund.Method` = cash/upi/card/cheque/neft/other; pos `SalesReturn.RefundMethod` = cash/original_payment/store_credit/exchange. Rule: **`cash` → `cash` mapping, everything else → `bank` mapping.**

**Design decisions locked for this plan:**
- **Skip rule (essential):** if a shop has no `AccountMapping` rows, `accounting_enabled(shop)` is `False`; hooks must **not** build lines or post — the business event succeeds with **no** journal entry. A sale/invoice must never be blocked because accounting isn't enabled.
- **Idempotency:** one posted `JournalEntry` per `(shop, source_type, source_id)`, enforced by a partial unique constraint **and** a get-or-return check in `post_event`.
- **Atomic rollback:** when accounting **is** enabled but a mapping is missing, `resolve` raises `BusinessRuleViolation` inside the event's `atomic()` block → the whole business operation rolls back (nothing persisted).
- **Billing refund reverses the _payment_, not the invoice** (per user decision): `Dr Debtors / Cr Cash|Bank(refund.method) = refund.amount`, `source_type="billing.refund"`, `reverses` = the invoice's latest posted payment entry (best-effort link; `None` if none). Sales/GST are **not** touched. (Credit notes reverse the **invoice**; POS returns reverse the **sale**.)
- **Expense has no payment-method field** → the credit leg always goes to the `cash` mapping. Expense **category** resolves to `expense_<category_slug>` when such a mapping exists, else falls back to `expense_default` (never raises for a missing category key).

**Build order:** Task 1 (data model + mappings) → 2 (engine + recipes) → 3 (billing hooks) → 4 (POS hooks) → 5 (finance hook) → 6 (integration + verify). Each task ends in a commit.

**Test command (backend, from `backend/`):**
```bash
python -m pytest <path> -p no:cacheprovider -o addopts="" --create-db -q
```

---

## Task 1: `AccountMapping` model + `JournalEntry` source fields + `seed_default_mappings`

**Files:**
- Modify: `apps/accounts/models.py` (add `AccountMapping`; add 3 fields + constraint to `JournalEntry`)
- Modify: `apps/accounts/services.py` (add `DEFAULT_MAPPINGS`, `seed_default_mappings`; call it from `seed_default_chart`)
- Create: `apps/accounts/migrations/0002_accountmapping_journalentry_source.py` (via `makemigrations`)
- Create: `apps/accounts/tests/test_account_mapping.py`

- [ ] **Step 1: Write the failing tests** — `apps/accounts/tests/test_account_mapping.py` (copy the `shop` fixture from `test_journal.py`):

```python
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
    # keys resolve to the correct chart codes
    debtors = AccountMapping.objects.get(shop=shop, key="debtors")
    assert debtors.account.code == "1100"
    assert AccountMapping.objects.get(shop=shop, key="sales").account.code == "4000"


def test_seed_default_mappings_idempotent(shop):
    services.seed_default_chart(shop)
    before = AccountMapping.objects.filter(shop=shop).count()
    created = services.seed_default_mappings(shop)  # standalone, already seeded
    assert created == 0
    assert AccountMapping.objects.filter(shop=shop).count() == before


def test_seed_default_mappings_standalone_for_prechart_shop(shop):
    # Shop chart-seeded before 8b: mappings absent, chart present.
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


def test_journal_null_source_id_allows_many(shop, django_db_reset_sequences=None):
    import datetime as dt
    # Manual 8a entries leave source blank/null — many allowed.
    JournalEntry.objects.create(shop=shop, entry_number="JV-1", date=dt.date(2026, 7, 1))
    JournalEntry.objects.create(shop=shop, entry_number="JV-2", date=dt.date(2026, 7, 1))
    assert JournalEntry.objects.filter(shop=shop, source_id__isnull=True).count() == 2
```

- [ ] **Step 2: Run → FAIL**

Run: `python -m pytest apps/accounts/tests/test_account_mapping.py -p no:cacheprovider -o addopts="" --create-db -q`
Expected: FAIL — `ImportError: cannot import name 'AccountMapping'` / `AttributeError: seed_default_mappings`.

- [ ] **Step 3: Add the `AccountMapping` model + `JournalEntry` fields** — `apps/accounts/models.py`.

At the top, ensure the imports include `Q`, `UniqueConstraint`:
```python
from django.db import models
from django.db.models import Q, UniqueConstraint
```

Add these three fields to `JournalEntry` (after `posted_at`):
```python
    source_type = models.CharField(max_length=40, blank=True)
    source_id = models.UUIDField(null=True, blank=True)
    reverses = models.ForeignKey(
        "self", null=True, blank=True, on_delete=models.SET_NULL,
        related_name="reversed_by",
    )
```

Add the partial-unique constraint to `JournalEntry.Meta` (keep the existing `unique_together`, `ordering`, `indexes`):
```python
        constraints = [
            UniqueConstraint(
                fields=["shop", "source_type", "source_id"],
                condition=Q(source_id__isnull=False),
                name="uniq_journalentry_shop_source",
            ),
        ]
```

Append the new model at the end of the file:
```python
class AccountMapping(BaseModel):
    """Per-shop semantic key → account, used by the auto-posting engine."""

    shop = models.ForeignKey(
        "core.Shop", on_delete=models.PROTECT, related_name="account_mappings"
    )
    key = models.CharField(max_length=40)
    account = models.ForeignKey(Account, on_delete=models.PROTECT, related_name="mappings")

    class Meta:
        unique_together = (("shop", "key"),)
        ordering = ["key"]

    def __str__(self) -> str:
        return f"{self.key} → {self.account.code}"
```

- [ ] **Step 4: Add `DEFAULT_MAPPINGS` + `seed_default_mappings`; wire into `seed_default_chart`** — `apps/accounts/services.py`.

Add the import of the new model:
```python
from .models import Account, AccountMapping, JournalEntry, JournalLine
```

Add near `DEFAULT_CHART` (semantic key → chart code):
```python
# Semantic mapping keys → default-chart codes (Phase 8b auto-posting).
DEFAULT_MAPPINGS: dict[str, str] = {
    "cash": "1000",
    "bank": "1010",
    "debtors": "1100",
    "creditors": "2000",
    "gst_output": "2100",
    "gst_input": "1200",
    "sales": "4000",
    "other_income": "4100",
    "expense_default": "5900",
}


@transaction.atomic
def seed_default_mappings(shop) -> int:
    """Create the default account mappings for a shop. Idempotent — no-op if the
    shop already has any mapping. Resolves each key to the shop's account by code;
    silently skips a key whose account is absent. Returns the number created."""
    if AccountMapping.objects.filter(shop=shop).exists():
        return 0

    by_code = {a.code: a for a in Account.objects.filter(shop=shop)}
    to_create = [
        AccountMapping(shop=shop, key=key, account=by_code[code])
        for key, code in DEFAULT_MAPPINGS.items()
        if code in by_code
    ]
    AccountMapping.objects.bulk_create(to_create)
    return len(to_create)
```

At the **end** of `seed_default_chart(shop)`, before its `return`, seed mappings too (so `POST /chart/seed/` covers both):
```python
    Account.objects.bulk_create(
        [
            Account(shop=shop, code=code, name=name, account_type=acct_type, is_system=True)
            for code, name, acct_type in DEFAULT_CHART
        ]
    )
    seed_default_mappings(shop)
    return len(DEFAULT_CHART)
```

- [ ] **Step 5: Generate the migration**

Run: `python manage.py makemigrations accounts -n accountmapping_journalentry_source`
Expected: creates `apps/accounts/migrations/0002_accountmapping_journalentry_source.py` adding `AccountMapping`, the 3 `JournalEntry` fields, and the constraint. Adds-only (reversible; no column drops).

- [ ] **Step 6: Run → PASS**

Run: `python -m pytest apps/accounts/tests/test_account_mapping.py -p no:cacheprovider -o addopts="" --create-db -q`
Then the whole app: `python -m pytest apps/accounts -p no:cacheprovider -o addopts="" --create-db -q`
Expected: PASS (existing 8a tests still green).

- [ ] **Step 7: Commit**

```bash
git add apps/accounts/models.py apps/accounts/services.py apps/accounts/migrations/0002_accountmapping_journalentry_source.py apps/accounts/tests/test_account_mapping.py
git commit -m "feat(accounts): AccountMapping + JournalEntry source fields + seed_default_mappings"
```

---

## Task 2: Posting engine (`posting.py`) — recipes, `post_event`, `reverse_event`

**Files:**
- Create: `apps/accounts/posting.py`
- Modify: `apps/accounts/services.py` (`create_journal_entry` persists `source_type`/`source_id`/`reverses`)
- Create: `apps/accounts/tests/test_posting_engine.py`

- [ ] **Step 1: Extend `create_journal_entry` to persist the source fields** — `apps/accounts/services.py`, in the `JournalEntry.objects.create(...)` call inside `create_journal_entry`:

```python
    entry = JournalEntry.objects.create(
        shop=shop,
        entry_number=_next_entry_number(shop),
        date=data["date"],
        narration=data.get("narration", "") or "",
        reference=data.get("reference", "") or "",
        status=JournalEntry.Status.DRAFT,
        source_type=data.get("source_type", "") or "",
        source_id=data.get("source_id"),
        reverses=data.get("reverses"),
    )
```

(Manual 8a callers omit these keys → blank/null, unchanged behavior.)

- [ ] **Step 2: Write the failing engine tests** — `apps/accounts/tests/test_posting_engine.py`:

```python
"""Accounts › posting engine — recipes, post_event idempotency, reversals."""
import datetime as dt
import uuid
from decimal import Decimal
from functools import partial
from types import SimpleNamespace

import pytest

from accounts import posting, services
from accounts.models import AccountMapping, JournalEntry
from core.exceptions import BusinessRuleViolation


@pytest.fixture
def shop(db):
    from core.models import Shop
    return Shop.objects.create(
        name="Hotspot Repair", code="HTA", address="MG Road",
        city="Delhi", state="Delhi", state_code="07", phone="+919876543210",
    )


@pytest.fixture
def seeded_shop(shop):
    services.seed_default_chart(shop)  # chart + mappings
    return shop


def _resolve(shop):
    return partial(posting.resolve, shop)


def test_accounting_disabled_until_mapped(shop, seeded_shop):
    assert posting.accounting_enabled(seeded_shop) is True
    other = seeded_shop  # a shop with no mappings:
    AccountMapping.objects.filter(shop=other).delete()
    assert posting.accounting_enabled(other) is False


def test_resolve_raises_when_key_missing(seeded_shop):
    AccountMapping.objects.filter(shop=seeded_shop, key="debtors").delete()
    with pytest.raises(BusinessRuleViolation):
        posting.resolve(seeded_shop, "debtors")


def test_post_event_skips_when_disabled(shop):
    # No mappings seeded.
    entry = posting.post_event(
        shop, "billing.invoice", uuid.uuid4(),
        date=dt.date(2026, 7, 1), narration="x",
        lines=[{"account_id": uuid.uuid4(), "debit": Decimal("1.00"), "credit": Decimal("0.00")}],
    )
    assert entry is None
    assert JournalEntry.objects.filter(shop=shop).count() == 0


def test_post_event_creates_posted_entry_and_is_idempotent(seeded_shop):
    resolve = _resolve(seeded_shop)
    invoice = SimpleNamespace(
        subtotal=Decimal("1000.00"), discount_amount=Decimal("0.00"),
        cgst=Decimal("90.00"), sgst=Decimal("90.00"), igst=Decimal("0.00"),
        grand_total=Decimal("1180.00"), id=uuid.uuid4(), invoice_number="INV-1",
    )
    lines = posting.lines_for_repair_invoice(invoice, resolve)
    sid = invoice.id
    e1 = posting.post_event(seeded_shop, "billing.invoice", sid,
                            date=dt.date(2026, 7, 1), narration="INV-1", lines=lines)
    e2 = posting.post_event(seeded_shop, "billing.invoice", sid,
                            date=dt.date(2026, 7, 1), narration="INV-1", lines=lines)
    assert e1.id == e2.id
    assert e1.is_posted
    assert JournalEntry.objects.filter(shop=seeded_shop, source_type="billing.invoice").count() == 1


def test_invoice_recipe_is_balanced(seeded_shop):
    resolve = _resolve(seeded_shop)
    invoice = SimpleNamespace(
        subtotal=Decimal("1000.00"), discount_amount=Decimal("100.00"),
        cgst=Decimal("81.00"), sgst=Decimal("81.00"), igst=Decimal("0.00"),
        grand_total=Decimal("1062.00"),
    )
    lines = posting.lines_for_repair_invoice(invoice, resolve)
    assert sum(l["debit"] for l in lines) == sum(l["credit"] for l in lines) == Decimal("1062.00")
    debtors = posting.resolve(seeded_shop, "debtors").id
    assert next(l for l in lines if l["account_id"] == debtors)["debit"] == Decimal("1062.00")


def test_pos_sale_recipe_partial_paid(seeded_shop):
    resolve = _resolve(seeded_shop)
    sale = SimpleNamespace(
        subtotal=Decimal("500.00"), discount_amount=Decimal("0.00"),
        cgst=Decimal("45.00"), sgst=Decimal("45.00"), igst=Decimal("0.00"),
        amount_paid=Decimal("300.00"), amount_outstanding=Decimal("290.00"),
    )
    lines = posting.lines_for_pos_sale(sale, resolve)
    assert sum(l["debit"] for l in lines) == sum(l["credit"] for l in lines) == Decimal("590.00")


def test_payment_recipe_cash_vs_bank(seeded_shop):
    resolve = _resolve(seeded_shop)
    cash = posting.lines_for_billing_payment(
        SimpleNamespace(amount=Decimal("100.00"), method="cash"), resolve)
    upi = posting.lines_for_billing_payment(
        SimpleNamespace(amount=Decimal("100.00"), method="upi"), resolve)
    cash_acc = posting.resolve(seeded_shop, "cash").id
    bank_acc = posting.resolve(seeded_shop, "bank").id
    assert cash[0]["account_id"] == cash_acc
    assert upi[0]["account_id"] == bank_acc


def test_expense_recipe_defaults(seeded_shop):
    resolve = _resolve(seeded_shop)
    expense = SimpleNamespace(amount=Decimal("250.00"), category="", shop=seeded_shop)
    lines = posting.lines_for_expense(expense, resolve)
    exp_acc = posting.resolve(seeded_shop, "expense_default").id
    cash_acc = posting.resolve(seeded_shop, "cash").id
    assert next(l for l in lines if l["debit"] > 0)["account_id"] == exp_acc
    assert next(l for l in lines if l["credit"] > 0)["account_id"] == cash_acc


def test_reverse_event_full_and_partial(seeded_shop):
    resolve = _resolve(seeded_shop)
    invoice = SimpleNamespace(
        subtotal=Decimal("1000.00"), discount_amount=Decimal("0.00"),
        cgst=Decimal("90.00"), sgst=Decimal("90.00"), igst=Decimal("0.00"),
        grand_total=Decimal("1180.00"),
    )
    inv_id = uuid.uuid4()
    original = posting.post_event(
        seeded_shop, "billing.invoice", inv_id,
        date=dt.date(2026, 7, 1), narration="INV",
        lines=posting.lines_for_repair_invoice(invoice, resolve))

    rev = posting.reverse_event(
        seeded_shop, original_source_type="billing.invoice", original_source_id=inv_id,
        new_source_type="billing.creditnote", new_source_id=uuid.uuid4(),
        date=dt.date(2026, 7, 2), narration="CN", amount=Decimal("590.00"))

    assert rev.reverses_id == original.id
    lines = list(rev.lines.all())
    assert sum(l.debit for l in lines) == sum(l.credit for l in lines)  # still balanced
    # scaled to half → debtors credit ~590
    debtors = posting.resolve(seeded_shop, "debtors")
    assert sum(l.credit for l in lines if l.account_id == debtors.id) == Decimal("590.00")
    # original untouched
    original.refresh_from_db()
    assert original.is_posted and original.reverses_id is None


def test_reverse_event_returns_none_when_original_absent(seeded_shop):
    rev = posting.reverse_event(
        seeded_shop, original_source_type="pos.sale", original_source_id=uuid.uuid4(),
        new_source_type="pos.return", new_source_id=uuid.uuid4(),
        date=dt.date(2026, 7, 2), narration="x")
    assert rev is None
```

- [ ] **Step 3: Run → FAIL**

Run: `python -m pytest apps/accounts/tests/test_posting_engine.py -p no:cacheprovider -o addopts="" --create-db -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'accounts.posting'`.

- [ ] **Step 4: Write `apps/accounts/posting.py`**

```python
"""Phase 8b auto-posting engine.

Pure recipe functions turn a business object into balanced journal lines;
``post_event`` / ``reverse_event`` persist and post them via the 8a services.
All amounts are ``Decimal`` at 2dp; every recipe balances Σdebit == Σcredit.
"""
from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal

from core.exceptions import BusinessRuleViolation

from . import services
from .models import Account, AccountMapping, JournalEntry

TWO = Decimal("0.01")
ZERO = Decimal("0.00")


# ── Mapping resolution ────────────────────────────────────────────────────────
def accounting_enabled(shop) -> bool:
    """A shop has opted into auto-posting once it has any account mapping."""
    return AccountMapping.objects.filter(shop=shop).exists()


def resolve(shop, key: str) -> Account:
    """Resolve a semantic key to the shop's account. Raises when unmapped —
    surfaces misconfiguration and rolls the event's transaction back."""
    mapping = (
        AccountMapping.objects.select_related("account")
        .filter(shop=shop, key=key)
        .first()
    )
    if mapping is None:
        raise BusinessRuleViolation(f"No account mapped for '{key}'.")
    return mapping.account


def resolve_optional(shop, key: str) -> Account | None:
    """Non-raising lookup for optional keys (e.g. per-category expense accounts)."""
    mapping = (
        AccountMapping.objects.select_related("account")
        .filter(shop=shop, key=key)
        .first()
    )
    return mapping.account if mapping else None


def _cash_or_bank(method: str) -> str:
    return "cash" if method == "cash" else "bank"


def _q(value) -> Decimal:
    return Decimal(str(value)).quantize(TWO, rounding=ROUND_HALF_UP)


def _line(account_id, *, debit=ZERO, credit=ZERO) -> dict:
    return {"account_id": account_id, "debit": debit, "credit": credit}


def _assert_balanced(lines: list[dict]) -> list[dict]:
    total_debit = sum((l["debit"] for l in lines), ZERO)
    total_credit = sum((l["credit"] for l in lines), ZERO)
    if total_debit != total_credit:
        raise BusinessRuleViolation(
            f"Recipe produced an unbalanced entry: {total_debit} != {total_credit}."
        )
    return lines


# ── Recipes (pure) ────────────────────────────────────────────────────────────
def lines_for_repair_invoice(invoice, resolve) -> list[dict]:
    taxable = _q(invoice.subtotal - invoice.discount_amount)
    tax = _q(invoice.cgst + invoice.sgst + invoice.igst)
    lines = [_line(resolve("debtors").id, debit=_q(invoice.grand_total))]
    if taxable > 0:
        lines.append(_line(resolve("sales").id, credit=taxable))
    if tax > 0:
        lines.append(_line(resolve("gst_output").id, credit=tax))
    return _assert_balanced(lines)


def lines_for_billing_payment(payment, resolve) -> list[dict]:
    amount = _q(payment.amount)
    return _assert_balanced([
        _line(resolve(_cash_or_bank(payment.method)).id, debit=amount),
        _line(resolve("debtors").id, credit=amount),
    ])


def lines_for_pos_sale(sale, resolve) -> list[dict]:
    taxable = _q(sale.subtotal - sale.discount_amount)
    tax = _q(sale.cgst + sale.sgst + sale.igst)
    lines: list[dict] = []
    if sale.amount_paid > 0:
        lines.append(_line(resolve("cash").id, debit=_q(sale.amount_paid)))
    if sale.amount_outstanding > 0:
        lines.append(_line(resolve("debtors").id, debit=_q(sale.amount_outstanding)))
    if taxable > 0:
        lines.append(_line(resolve("sales").id, credit=taxable))
    if tax > 0:
        lines.append(_line(resolve("gst_output").id, credit=tax))
    return _assert_balanced(lines)


def lines_for_pos_payment(payment, resolve) -> list[dict]:
    amount = _q(payment.amount)
    return _assert_balanced([
        _line(resolve(_cash_or_bank(payment.method)).id, debit=amount),
        _line(resolve("debtors").id, credit=amount),
    ])


def _expense_key(category: str) -> str:
    return "expense_" + category.strip().lower().replace(" ", "_")


def lines_for_expense(expense, resolve) -> list[dict]:
    amount = _q(expense.amount)
    account = None
    if expense.category:
        account = resolve_optional(expense.shop, _expense_key(expense.category))
    if account is None:
        account = resolve("expense_default")
    return _assert_balanced([
        _line(account.id, debit=amount),
        _line(resolve("cash").id, credit=amount),  # Expense has no method → cash
    ])


def lines_for_refund(refund, resolve) -> list[dict]:
    amount = _q(refund.amount)
    return _assert_balanced([
        _line(resolve("debtors").id, debit=amount),
        _line(resolve(_cash_or_bank(refund.method)).id, credit=amount),
    ])


# ── Posting ───────────────────────────────────────────────────────────────────
def post_event(shop, source_type, source_id, *, date, narration, lines,
               user=None, reverses=None) -> JournalEntry | None:
    """Idempotently create + post a journal entry for one business event.

    Silent no-op (returns None) when accounting is disabled for the shop.
    Returns the existing entry unchanged when one already exists for the key.
    """
    if not accounting_enabled(shop):
        return None
    existing = JournalEntry.objects.filter(
        shop=shop, source_type=source_type, source_id=source_id
    ).first()
    if existing is not None:
        return existing
    entry = services.create_journal_entry(shop, {
        "date": date,
        "narration": narration,
        "lines": lines,
        "source_type": source_type,
        "source_id": source_id,
        "reverses": reverses,
    })
    return services.post_journal_entry(entry, user, source_ref=f"{source_type}:{source_id}")


def reverse_event(shop, *, original_source_type, original_source_id,
                  new_source_type, new_source_id, date, narration,
                  amount=None, user=None) -> JournalEntry | None:
    """Post a reversing entry (original lines with Dr/Cr swapped) for the reversed
    amount, linked via ``reverses``. Full reversal when ``amount`` is None.
    Returns None when accounting is disabled or the original posted entry is absent.
    The original entry is never mutated (8a immutability)."""
    if not accounting_enabled(shop):
        return None
    original = (
        JournalEntry.objects.filter(
            shop=shop, source_type=original_source_type,
            source_id=original_source_id, status=JournalEntry.Status.POSTED,
        )
        .prefetch_related("lines")
        .first()
    )
    if original is None:
        return None

    orig_lines = list(original.lines.all())
    original_total = sum((ln.debit for ln in orig_lines), ZERO)
    if amount is None or _q(amount) >= original_total or original_total == 0:
        scale = Decimal("1")
    else:
        scale = _q(amount) / original_total

    swapped = [
        _line(
            ln.account_id,
            debit=(ln.credit if scale == 1 else _q(ln.credit * scale)),
            credit=(ln.debit if scale == 1 else _q(ln.debit * scale)),
        )
        for ln in orig_lines
    ]
    _absorb_rounding(shop, swapped)
    return post_event(
        shop, new_source_type, new_source_id,
        date=date, narration=narration, lines=swapped, user=user, reverses=original,
    )


def _absorb_rounding(shop, lines: list[dict]) -> None:
    """Push any per-cent scaling residue onto the debtors/cash/bank plug leg so the
    reversing entry still satisfies Σdebit == Σcredit."""
    residual = sum((l["debit"] for l in lines), ZERO) - sum((l["credit"] for l in lines), ZERO)
    if residual == 0:
        return
    plug_ids = {
        resolve_optional(shop, k).id
        for k in ("debtors", "cash", "bank")
        if resolve_optional(shop, k) is not None
    }
    for line in lines:
        if line["account_id"] in plug_ids:
            if line["credit"] > 0:
                line["credit"] = _q(line["credit"] + residual)
            else:
                line["debit"] = _q(line["debit"] - residual)
            return
```

- [ ] **Step 5: Run → PASS**

Run: `python -m pytest apps/accounts/tests/test_posting_engine.py apps/accounts/tests/test_journal.py -p no:cacheprovider -o addopts="" --create-db -q`
Expected: PASS (8a journal tests unaffected by the `create_journal_entry` extension).

- [ ] **Step 6: Commit**

```bash
git add apps/accounts/posting.py apps/accounts/services.py apps/accounts/tests/test_posting_engine.py
git commit -m "feat(accounts): auto-posting engine — recipes, post_event, reverse_event"
```

---

## Task 3: Billing hooks — invoice, payment, credit-note + refund reversals

**Files:**
- Modify: `apps/billing/services.py` (`create_repair_invoice`, `record_payment`, `approve_credit_note`, `approve_refund`)
- Create: `apps/billing/tests/test_auto_posting.py`

Each hook sits **inside** the service's existing `transaction.atomic()` block (so posting rolls back with the event). `create_repair_invoice`'s atomic block ends at `_update_crm_on_invoice(...)`; `record_payment`'s ends at `_update_crm_on_payment(...)`; add the hook as the **last statement inside** that `with transaction.atomic():` block.

- [ ] **Step 1: Write the failing tests** — `apps/billing/tests/test_auto_posting.py`. Use the existing billing test setup to build a `job` + `invoice`; assert the journal side-effects. Sketch (adapt the job/shop factory from `apps/billing/tests/test_billing.py`):

```python
"""Billing → accounts auto-posting hooks (Phase 8b)."""
from decimal import Decimal

import pytest

from accounts import services as acc_services
from accounts.models import JournalEntry
from accounts.posting import resolve
from billing import services as billing_services


# Reuse the billing test's job/shop/user factory (import or copy from test_billing.py).
# `make_invoiceable_job(shop, user)` returns a job with a service_charge so an invoice
# produces Debtors / Sales / GST lines.


def test_invoice_posts_when_accounting_enabled(db, shop, user, invoiceable_job):
    acc_services.seed_default_chart(shop)  # enables accounting
    invoice = billing_services.create_repair_invoice(invoiceable_job, {}, user)

    entry = JournalEntry.objects.get(
        shop=shop, source_type="billing.invoice", source_id=invoice.id)
    assert entry.is_posted
    debtors = resolve(shop, "debtors")
    line = entry.lines.get(account=debtors)
    assert line.debit == invoice.grand_total


def test_invoice_skips_when_accounting_disabled(db, shop, user, invoiceable_job):
    # No chart/mappings seeded → skip rule.
    invoice = billing_services.create_repair_invoice(invoiceable_job, {}, user)
    assert invoice.id  # business op succeeded
    assert not JournalEntry.objects.filter(shop=shop, source_type="billing.invoice").exists()


def test_invoice_hook_is_idempotent(db, shop, user, invoiceable_job):
    acc_services.seed_default_chart(shop)
    invoice = billing_services.create_repair_invoice(invoiceable_job, {}, user)
    # A second create for the same job is blocked by billing itself; assert single entry.
    assert JournalEntry.objects.filter(
        shop=shop, source_type="billing.invoice", source_id=invoice.id).count() == 1


def test_payment_posts_cash_leg(db, shop, user, invoiceable_job):
    acc_services.seed_default_chart(shop)
    invoice = billing_services.create_repair_invoice(invoiceable_job, {}, user)
    pay = billing_services.record_payment(
        invoice, {"amount": str(invoice.grand_total), "method": "cash"}, user)
    entry = JournalEntry.objects.get(
        shop=shop, source_type="billing.payment", source_id=pay.id)
    assert entry.lines.get(account=resolve(shop, "cash")).debit == invoice.grand_total
    assert entry.lines.get(account=resolve(shop, "debtors")).credit == invoice.grand_total


def test_refund_reverses_payment(db, shop, user, invoiceable_job):
    acc_services.seed_default_chart(shop)
    invoice = billing_services.create_repair_invoice(invoiceable_job, {}, user)
    billing_services.record_payment(
        invoice, {"amount": str(invoice.grand_total), "method": "cash"}, user)
    refund = billing_services.create_refund(
        invoice, Decimal("100.00"), "cash", "damaged", user)
    billing_services.approve_refund(refund, user)

    entry = JournalEntry.objects.get(
        shop=shop, source_type="billing.refund", source_id=refund.id)
    assert entry.lines.get(account=resolve(shop, "debtors")).debit == Decimal("100.00")
    assert entry.lines.get(account=resolve(shop, "cash")).credit == Decimal("100.00")


def test_credit_note_reverses_invoice_scaled(db, shop, user, invoiceable_job):
    acc_services.seed_default_chart(shop)
    invoice = billing_services.create_repair_invoice(invoiceable_job, {}, user)
    cn = billing_services.create_credit_note(invoice, Decimal("50.00"), "adj", user)
    billing_services.approve_credit_note(cn, user)

    entry = JournalEntry.objects.get(
        shop=shop, source_type="billing.creditnote", source_id=cn.id)
    assert entry.reverses is not None
    total_debit = sum(l.debit for l in entry.lines.all())
    total_credit = sum(l.credit for l in entry.lines.all())
    assert total_debit == total_credit  # balanced reversal
    # Debtors is the plug leg (absorbs cent-rounding), so allow ±0.01.
    debtors_credit = entry.lines.get(account=resolve(shop, "debtors")).credit
    assert abs(debtors_credit - Decimal("50.00")) <= Decimal("0.01")
```

> If a shared billing `job`/`invoiceable_job` fixture does not already exist, add one to this file mirroring `apps/billing/tests/test_billing.py`'s setup (shop + customer + job with `service_charge`).

- [ ] **Step 2: Run → FAIL**

Run: `python -m pytest apps/billing/tests/test_auto_posting.py -p no:cacheprovider -o addopts="" --create-db -q`
Expected: FAIL — no `billing.invoice` / `billing.payment` entries created.

- [ ] **Step 3: Add the invoice + payment hooks** — `apps/billing/services.py`.

In `create_repair_invoice`, as the last statement **inside** the `with transaction.atomic():` block (right after `_update_crm_on_invoice(customer, grand_total)`):
```python
            from accounts import posting
            from django.utils import timezone
            if posting.accounting_enabled(shop):
                from functools import partial
                resolve = partial(posting.resolve, shop)
                posting.post_event(
                    shop, "billing.invoice", invoice.id,
                    date=timezone.now().date(),
                    narration=f"Repair invoice {invoice.invoice_number}",
                    lines=posting.lines_for_repair_invoice(invoice, resolve),
                    user=user,
                )
```

In `record_payment`, as the last statement **inside** its `with transaction.atomic():` block (right after `_update_crm_on_payment(invoice.customer, amount)`):
```python
            from accounts import posting
            if posting.accounting_enabled(invoice.shop):
                from functools import partial
                resolve = partial(posting.resolve, invoice.shop)
                posting.post_event(
                    invoice.shop, "billing.payment", payment.id,
                    date=payment.paid_at.date(),
                    narration=f"Payment for {invoice.invoice_number}",
                    lines=posting.lines_for_billing_payment(payment, resolve),
                    user=user,
                )
```

- [ ] **Step 4: Add the reversal hooks** — `apps/billing/services.py`.

In `approve_credit_note`, inside its `with transaction.atomic():` block (after `credit_note.save(...)`):
```python
        from accounts import posting
        posting.reverse_event(
            invoice.shop,
            original_source_type="billing.invoice", original_source_id=invoice.id,
            new_source_type="billing.creditnote", new_source_id=credit_note.id,
            date=credit_note.approved_at.date() if credit_note.approved_at else None,
            narration=f"Credit note {credit_note.credit_note_number}",
            amount=credit_note.amount, user=user,
        )
```
(`credit_note.approved_at` is set two lines above; fall back to `timezone.now().date()` if None.)

In `approve_refund`, inside its `with transaction.atomic():` block (after `refund.save(...)`), reverse the **payment** (per the locked decision) — build the refund's own lines and link `reverses` to the invoice's latest posted payment entry:
```python
        from accounts import posting
        if posting.accounting_enabled(invoice.shop):
            from functools import partial
            from accounts.models import JournalEntry
            resolve = partial(posting.resolve, invoice.shop)
            payment_ids = [str(p.id) for p in invoice.payments.all()]
            pay_entry = (
                JournalEntry.objects.filter(
                    shop=invoice.shop, source_type="billing.payment",
                    source_id__in=payment_ids, status=JournalEntry.Status.POSTED,
                )
                .order_by("-created_at")
                .first()
            )
            posting.post_event(
                invoice.shop, "billing.refund", refund.id,
                date=refund.approved_at.date() if refund.approved_at else None,
                narration=f"Refund {refund.refund_number}",
                lines=posting.lines_for_refund(refund, resolve),
                user=user, reverses=pay_entry,
            )
```

- [ ] **Step 5: Run → PASS**

Run: `python -m pytest apps/billing/tests/test_auto_posting.py apps/billing -p no:cacheprovider -o addopts="" --create-db -q`
Expected: PASS — new hooks green, existing billing suite (`test_billing.py`, `test_credit_notes.py`, `test_refunds.py`, `test_outstanding.py`) still green.

- [ ] **Step 6: Commit**

```bash
git add apps/billing/services.py apps/billing/tests/test_auto_posting.py
git commit -m "feat(billing): auto-post invoices, payments, credit-note + refund reversals"
```

---

## Task 4: POS hooks — sale, payment, return reversal

**Files:**
- Modify: `apps/pos/services.py` (`create_sale`, `add_payment`, `approve_return`)
- Create: `apps/pos/tests/test_auto_posting.py`

- [ ] **Step 1: Write the failing tests** — `apps/pos/tests/test_auto_posting.py` (adapt the shop/user/items setup from `apps/pos/tests/test_sales.py`):

```python
"""POS → accounts auto-posting hooks (Phase 8b)."""
from decimal import Decimal

import pytest

from accounts import services as acc_services
from accounts.models import JournalEntry
from accounts.posting import resolve
from pos import services as pos_services


def test_completed_sale_posts(db, shop, user, sale_data):
    acc_services.seed_default_chart(shop)
    sale = pos_services.create_sale(shop, sale_data, user)  # fully paid → COMPLETED
    entry = JournalEntry.objects.get(shop=shop, source_type="pos.sale", source_id=sale.id)
    assert entry.is_posted
    assert entry.lines.get(account=resolve(shop, "cash")).debit == sale.amount_paid


def test_draft_sale_does_not_post(db, shop, user, unpaid_sale_data):
    acc_services.seed_default_chart(shop)
    sale = pos_services.create_sale(shop, unpaid_sale_data, user)  # no payments → DRAFT
    assert sale.status == "draft"
    assert not JournalEntry.objects.filter(shop=shop, source_type="pos.sale").exists()


def test_sale_skips_when_accounting_disabled(db, shop, user, sale_data):
    sale = pos_services.create_sale(shop, sale_data, user)
    assert sale.id
    assert not JournalEntry.objects.filter(shop=shop, source_type="pos.sale").exists()


def test_add_payment_posts(db, shop, user, partial_sale_data):
    acc_services.seed_default_chart(shop)
    sale = pos_services.create_sale(shop, partial_sale_data, user)  # PARTIALLY_PAID
    pos_services.add_payment(sale, {"amount": str(sale.amount_outstanding), "method": "cash"}, user)
    assert JournalEntry.objects.filter(shop=shop, source_type="pos.payment").exists()


def test_return_reverses_sale_scaled(db, shop, user, sale_data):
    acc_services.seed_default_chart(shop)
    sale = pos_services.create_sale(shop, sale_data, user)
    ret = pos_services.create_return(
        sale, {"items": [], "reason": "defect", "refund_method": "cash",
               "total_refund_amount": "100.00"}, user)
    pos_services.approve_return(ret, user)

    entry = JournalEntry.objects.get(shop=shop, source_type="pos.return", source_id=ret.id)
    assert entry.reverses is not None
    assert sum(l.debit for l in entry.lines.all()) == sum(l.credit for l in entry.lines.all())
```

- [ ] **Step 2: Run → FAIL**

Run: `python -m pytest apps/pos/tests/test_auto_posting.py -p no:cacheprovider -o addopts="" --create-db -q`
Expected: FAIL — no `pos.sale` entries.

- [ ] **Step 3: Add the sale + payment hooks** — `apps/pos/services.py`.

In `create_sale`, as the last statement **inside** the `with transaction.atomic():` block (after the wholesale-outstanding update), gated on the paid status:
```python
        from accounts import posting
        if sale_status in (Sale.Status.COMPLETED, Sale.Status.PARTIALLY_PAID) and \
                posting.accounting_enabled(shop):
            from functools import partial
            from django.utils import timezone
            resolve = partial(posting.resolve, shop)
            posting.post_event(
                shop, "pos.sale", sale.id,
                date=timezone.now().date(),
                narration=f"POS sale {sale.sale_number}",
                lines=posting.lines_for_pos_sale(sale, resolve),
                user=user,
            )
```

In `add_payment`, capture the created payment and post inside the `with transaction.atomic():` block. Change `_record_payment(sale, payment_data, user)` to keep its return, then post after `sale.save(...)`:
```python
        payment = _record_payment(sale, payment_data, user)
        ...
        sale.save(update_fields=["amount_paid", "amount_outstanding", "status", "updated_at"])

        from accounts import posting
        if payment is not None and posting.accounting_enabled(sale.shop):
            from functools import partial
            from django.utils import timezone
            resolve = partial(posting.resolve, sale.shop)
            posting.post_event(
                sale.shop, "pos.payment", payment.id,
                date=timezone.now().date(),
                narration=f"POS payment for {sale.sale_number}",
                lines=posting.lines_for_pos_payment(payment, resolve),
                user=user,
            )
```

- [ ] **Step 4: Add the return reversal hook** — `apps/pos/services.py`, in `approve_return`, inside its `with transaction.atomic():` block (after `ret.sale.save(...)` / the wholesale-outstanding update):
```python
        from accounts import posting
        posting.reverse_event(
            ret.sale.shop,
            original_source_type="pos.sale", original_source_id=ret.sale.id,
            new_source_type="pos.return", new_source_id=ret.id,
            date=ret.approved_at.date() if ret.approved_at else None,
            narration=f"Sales return {ret.return_number}",
            amount=ret.total_refund_amount, user=user,
        )
```

- [ ] **Step 5: Run → PASS**

Run: `python -m pytest apps/pos/tests/test_auto_posting.py apps/pos -p no:cacheprovider -o addopts="" --create-db -q`
Expected: PASS — hooks green, existing `test_sales.py` still green.

- [ ] **Step 6: Commit**

```bash
git add apps/pos/services.py apps/pos/tests/test_auto_posting.py
git commit -m "feat(pos): auto-post sales, payments, and return reversals"
```

---

## Task 5: Finance hook — expense

**Files:**
- Modify: `apps/finance/services.py` (`create_expense`)
- Create: `apps/finance/tests/test_expense_posting.py`

- [ ] **Step 1: Write the failing tests** — `apps/finance/tests/test_expense_posting.py` (adapt the shop/user setup from `apps/finance/tests/test_finance.py`):

```python
"""Finance → accounts auto-posting for expenses (Phase 8b)."""
from decimal import Decimal

import pytest

from accounts import services as acc_services
from accounts.models import JournalEntry
from accounts.posting import resolve
from finance import services as finance_services


def test_expense_posts_to_default_account(db, shop, user):
    acc_services.seed_default_chart(shop)
    expense = finance_services.create_expense(
        shop, {"amount": "500.00", "category": "", "date": "2026-07-01"}, user)
    entry = JournalEntry.objects.get(shop=shop, source_type="finance.expense", source_id=expense.id)
    assert entry.lines.get(account=resolve(shop, "expense_default")).debit == Decimal("500.00")
    assert entry.lines.get(account=resolve(shop, "cash")).credit == Decimal("500.00")


def test_expense_skips_when_accounting_disabled(db, shop, user):
    expense = finance_services.create_expense(
        shop, {"amount": "500.00", "date": "2026-07-01"}, user)
    assert expense.id
    assert not JournalEntry.objects.filter(shop=shop, source_type="finance.expense").exists()
```

- [ ] **Step 2: Run → FAIL**

Run: `python -m pytest apps/finance/tests/test_expense_posting.py -p no:cacheprovider -o addopts="" --create-db -q`
Expected: FAIL — no `finance.expense` entry.

- [ ] **Step 3: Add the expense hook** — `apps/finance/services.py`, in `create_expense`, as the last statement **inside** the `with transaction.atomic():` block (after the budget-allocation update):
```python
        from accounts import posting
        if posting.accounting_enabled(shop):
            from functools import partial
            resolve = partial(posting.resolve, shop)
            posting.post_event(
                shop, "finance.expense", expense.id,
                date=expense.date,
                narration=expense.description or f"Expense {expense.category}".strip(),
                lines=posting.lines_for_expense(expense, resolve),
                user=user,
            )
```

- [ ] **Step 4: Run → PASS**

Run: `python -m pytest apps/finance/tests/test_expense_posting.py apps/finance -p no:cacheprovider -o addopts="" --create-db -q`
Expected: PASS — existing finance suite (`test_finance.py`, `test_cash_book.py`) still green.

- [ ] **Step 5: Commit**

```bash
git add apps/finance/services.py apps/finance/tests/test_expense_posting.py
git commit -m "feat(finance): auto-post expenses to the default expense account"
```

---

## Task 6: Integration tests + final verification

**Files:**
- Create: `apps/accounts/tests/test_auto_posting_integration.py`

- [ ] **Step 1: Write the integration tests** — full cycle, trial balance, atomic rollback:

```python
"""Phase 8b integration — full cycle balances; atomic rollback on misconfig."""
from decimal import Decimal

import pytest

from accounts import services as acc_services
from accounts.models import AccountMapping, JournalEntry
from accounts.services import trial_balance
from billing import services as billing_services
from core.exceptions import BusinessRuleViolation


def test_full_cycle_trial_balance_balances(db, shop, user, invoiceable_job):
    acc_services.seed_default_chart(shop)
    invoice = billing_services.create_repair_invoice(invoiceable_job, {}, user)
    billing_services.record_payment(
        invoice, {"amount": str(invoice.grand_total), "method": "cash"}, user)
    cn = billing_services.create_credit_note(invoice, Decimal("50.00"), "adj", user)
    billing_services.approve_credit_note(cn, user)

    tb = trial_balance(shop)  # 8a service: per-account debit/credit totals
    total_debit = sum(Decimal(str(r["debit"])) for r in tb)
    total_credit = sum(Decimal(str(r["credit"])) for r in tb)
    assert total_debit == total_credit  # the books balance after invoice+payment+credit note


def test_missing_mapping_rolls_back_the_whole_event(db, shop, user, invoiceable_job):
    acc_services.seed_default_chart(shop)
    AccountMapping.objects.filter(shop=shop, key="debtors").delete()  # enabled but misconfigured
    from billing.models import RepairInvoice
    with pytest.raises(BusinessRuleViolation):
        billing_services.create_repair_invoice(invoiceable_job, {}, user)
    # The invoice was NOT persisted — posting failure rolled back the business op.
    assert not RepairInvoice.objects.filter(job=invoiceable_job).exists()
    assert not JournalEntry.objects.filter(shop=shop, source_type="billing.invoice").exists()
```

> Confirm the `trial_balance(shop)` return shape against `apps/accounts/services.py` (Task 4 of 8a) and adjust the row-key access (`r["debit"]`/`r["credit"]`) to match.

- [ ] **Step 2: Run the integration tests → PASS**

Run: `python -m pytest apps/accounts/tests/test_auto_posting_integration.py -p no:cacheprovider -o addopts="" --create-db -q`
Expected: PASS.

- [ ] **Step 3: Full backend regression** across every touched app:

Run: `python -m pytest apps/accounts apps/billing apps/pos apps/finance apps/master -p no:cacheprovider -o addopts="" --create-db -q`
Expected: PASS.

- [ ] **Step 4: Migration reversibility** — the new `0002` migration is adds-only. Apply forward (covered by `--create-db`); then verify the down/up cycle:

Run: `python manage.py migrate accounts 0001 && python manage.py migrate accounts`
Expected: both directions succeed with no errors (run in the container/CI if no local DB).

- [ ] **Step 5: CI deny-list** — no new known-failures introduced:

Run: `grep -vc '^#\|^$' ci-known-failures.txt`
Expected: `0`.

- [ ] **Step 6: Commit**

```bash
git add apps/accounts/tests/test_auto_posting_integration.py
git commit -m "test(accounts): Phase 8b auto-posting integration — full cycle + atomic rollback"
```

---

## Notes for the implementer

- **Skip rule is the safety contract** — every hook gates on `posting.accounting_enabled(shop)` (directly, or via `post_event`/`reverse_event` returning `None`). A shop that hasn't seeded accounting must never have a sale/invoice/expense blocked or errored by posting.
- **Correctness core = idempotency + balance + atomic rollback.** Those tests (Task 1 constraint, Task 2 `post_event` idempotency, Task 6 rollback) are written first in their tasks.
- **Reuse, don't duplicate** — all persistence goes through 8a's `create_journal_entry` + `post_journal_entry`; balance/immutability logic lives there. `posting.py` only builds lines and orchestrates.
- **Lazy imports inside functions** for every hook (`from accounts import posting`) — avoids the billing/pos/finance ↔ accounts import cycle, matching each service's existing convention.
- **Money is `Decimal(14,2)`** — never floats; `_q()` quantizes with `ROUND_HALF_UP`; recipes assert Σdebit == Σcredit before returning.
- **Immutability** — reversals add new entries; the original posted entry is only read (never re-saved) in `reverse_event`.
- **No new permissions, no Celery, no frontend** this phase. `posted_by` is the acting `user` (may be null for system paths).
- **`source_id` type** — pass the object's `uuid` `id` straight through; Django matches `UUIDField` against a uuid or its str.
```