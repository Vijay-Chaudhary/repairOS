# Statement Section Parent/Child Account Nesting — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nest child accounts under their parent account inside P&L / Balance Sheet sections (the follow-up explicitly deferred from Phase 9), with per-group rollup totals, indented CSV export, and indented frontend rendering.

**Architecture:** Rows stay a **flat list** (no breaking shape change) but are emitted **depth-first** (parent immediately before its children) and each row gains two fields: `level` (indent depth, 0 = root) and `total` (own + descendant amounts — non-null only on rows that have visible children). `amount` remains the account's **own** movement for every row, so `Σ amount == subtotal` still holds exactly as in Phase 9. A parent with zero own balance but active children now appears as an `amount: 0.00` header row; fully-zero subtrees are still skipped. All work is in the existing statement builder (`backend/apps/accounts/services.py`), the row serializer, the CSV writer, and `StatementSectionTable.tsx`. No model/migration — `Account.parent` already exists.

**Tech Stack:** Django/DRF service + serializer, pytest; Next.js/TS, Vitest + RTL.

**Edge-case decisions (locked):**
- A child whose parent is **not in the same section** (cross-`account_type` parent — creatable via the COA API, which doesn't validate type match) is treated as a **root** of its own section.
- **Cycle safety:** parent cycles (possible via PATCH; nothing validates against them) must not crash or drop money — cycle members are appended as flat level-0 rows.
- Synthetic "Current Period Earnings" row: `level: 0, total: null`, unchanged otherwise.
- Trial Balance stays flat — out of scope.

**Environment notes:**
- Django root is `backend/` — `cd backend` before pytest. Run: `python3 -m pytest <path> --no-cov`.
- Frontend tests: `cd frontend && npx vitest run <path>`.
- Branch: `feature/erp-crm-statement-nesting` off `master`.

---

### Task 0: Branch

- [x] **Step 1: Create the feature branch**

```bash
git checkout -b feature/erp-crm-statement-nesting master
```

- [x] **Step 2: Commit this plan doc**

```bash
git add docs/superpowers/plans/2026-07-06-erp-crm-statement-nesting.md
git commit -m "docs(plan): statement section parent/child nesting"
```

---

### Task 1: Backend — nested section rows in the statement builder

**Files:**
- Modify: `backend/apps/accounts/services.py` (replace `_statement_row` + section assembly in `profit_and_loss` / `balance_sheet`)
- Test: `backend/apps/accounts/tests/test_financial_statements.py` (append a "Nesting" block)

- [x] **Step 1: Write the failing tests**

Append to `backend/apps/accounts/tests/test_financial_statements.py` (reuses the existing `shop`, `chart`, `entry_factory`, `client_with_perms` fixtures in that file):

```python
# ──────────────────────────────────────────────────────────────────────────────
# Parent/child nesting (Phase 9 follow-up)
# ──────────────────────────────────────────────────────────────────────────────


@pytest.fixture
def nested_expenses(db, shop, chart):
    """Expense head 5100 Salaries with two children; chart's flat 5200 Rent stays."""
    from accounts.models import Account
    parent = Account.objects.create(shop=shop, code="5100", name="Salaries", account_type="expense")
    tech = Account.objects.create(
        shop=shop, code="5110", name="Salaries — Tech", account_type="expense", parent=parent
    )
    office = Account.objects.create(
        shop=shop, code="5120", name="Salaries — Office", account_type="expense", parent=parent
    )
    return {"parent": parent, "tech": tech, "office": office}


@pytest.mark.django_db
def test_pnl_nests_children_under_parent(shop, chart, nested_expenses, entry_factory, client_with_perms):
    # Children post 400 + 250; the parent head itself posts 100 directly.
    entry_factory("2026-06-05", nested_expenses["tech"], chart["cash"], "400.00")
    entry_factory("2026-06-06", nested_expenses["office"], chart["cash"], "250.00")
    entry_factory("2026-06-07", nested_expenses["parent"], chart["cash"], "100.00")
    entry_factory("2026-06-10", chart["cash"], chart["sales"], "1000.00")

    client = client_with_perms(shop, ["accounts.reports.view"])
    data = client.get(PNL_URL).json()["data"]
    rows = data["expense"]["rows"]

    # Depth-first: parent immediately before its children, siblings code-ordered.
    assert [(r["code"], r["level"]) for r in rows] == [
        ("5100", 0), ("5110", 1), ("5120", 1),
    ]
    parent_row = rows[0]
    assert Decimal(parent_row["amount"]) == Decimal("100.00")      # own postings only
    assert Decimal(parent_row["total"]) == Decimal("750.00")       # own + descendants
    assert rows[1]["total"] is None and rows[2]["total"] is None   # leaves have no rollup
    # Subtotal is still the sum of own amounts — nesting must not change the math.
    assert Decimal(data["expense"]["subtotal"]) == Decimal("750.00")
    assert Decimal(data["net_profit"]) == Decimal("250.00")


@pytest.mark.django_db
def test_pnl_zero_balance_parent_shown_when_children_active(shop, chart, nested_expenses, entry_factory, client_with_perms):
    # Only a child posts; the parent head has no postings of its own.
    entry_factory("2026-06-05", nested_expenses["tech"], chart["cash"], "400.00")
    client = client_with_perms(shop, ["accounts.reports.view"])
    rows = client.get(PNL_URL).json()["data"]["expense"]["rows"]

    assert [(r["code"], r["level"]) for r in rows] == [("5100", 0), ("5110", 1)]
    assert Decimal(rows[0]["amount"]) == Decimal("0.00")
    assert Decimal(rows[0]["total"]) == Decimal("400.00")
    assert Decimal(client.get(PNL_URL).json()["data"]["expense"]["subtotal"]) == Decimal("400.00")


@pytest.mark.django_db
def test_pnl_skips_fully_zero_subtree(shop, chart, nested_expenses, entry_factory, client_with_perms):
    # No postings to the Salaries subtree at all → none of 5100/5110/5120 appear.
    entry_factory("2026-06-12", chart["rent"], chart["cash"], "300.00")
    client = client_with_perms(shop, ["accounts.reports.view"])
    rows = client.get(PNL_URL).json()["data"]["expense"]["rows"]
    assert [r["code"] for r in rows] == ["5200"]


@pytest.mark.django_db
def test_cross_type_parent_child_is_section_root(shop, chart, entry_factory, client_with_perms):
    # A misconfigured expense account parented under an income head must still
    # appear — as a root of the expense section, not nested and not dropped.
    from accounts.models import Account
    stray = Account.objects.create(
        shop=shop, code="5500", name="Stray Expense", account_type="expense", parent=chart["sales"]
    )
    entry_factory("2026-06-05", stray, chart["cash"], "75.00")
    client = client_with_perms(shop, ["accounts.reports.view"])
    data = client.get(PNL_URL).json()["data"]
    stray_row = next(r for r in data["expense"]["rows"] if r["code"] == "5500")
    assert stray_row["level"] == 0
    assert Decimal(data["expense"]["subtotal"]) == Decimal("75.00")


@pytest.mark.django_db
def test_parent_cycle_does_not_crash_or_drop_money(shop, chart, entry_factory):
    # Nothing prevents A→B→A via PATCH; the builder must survive it.
    from accounts import services
    from accounts.models import Account
    a = Account.objects.create(shop=shop, code="5601", name="Cycle A", account_type="expense")
    b = Account.objects.create(shop=shop, code="5602", name="Cycle B", account_type="expense")
    a.parent = b
    a.save(update_fields=["parent"])
    b.parent = a
    b.save(update_fields=["parent"])
    entry_factory("2026-06-05", a, chart["cash"], "50.00")
    entry_factory("2026-06-06", b, chart["cash"], "60.00")

    pnl = services.profit_and_loss(shop)
    codes = {r["code"]: r for r in pnl["expense"]["rows"]}
    assert {"5601", "5602"} <= set(codes)
    assert codes["5601"]["level"] == 0 and codes["5602"]["level"] == 0
    assert pnl["expense"]["subtotal"] == Decimal("110.00")


@pytest.mark.django_db
def test_balance_sheet_nesting_and_earnings_row_shape(shop, chart, entry_factory, client_with_perms):
    from accounts.models import Account
    bank = Account.objects.create(
        shop=shop, code="1010", name="Bank", account_type="asset", parent=chart["cash"]
    )
    entry_factory("2026-06-01", chart["cash"], chart["capital"], "5000.00")
    entry_factory("2026-06-02", bank, chart["capital"], "2000.00")
    entry_factory("2026-06-10", chart["cash"], chart["sales"], "1000.00")

    client = client_with_perms(shop, ["accounts.reports.view"])
    data = client.get(BS_URL).json()["data"]

    asset_rows = data["assets"]["rows"]
    assert [(r["code"], r["level"]) for r in asset_rows] == [("1000", 0), ("1010", 1)]
    assert Decimal(asset_rows[0]["amount"]) == Decimal("6000.00")
    assert Decimal(asset_rows[0]["total"]) == Decimal("8000.00")
    assert Decimal(data["assets"]["subtotal"]) == Decimal("8000.00")
    assert data["is_balanced"] is True

    earnings = next(r for r in data["equity"]["rows"] if r["name"] == "Current Period Earnings")
    assert earnings["level"] == 0
    assert earnings["total"] is None
```

- [x] **Step 2: Run the new tests to verify they fail**

```bash
cd backend && python3 -m pytest apps/accounts/tests/test_financial_statements.py -k "nest or cycle or cross_type or zero_subtree or earnings_row_shape" --no-cov -v
```

Expected: FAIL — rows have no `level` key (`KeyError: 'level'` / assertion mismatch).

- [x] **Step 3: Implement the tree builder in services.py**

In `backend/apps/accounts/services.py`, **delete** `_statement_row` and add in its place:

```python
def _section_tree_rows(accounts: list) -> list[dict]:
    """Depth-first statement rows for one section, nesting children under parents.

    `accounts` are code-ordered annotated Account instances of a single section.
    A subtree is emitted only if it has any non-zero balance; a parent with zero
    own balance but active children appears as a 0.00 header row. `amount` is
    always the account's own movement (so Σ amount == subtotal); `total` is
    own + descendants, set only on rows with emitted children. A parent outside
    the section makes the account a root; parent cycles fall back to flat rows.
    """
    ids_in_section = {acct.id for acct in accounts}
    children: dict = {}
    roots = []
    for acct in accounts:
        if acct.parent_id and acct.parent_id != acct.id and acct.parent_id in ids_in_section:
            children.setdefault(acct.parent_id, []).append(acct)
        else:
            roots.append(acct)

    own_amounts = {
        acct.id: _signed_movement(acct, acct.sum_debit, acct.sum_credit)
        for acct in accounts
    }

    def build(acct, level: int) -> tuple[list[dict], Decimal]:
        own = own_amounts[acct.id]
        child_rows: list[dict] = []
        total = own
        for child in children.get(acct.id, ()):
            rows, child_total = build(child, level + 1)
            child_rows.extend(rows)
            total += child_total
        if own == 0 and not child_rows:
            return [], Decimal("0.00")
        row = {
            "account_id": acct.id,
            "code": acct.code,
            "name": acct.name,
            "amount": own.quantize(TWO_PLACES),
            "level": level,
            "total": total.quantize(TWO_PLACES) if child_rows else None,
        }
        return [row, *child_rows], total

    out: list[dict] = []
    for root in roots:
        rows, _ = build(root, 0)
        out.extend(rows)

    # Parent cycles are unreachable from any root (every cycle member's parent is
    # in-section, so none lands in `roots`). Append survivors flat so no balance
    # silently disappears from the statement.
    emitted = {row["account_id"] for row in out}
    for acct in accounts:
        if acct.id not in emitted and own_amounts[acct.id] != 0:
            out.append({
                "account_id": acct.id,
                "code": acct.code,
                "name": acct.name,
                "amount": own_amounts[acct.id].quantize(TWO_PLACES),
                "level": 0,
                "total": None,
            })
    return out
```

Rewrite `profit_and_loss` to group per type and build each section:

```python
def profit_and_loss(shop, date_from=None, date_to=None) -> dict:
    """Income statement over an inclusive date window (both bounds optional).

    Income amounts are Σcredit−Σdebit, expenses Σdebit−Σcredit (per normal_balance);
    fully-zero subtrees are skipped, rows are depth-first with children nested
    under their parent account, siblings ordered by code.
    """
    by_type: dict[str, list] = {
        Account.AccountType.INCOME: [],
        Account.AccountType.EXPENSE: [],
    }
    accounts = _statement_accounts(
        shop, list(by_type.keys()), date_from=date_from, date_to=date_to
    )
    for acct in accounts:
        by_type[acct.account_type].append(acct)

    income_rows = _section_tree_rows(by_type[Account.AccountType.INCOME])
    expense_rows = _section_tree_rows(by_type[Account.AccountType.EXPENSE])
    income_subtotal = sum((r["amount"] for r in income_rows), Decimal("0.00"))
    expense_subtotal = sum((r["amount"] for r in expense_rows), Decimal("0.00"))
    return {
        "income": {"rows": income_rows, "subtotal": income_subtotal.quantize(TWO_PLACES)},
        "expense": {"rows": expense_rows, "subtotal": expense_subtotal.quantize(TWO_PLACES)},
        "net_profit": (income_subtotal - expense_subtotal).quantize(TWO_PLACES),
        "date_from": date_from,
        "date_to": date_to,
    }
```

Rewrite the section assembly in `balance_sheet` (the earnings loop and return shape stay as they are, except the synthetic row gains the two new keys):

```python
def balance_sheet(shop, as_of=None) -> dict:
    """Balance sheet snapshot at `as_of` (inclusive; None = latest).

    Income/expense accounts never appear as rows — their net up to `as_of` rolls
    into Equity as a synthetic "Current Period Earnings" line, which is what makes
    total_assets == total_liabilities + total_equity hold.
    """
    by_type: dict[str, list] = {
        Account.AccountType.ASSET: [],
        Account.AccountType.LIABILITY: [],
        Account.AccountType.EQUITY: [],
    }
    for acct in _statement_accounts(shop, list(by_type.keys()), date_to=as_of):
        by_type[acct.account_type].append(acct)
    sections = {
        acct_type: _section_tree_rows(accounts)
        for acct_type, accounts in by_type.items()
    }

    earnings = Decimal("0.00")
    pnl_types = [Account.AccountType.INCOME, Account.AccountType.EXPENSE]
    for acct in _statement_accounts(shop, pnl_types, date_to=as_of):
        signed = _signed_movement(acct, acct.sum_debit, acct.sum_credit)
        if acct.account_type == Account.AccountType.INCOME:
            earnings += signed
        else:
            earnings -= signed
    if earnings != 0:
        sections[Account.AccountType.EQUITY].append({
            "account_id": None,
            "code": None,
            "name": "Current Period Earnings",
            "amount": earnings.quantize(TWO_PLACES),
            "level": 0,
            "total": None,
        })

    def _subtotal(rows):
        return sum((r["amount"] for r in rows), Decimal("0.00")).quantize(TWO_PLACES)

    total_assets = _subtotal(sections[Account.AccountType.ASSET])
    total_liabilities = _subtotal(sections[Account.AccountType.LIABILITY])
    total_equity = _subtotal(sections[Account.AccountType.EQUITY])
    return {
        "assets": {"rows": sections[Account.AccountType.ASSET], "subtotal": total_assets},
        "liabilities": {"rows": sections[Account.AccountType.LIABILITY], "subtotal": total_liabilities},
        "equity": {"rows": sections[Account.AccountType.EQUITY], "subtotal": total_equity},
        "total_assets": total_assets,
        "total_liabilities": total_liabilities,
        "total_equity": total_equity,
        "is_balanced": total_assets == total_liabilities + total_equity,
        "as_of": as_of,
    }
```

Then add the two fields to `StatementRowSerializer` in `backend/apps/accounts/serializers.py`:

```python
class StatementRowSerializer(serializers.Serializer):
    # account_id/code are null for synthetic rows (e.g. Current Period Earnings).
    account_id = serializers.UUIDField(allow_null=True)
    code = serializers.CharField(allow_null=True)
    name = serializers.CharField()
    amount = serializers.DecimalField(max_digits=16, decimal_places=2)
    level = serializers.IntegerField()
    # Own + descendant amounts; null on rows without children.
    total = serializers.DecimalField(max_digits=16, decimal_places=2, allow_null=True)
```

- [x] **Step 4: Run the statement tests — new and old must all pass**

```bash
cd backend && python3 -m pytest apps/accounts/tests/test_financial_statements.py --no-cov -v
```

Expected: all PASS (the Phase 9 tests assert row `code`/`amount`/subtotals, which are unchanged).

- [x] **Step 5: Commit**

```bash
git add backend/apps/accounts/services.py backend/apps/accounts/serializers.py backend/apps/accounts/tests/test_financial_statements.py
git commit -m "feat(accounts): nest child accounts under parents in statement sections"
```

---

### Task 2: Backend — indent nested rows in CSV export

**Files:**
- Modify: `backend/apps/accounts/views.py` (`_statement_csv_response`)
- Test: `backend/apps/accounts/tests/test_financial_statements.py`

- [x] **Step 1: Write the failing test** (append to the nesting block):

```python
@pytest.mark.django_db
def test_pnl_csv_indents_child_rows(shop, chart, nested_expenses, entry_factory, client_with_perms):
    entry_factory("2026-06-05", nested_expenses["tech"], chart["cash"], "400.00")
    exporter = client_with_perms(shop, ["accounts.reports.view", "accounts.reports.export"])
    body = exporter.get(PNL_URL, {"format": "csv"}).content.decode()
    assert "5100,Salaries,0.00" in body
    assert "5110,  Salaries — Tech,400.00" in body  # two-space indent per level
```

- [x] **Step 2: Run it to verify it fails**

```bash
cd backend && python3 -m pytest apps/accounts/tests/test_financial_statements.py::test_pnl_csv_indents_child_rows --no-cov -v
```

Expected: FAIL — the name cell is unindented (`5110,Salaries — Tech,400.00`).

- [x] **Step 3: Indent the name by level in `_statement_csv_response`**

In `backend/apps/accounts/views.py`, change the row loop:

```python
        for row in section["rows"]:
            indent = "  " * row.get("level", 0)
            writer.writerow([row["code"] or "", indent + row["name"], row["amount"]])
```

- [x] **Step 4: Run the full accounts suite**

```bash
cd backend && python3 -m pytest apps/accounts --no-cov
```

Expected: all PASS.

- [x] **Step 5: Commit**

```bash
git add backend/apps/accounts/views.py backend/apps/accounts/tests/test_financial_statements.py
git commit -m "feat(accounts): indent nested rows in statement CSV export"
```

---

### Task 3: Frontend — types + nested rendering in StatementSectionTable

**Files:**
- Modify: `frontend/src/lib/api/accounts.ts` (`StatementRow`)
- Modify: `frontend/src/components/finance/StatementSectionTable.tsx`
- Modify: `frontend/src/app/(app)/finance/pnl/__tests__/pnl.test.tsx` (mock rows gain the new required fields)
- Modify: `frontend/src/app/(app)/finance/balance-sheet/__tests__/balanceSheet.test.tsx` (same)
- Test (new): `frontend/src/components/finance/__tests__/StatementSectionTable.test.tsx`

- [x] **Step 1: Write the failing component test**

Create `frontend/src/components/finance/__tests__/StatementSectionTable.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatementSectionTable } from '../StatementSectionTable';

const section = {
  rows: [
    { account_id: 'a-1', code: '5100', name: 'Salaries', amount: '100.00', level: 0, total: '750.00' },
    { account_id: 'a-2', code: '5110', name: 'Salaries — Tech', amount: '400.00', level: 1, total: null },
    { account_id: 'a-3', code: '5120', name: 'Salaries — Office', amount: '250.00', level: 1, total: null },
  ],
  subtotal: '750.00',
};

describe('StatementSectionTable', () => {
  it('indents child rows by level', () => {
    render(<StatementSectionTable title="Expenses" section={section} />);
    const child = screen.getByText('Salaries — Tech');
    expect(child).toHaveStyle({ paddingLeft: '2rem' }); // 0.75 + 1 * 1.25
    expect(screen.getByText('Salaries')).toHaveStyle({ paddingLeft: '0.75rem' });
  });

  it('shows a group rollup total on parent rows only', () => {
    render(<StatementSectionTable title="Expenses" section={section} />);
    expect(screen.getByText(/Σ/)).toBeInTheDocument(); // one parent → one rollup
    expect(screen.getAllByText(/Σ/)).toHaveLength(1);
  });
});
```

- [x] **Step 2: Run it to verify it fails**

```bash
cd frontend && npx vitest run src/components/finance/__tests__/StatementSectionTable.test.tsx
```

Expected: FAIL — no indent style, no `Σ` rollup rendered (TS may also fail on `level`/`total` not in `StatementRow`).

- [x] **Step 3: Add the fields to `StatementRow`** in `frontend/src/lib/api/accounts.ts`:

```ts
export interface StatementRow {
  // Null for synthetic rows (e.g. the Balance Sheet's "Current Period Earnings").
  account_id: string | null;
  code: string | null;
  name: string;
  amount: string;
  /** Indent depth in the section tree; 0 = root. */
  level: number;
  /** Own + descendant amounts; null on rows without children. */
  total: string | null;
}
```

- [x] **Step 4: Render nesting in `StatementSectionTable.tsx`** — replace the row `<tr>` body:

```tsx
          {section.rows.map((r) => (
            <tr key={r.account_id ?? r.name} className="border-t border-[var(--border)]">
              <td className="px-3 py-2 font-mono-num text-[var(--text-muted)] w-20">{r.code ?? '—'}</td>
              <td
                className={`px-3 py-2 ${r.total !== null ? 'font-medium' : ''}`}
                style={{ paddingLeft: `${0.75 + r.level * 1.25}rem` }}
              >
                {r.name}
              </td>
              <td className="px-3 py-2 text-right">
                <Money amount={r.amount} />
                {r.total !== null && (
                  <div className="text-xs text-[var(--text-muted)]">
                    Σ <Money amount={r.total} />
                  </div>
                )}
              </td>
            </tr>
          ))}
```

Also update the component's doc comment to: `/** One financial-statement section (P&L / Balance Sheet): depth-first nested rows + subtotal. */`

- [x] **Step 5: Update the two page-test mocks** — every mocked row in `pnl.test.tsx` and `balanceSheet.test.tsx` gains `level: 0, total: null`, e.g. in `pnl.test.tsx`:

```ts
      income: {
        rows: [{ account_id: 'a-4', code: '4000', name: 'Sales', amount: '1000.00', level: 0, total: null }],
        subtotal: '1000.00',
      },
      expense: {
        rows: [{ account_id: 'a-5', code: '5200', name: 'Rent', amount: '300.00', level: 0, total: null }],
        subtotal: '300.00',
      },
```

(Apply the same `level: 0, total: null` addition to every row literal in `balanceSheet.test.tsx`.)

- [x] **Step 6: Run the finance frontend tests + typecheck**

```bash
cd frontend && npx vitest run src/components/finance src/app/\(app\)/finance && npx tsc --noEmit
```

Expected: all PASS, no type errors.

- [x] **Step 7: Commit**

```bash
git add frontend/src/lib/api/accounts.ts frontend/src/components/finance/StatementSectionTable.tsx frontend/src/components/finance/__tests__/StatementSectionTable.test.tsx "frontend/src/app/(app)/finance/pnl/__tests__/pnl.test.tsx" "frontend/src/app/(app)/finance/balance-sheet/__tests__/balanceSheet.test.tsx"
git commit -m "feat(finance): render nested statement rows with indent + group totals"
```

---

### Task 4: Full suites, tick plan, PR

- [x] **Step 1: Full backend suite** (the 10 weasyprint PDF tests fail locally by design — ignore them; they pass in CI):

```bash
cd backend && python3 -m pytest --no-cov -q
```

Expected: everything green except the known weasyprint-import failures in commissions/hr/reports PDF tests.

- [x] **Step 2: Full frontend suite**

```bash
cd frontend && npx vitest run
```

Expected: all PASS.

- [x] **Step 3: Tick all checkboxes in this plan, commit**

```bash
git add docs/superpowers/plans/2026-07-06-erp-crm-statement-nesting.md
git commit -m "docs(plan): tick statement-nesting tasks"
```

- [x] **Step 4: Push + PR to master**

```bash
git push -u origin feature/erp-crm-statement-nesting
gh pr create --base master --title "feat(accounts): parent/child account nesting in financial statements" --body "..."
```

(Old `gh` CLI: no `pr checks --watch` — poll `gh pr checks` / `gh api` instead. Verify the PR base is `master` before merging.)
