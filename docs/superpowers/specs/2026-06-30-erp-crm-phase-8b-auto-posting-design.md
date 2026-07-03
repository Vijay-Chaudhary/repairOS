# ERP/CRM Phase 8b — Auto-Posting (design)

**Status:** approved design · **Date:** 2026-06-30 · **Author:** brainstormed with user
**Predecessor:** Phase 8a accounting core (`apps/accounts`) — PR #30. 8a left
`post_journal_entry(entry, user, source_ref=...)` as the reuse hook for this phase.

---

## 1. Goal

Automatically generate **balanced, posted double-entry journal entries** in `apps/accounts`
whenever a money-moving business event occurs — repair invoices, POS sales, customer payments,
expenses — and post **reversing entries** when those are undone (returns, refunds, credit notes).
Auto-posting is **synchronous and atomic** (inside the originating event's transaction),
**idempotent** (one posted entry per source event), and **opt-in per shop** (only active once a
shop has seeded its chart + mappings). No frontend in this phase — this is a backend posting engine.

## 2. Scope

**In scope — events that auto-post:**
- `billing.create_repair_invoice` — credit sale: Dr Debtors / Cr Sales / Cr GST Output.
- `billing.record_payment` — Dr Cash|Bank / Cr Debtors.
- `pos.create_sale` — Dr Cash (paid) and/or Debtors (outstanding) / Cr Sales / Cr GST Output.
- `pos.add_payment` — Dr Cash / Cr Debtors.
- `finance.create_expense` — Dr Expense (mapped) / Cr Cash|Bank.
- **Reversals**: `pos.create_return`/`approve_return`, billing credit notes, billing refunds →
  a new reversing entry (Dr/Cr swapped) for the reversed amount, linked to the original.

**Non-goals (explicitly out, this phase):**
- COGS / inventory movement (needs inventory valuation — separate topic).
- Historical backfill — auto-posting applies to **new events only**; pre-existing records stay
  unposted (enter manually if needed).
- Account-mapping **settings UI** — mappings are seeded data, editable later.
- **Async/Celery** posting — posting is synchronous in the event transaction.
- Bank reconciliation & the Income module (separate 8b sub-projects, own specs).
- CGST/SGST/IGST split — all output tax lumps into a single **GST Output** account, matching 8a's
  single seeded "GST Payable".

## 3. Key decisions (locked during brainstorming)

| Decision | Choice |
|---|---|
| Event scope | Full cycle incl. reversing entries |
| Account mapping | `AccountMapping` model per shop, semantic keys → account, seeded to default chart; no UI |
| Posting timing | **Synchronous, same DB transaction** as the business event (rolls back together) |
| Backfill | **New events only** |
| Engine shape | Centralized engine + explicit service calls (not signals, not a generic rule table) |

## 4. Architecture

New module `apps/accounts/posting.py` (the engine) + a new `AccountMapping` model + two new
fields/links on `JournalEntry`. Business services (`billing`, `pos`, `finance`) call the engine at
the tail of their existing `transaction.atomic()` blocks. Recipes are pure functions that turn a
business object into balanced lines; the engine persists + posts them via the existing 8a services.

```
billing/pos/finance service (inside atomic())
        │  builds business object (invoice / sale / payment / expense / return)
        ▼
posting.post_event(shop, source_type, source_id, date, narration, lines)   ← idempotent
        │  get-or-create JournalEntry on (shop, source_type, source_id)
        ▼
accounts.services.create_journal_entry → post_journal_entry(source_ref=...)
        ▼
JournalEntry (posted, immutable) + JournalLines  ──►  Ledger / Trial Balance (8a)
```

## 5. Data model

### 5.1 `AccountMapping(BaseModel)` (new)
- `shop` FK → `core.Shop` (PROTECT, related_name `account_mappings`)
- `key` CharField(40) — stable semantic slug
- `account` FK → `accounts.Account` (PROTECT, related_name `mappings`)
- `Meta`: `unique_together = (("shop", "key"),)`, `ordering = ["key"]`

**Seeded keys → default chart (8a codes):**

| key | account (code) |
|---|---|
| `cash` | Cash (1000) |
| `bank` | Bank (1010) |
| `debtors` | Sundry Debtors (1100) |
| `creditors` | Sundry Creditors (2000) |
| `gst_output` | GST Payable (2100) |
| `gst_input` | GST Input Credit (1200) |
| `sales` | Sales (4000) |
| `other_income` | Other Income (4100) |
| `expense_default` | Miscellaneous Expenses (5900) |

`services.seed_default_mappings(shop)` — idempotent; no-op if the shop already has mappings.
Resolves each key to the shop's account by code; skips a key whose account is absent. Called from
`seed_default_chart(shop)` (so the existing `POST /chart/seed/` seeds mappings too) and safe to call
standalone for shops chart-seeded before 8b.

### 5.2 `JournalEntry` additions (migration)
- `source_type` CharField(40, blank) — e.g. `billing.invoice`, `pos.sale`, `finance.expense`.
- `source_id` UUIDField(null, blank) — the originating object's id.
- `reverses` self-FK (null, blank, SET_NULL, related_name `reversed_by`) — the original entry a
  reversal cancels.
- Partial unique constraint `(shop, source_type, source_id)` **where `source_id` is not null**
  (`UniqueConstraint(..., condition=Q(source_id__isnull=False))`) — the idempotency guarantee.
- Manual entries (8a) leave these blank/null and are unaffected.

## 6. Posting engine (`apps/accounts/posting.py`)

- `accounting_enabled(shop) -> bool` — `AccountMapping.objects.filter(shop=shop).exists()`.
- `resolve(shop, key) -> Account` — mapping lookup; raises `BusinessRuleViolation`
  (`"No account mapped for '<key>'."`) if missing **when accounting is enabled** (surfaces
  misconfiguration → rolls the transaction back).
- `post_event(shop, source_type, source_id, *, date, narration, lines, user=None) -> JournalEntry | None`
  - **Skip rule:** if `not accounting_enabled(shop)`, return `None` (silent no-op — operations are
    never blocked for shops that haven't enabled accounting).
  - **Idempotency:** if a `JournalEntry` already exists for `(shop, source_type, source_id)`, return
    it unchanged.
  - Else build via `create_journal_entry(shop, {date, narration, lines, source_type, source_id})`
    then `post_journal_entry(entry, user, source_ref=f"{source_type}:{source_id}")`. (8a's
    `create_journal_entry` is extended to accept + persist `source_type`/`source_id`.)
- `reverse_event(shop, *, original_source_type, original_source_id, new_source_type, new_source_id,
  date, narration, amount=None, user=None) -> JournalEntry | None`
  - Finds the original **posted** entry by `(shop, original_source_type, original_source_id)`;
    returns `None` if absent or accounting disabled.
  - Posts a new entry built from the **original entry's lines with Dr/Cr swapped**, `source_type/id =
    new_*`, `reverses = original`. Idempotent on the new key.
  - **Partial reversal:** when `amount < original_total`, each swapped line is scaled by
    `amount / original_total` and quantized to 2dp; any rounding residue is absorbed into the
    cash/debtors leg so the reversing entry still satisfies Σdebit == Σcredit. Full reversal when
    `amount` is None.
  - The original posted entry is **never mutated** (8a immutability).

**Recipe functions** (pure; `(business_obj, resolve_fn) -> list[{account, debit, credit}]`), one per
event: `lines_for_repair_invoice`, `lines_for_billing_payment`, `lines_for_pos_sale`,
`lines_for_pos_payment`, `lines_for_expense`. Reversals reuse the original entry's lines, swapped.
All amounts `Decimal(14,2)`; every recipe asserts Σdebit == Σcredit before returning.

### 6.1 Recipe details

| Event | Debit | Credit |
|---|---|---|
| Repair invoice (credit) | Debtors = grand_total | Sales = taxable; GST Output = tax |
| Billing payment | Cash or Bank (by method) = amount | Debtors = amount |
| POS sale | Cash = amount_paid; Debtors = amount_outstanding | Sales = taxable; GST Output = tax |
| POS payment | Cash = amount | Debtors = amount |
| Expense | mapped expense account (else `expense_default`) = amount | Cash or Bank (by method) = amount |
| Return / refund / credit note | (reversal of the source entry, scaled to reversed amount) | |

Cash-vs-bank is selected from the event's payment method (`upi`/`card`/`bank` → `bank`,
`cash` → `cash`). Expense category → account mapping falls back to `expense_default` when unmapped.

## 7. Event hooks (surgical edits)

Each call sits at the end of the service's existing `atomic()` block, after the business object and
its audit log are created, so posting commits or rolls back with the event:

- `billing.services.create_repair_invoice` → `post_event("billing.invoice", invoice.id, ...)`
- `billing.services.record_payment` → `post_event("billing.payment", payment.id, ...)`
- `pos.services.create_sale` → `post_event("pos.sale", sale.id, ...)` (only when sale is
  COMPLETED/PARTIALLY_PAID — not DRAFT)
- `pos.services.add_payment` → `post_event("pos.payment", payment.id, ...)`
- `finance.services.create_expense` → `post_event("finance.expense", expense.id, ...)`
- `pos.services.approve_return` (and credit-note/refund equivalents in billing) →
  `reverse_event(original="pos.sale"/"billing.invoice"/..., new="pos.return"/..., amount=...)`

Hooks import `accounts.posting` lazily inside the function to avoid cross-app import cycles, mirroring
the existing lazy-import convention in these services.

## 8. Testing (TDD)

- **Recipes** (pure, fast): balanced lines for a taxable+GST invoice; fully-paid vs partially-paid
  POS sale; cash vs bank payment; expense by category and by default.
- **Idempotency**: invoking a hook twice for one source → exactly one posted entry.
- **Reversal**: a return posts a swapped entry scaled to the returned amount, `reverses` links the
  original, original immutable; net ledger nets to the un-returned remainder.
- **Skip rule**: a shop with no mappings → event succeeds, **no** journal entry created.
- **Atomic rollback**: a forced posting error (missing mapping while accounting enabled) rolls back
  the whole business operation — the sale/invoice/expense is not persisted either.
- **Integration invariant**: after invoice → payment → partial return, the **trial balance balances**
  and the debtor ledger is correct.
- Per existing project rule: every touched endpoint keeps serializer + `permission_classes` + tests
  green (billing/pos/finance suites must still pass).

## 9. Cross-cutting requirements
- **Money** `Decimal(14,2)`, never floats; balance checks in `Decimal`.
- **Tenant/shop scoping** preserved; posting always uses the event's own shop.
- **Immutability**: reversals add new entries; posted entries are never edited (8a invariant).
- **Migrations reversible**: `AccountMapping` create + `JournalEntry` field/constraint adds; no column
  drops.
- **No new permissions** — auto-posting is system-driven (`posted_by` may be the acting user or null);
  it reuses 8a's accounting permission surface.
- **Idempotency** is the correctness core alongside balance + atomic rollback — write those tests first.

## 10. Build order (each task = its own TDD commit)
1. `AccountMapping` model + `seed_default_mappings` (wired into `seed_default_chart`) +
   `JournalEntry.source_type/source_id/reverses` + partial-unique constraint + migration + tests.
2. `posting.py` engine (`accounting_enabled`/`resolve`/`post_event`/`reverse_event`) + extend
   `create_journal_entry` to persist `source_type/source_id` + recipe builders + unit tests.
3. Billing hooks — invoice, payment, credit-note/refund reversal + tests.
4. POS hooks — sale, payment, return reversal + tests.
5. Finance hook — expense + tests.
6. Integration tests (full cycle, trial balance balances, skip rule, atomic rollback) + verification
   (backend suites, migration reversibility, CI deny-list `0`).

## 11. Notes for the planner
- Mirror 8a/`apps/finance` conventions: services hold logic; lazy imports across apps; `BusinessRuleViolation` → 422.
- The **skip rule is essential** — a shop that hasn't seeded accounting must never have a sale/invoice
  blocked by posting. Gate every hook on `accounting_enabled(shop)` via `post_event` returning `None`.
- Reuse 8a's `create_journal_entry` + `post_journal_entry` — do not duplicate balance/immutability logic.
- Backfilling existing shops chart-seeded before 8b: `seed_default_mappings` is standalone-safe; a
  one-liner data migration MAY seed mappings for shops that already have a system chart (optional,
  idempotent) — but no historical transaction backfill.
