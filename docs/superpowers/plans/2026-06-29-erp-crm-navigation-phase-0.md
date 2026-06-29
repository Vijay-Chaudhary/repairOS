# ERP/CRM Navigation — Phase 0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the sidebar to the approved target hierarchy, add stub routes + header shells for not-yet-built areas, and register the new permission slugs — without building any net-new feature module.

**Architecture:** The nav is data-driven via `NAV_ITEMS` in `frontend/src/components/shared/AppShell.tsx` (a flat array of `section`/`group`/`leaf` nodes, each leaf gated by `permission`/`anyOf`). We rewrite that array, add a shared `<ComingSoon/>` page for 9 stub routes, wire the existing header Search/Bell buttons to stub UIs (⌘K palette + notification dropdown), and append new slugs to the idempotent permission seed in `backend/apps/master/services.py`. Existing tenants are backfilled by the already-present, idempotent `backfill_role_permissions` management command.

**Tech Stack:** Next.js 14 App Router + TypeScript + Tailwind (frontend), Vitest + React Testing Library (frontend tests), Django + DRF (backend), pytest + pytest-django (backend tests).

**Spec:** `docs/superpowers/specs/2026-06-29-erp-crm-navigation-design.md` (§6 Phase-0 Implementation Notes).

**Working directory note:** the shell's cwd is the repo's `backend/` subdir in some sessions. All paths below are repo-relative; run frontend commands from `frontend/` and backend commands from `backend/`.

---

## File Structure

**Create:**
- `frontend/src/components/shared/ComingSoon.tsx` — shared placeholder page body.
- `frontend/src/components/shared/__tests__/ComingSoon.test.tsx` — its test.
- `frontend/src/components/shared/CommandPalette.tsx` — stubbed ⌘K search modal.
- `frontend/src/components/shared/__tests__/CommandPalette.test.tsx` — its test.
- 9 stub route pages under `frontend/src/app/(app)/…/page.tsx` (listed in Task 2).

**Modify:**
- `frontend/src/components/shared/AppShell.tsx` — rewrite `NAV_ITEMS`, add icon imports, wire header Search (⌘K palette) + Bell (dropdown).
- `frontend/src/components/shared/__tests__/navItems.test.ts` — update assertions to the new tree.
- `backend/apps/master/services.py` — append new slugs to `permissions_catalogue`.
- `backend/apps/master/tests/test_platform_admin.py` — add a seed-coverage test (or new file `backend/apps/master/tests/test_permission_seed.py`).

**Run (no code change):**
- `backend/apps/master/management/commands/backfill_role_permissions.py` — already idempotent; executed in Task 6.

---

## Task 1: Shared `<ComingSoon/>` component

**Files:**
- Create: `frontend/src/components/shared/ComingSoon.tsx`
- Test: `frontend/src/components/shared/__tests__/ComingSoon.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/shared/__tests__/ComingSoon.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ComingSoon } from '../ComingSoon';

describe('ComingSoon', () => {
  it('renders the title and a coming-soon message', () => {
    render(<ComingSoon title="Estimates" />);
    expect(screen.getByText('Estimates')).toBeInTheDocument();
    expect(screen.getByText(/coming soon/i)).toBeInTheDocument();
  });

  it('links back to the dashboard', () => {
    render(<ComingSoon title="Refunds" />);
    const link = screen.getByRole('link', { name: /dashboard/i });
    expect(link).toHaveAttribute('href', '/dashboard');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `frontend/`): `npx vitest run src/components/shared/__tests__/ComingSoon.test.tsx`
Expected: FAIL — cannot resolve `../ComingSoon`.

- [ ] **Step 3: Write the component**

Create `frontend/src/components/shared/ComingSoon.tsx`:

```tsx
import Link from 'next/link';
import { Construction } from 'lucide-react';

export function ComingSoon({ title }: { title: string }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-center px-4">
      <Construction className="h-12 w-12 text-[var(--text-muted)]" aria-hidden />
      <div>
        <h1 className="text-h1 font-semibold text-[var(--text)]">{title}</h1>
        <p className="text-body-sm text-[var(--text-muted)] mt-1">This feature is coming soon.</p>
      </div>
      <Link href="/dashboard" className="text-sm text-[var(--accent)] hover:underline">
        Back to dashboard
      </Link>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run (from `frontend/`): `npx vitest run src/components/shared/__tests__/ComingSoon.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/shared/ComingSoon.tsx frontend/src/components/shared/__tests__/ComingSoon.test.tsx
git commit -m "feat(nav): add shared ComingSoon placeholder component"
```

---

## Task 2: Stub route pages

Nine new routes, each rendering `<ComingSoon/>` so unbuilt nav leaves don't 404. Pages are server components (no `'use client'` needed — `ComingSoon` has no client hooks).

**Files (all Create):**
- `frontend/src/app/(app)/repair/estimates/page.tsx`
- `frontend/src/app/(app)/repair/warranty/page.tsx`
- `frontend/src/app/(app)/crm/deals/page.tsx`
- `frontend/src/app/(app)/crm/contacts/page.tsx`
- `frontend/src/app/(app)/purchases/returns/page.tsx`
- `frontend/src/app/(app)/billing/outstanding/page.tsx`
- `frontend/src/app/(app)/billing/credit-notes/page.tsx`
- `frontend/src/app/(app)/billing/refunds/page.tsx`
- `frontend/src/app/(app)/audit/page.tsx`

- [ ] **Step 1: Create the 9 page files**

Each file has this shape, with the `title` per the table below:

```tsx
import { ComingSoon } from '@/components/shared/ComingSoon';

export default function Page() {
  return <ComingSoon title="TITLE_HERE" />;
}
```

| File | `title` |
|---|---|
| `repair/estimates/page.tsx` | `Estimates` |
| `repair/warranty/page.tsx` | `Warranty` |
| `crm/deals/page.tsx` | `Deals` |
| `crm/contacts/page.tsx` | `Contacts` |
| `purchases/returns/page.tsx` | `Purchase Returns` |
| `billing/outstanding/page.tsx` | `Outstanding` |
| `billing/credit-notes/page.tsx` | `Credit Notes` |
| `billing/refunds/page.tsx` | `Refunds` |
| `audit/page.tsx` | `Audit Log` |

- [ ] **Step 2: Verify the project type-checks**

Run (from `frontend/`): `npx tsc --noEmit`
Expected: no errors (exit 0).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/\(app\)/repair/estimates frontend/src/app/\(app\)/repair/warranty \
        frontend/src/app/\(app\)/crm/deals frontend/src/app/\(app\)/crm/contacts \
        frontend/src/app/\(app\)/purchases/returns frontend/src/app/\(app\)/billing \
        frontend/src/app/\(app\)/audit
git commit -m "feat(nav): add 9 ComingSoon stub routes for unbuilt nav leaves"
```

---

## Task 3: Restructure `NAV_ITEMS`

Rewrite the nav to the target tree: add Repair › Estimates/Warranty; add CRM › Deals/Contacts; move **Tasks** out of CRM to a top-level Operations leaf; rename the Inventory group + surface Products/Suppliers + add Purchase Returns; add Billing › Outstanding/Credit Notes/Refunds; rename the Finance leaf label → **Accounts**; add Management › Audit Log. **Test-first** — the nav test drives the change.

**Files:**
- Modify: `frontend/src/components/shared/__tests__/navItems.test.ts`
- Modify: `frontend/src/components/shared/AppShell.tsx:5-10` (icon imports) and `:53-93` (`NAV_ITEMS`)

- [ ] **Step 1: Update the test to assert the new structure**

Replace the entire contents of `frontend/src/components/shared/__tests__/navItems.test.ts` with:

```ts
import { describe, it, expect } from 'vitest';
import { NAV_ITEMS, type NavEntry } from '../AppShell';

function group(label: string) {
  const entry = NAV_ITEMS.find((e: NavEntry) => e.type === 'group' && e.label === label);
  if (!entry || entry.type !== 'group') throw new Error(`${label} group not found`);
  return entry;
}

function leaf(href: string) {
  for (const e of NAV_ITEMS) {
    if (e.type === 'leaf' && e.href === href) return e;
    if (e.type === 'group') {
      const c = e.children.find((x) => x.href === href);
      if (c) return c;
    }
  }
  throw new Error(`leaf ${href} not found`);
}

describe('NAV_ITEMS — invariants', () => {
  it('every leaf carries a permission or anyOf (except Dashboard)', () => {
    for (const e of NAV_ITEMS) {
      if (e.type === 'leaf' && e.href !== '/dashboard') {
        expect(Boolean(e.permission) || Boolean(e.anyOf)).toBe(true);
      }
      if (e.type === 'group') {
        for (const c of e.children) {
          expect(Boolean(c.permission) || Boolean(c.anyOf)).toBe(true);
        }
      }
    }
  });

  it('has the four sections in order', () => {
    const sections = NAV_ITEMS.filter((e) => e.type === 'section').map((e) => e.label);
    expect(sections).toEqual(['Operations', 'Finance', 'Management', 'Config']);
  });
});

describe('NAV_ITEMS — Repair group', () => {
  it('starts with Overview at /repair on repair.jobs.view', () => {
    const c = group('Repair').children;
    expect(c[0].href).toBe('/repair');
    expect(c[0].label).toBe('Overview');
    expect(c[0].permission).toBe('repair.jobs.view');
  });

  it('adds Estimates on repair.estimates.view', () => {
    expect(leaf('/repair/estimates').permission).toBe('repair.estimates.view');
  });

  it('adds Warranty on repair.warranty.view', () => {
    expect(leaf('/repair/warranty').permission).toBe('repair.warranty.view');
  });
});

describe('NAV_ITEMS — CRM group', () => {
  it('starts with Overview at /crm on crm.customers.view', () => {
    const c = group('CRM').children;
    expect(c[0].href).toBe('/crm');
    expect(c[0].permission).toBe('crm.customers.view');
  });

  it('adds Deals on crm.deals.view', () => {
    expect(leaf('/crm/deals').permission).toBe('crm.deals.view');
  });

  it('adds Contacts on crm.contacts.view', () => {
    expect(leaf('/crm/contacts').permission).toBe('crm.contacts.view');
  });

  it('no longer contains Tasks inside the CRM group', () => {
    const hrefs = group('CRM').children.map((c) => c.href);
    expect(hrefs).not.toContain('/tasks');
  });
});

describe('NAV_ITEMS — Tasks is now a top-level Operations leaf', () => {
  it('exists as a top-level leaf gated on tasks.tasks.view or crm.tasks.manage', () => {
    const t = NAV_ITEMS.find((e) => e.type === 'leaf' && e.href === '/tasks');
    expect(t).toBeDefined();
    expect(t!.type === 'leaf' && t!.anyOf).toEqual(['tasks.tasks.view', 'crm.tasks.manage']);
  });
});

describe('NAV_ITEMS — Inventory group', () => {
  it('is labelled "Inventory"', () => {
    expect(group('Inventory').label).toBe('Inventory');
  });

  it('surfaces Products on erp.products.view', () => {
    expect(leaf('/products').label).toBe('Products');
    expect(leaf('/products').permission).toBe('erp.products.view');
  });

  it('renames the stock leaf to "Stock" at /inventory', () => {
    expect(leaf('/inventory').label).toBe('Stock');
    expect(leaf('/inventory').permission).toBe('erp.inventory.view');
  });

  it('surfaces Suppliers and Purchase Returns', () => {
    expect(leaf('/suppliers').permission).toBe('erp.suppliers.manage');
    expect(leaf('/purchases/returns').permission).toBe('erp.purchase_returns.view');
  });
});

describe('NAV_ITEMS — Billing group', () => {
  it('adds Outstanding, Credit Notes, Refunds', () => {
    expect(leaf('/billing/outstanding').permission).toBe('billing.outstanding.view');
    expect(leaf('/billing/credit-notes').permission).toBe('billing.credit_notes.view');
    expect(leaf('/billing/refunds').permission).toBe('billing.refunds.view');
  });
});

describe('NAV_ITEMS — Accounts + Audit', () => {
  it('renames the Finance leaf label to Accounts (route stays /finance)', () => {
    expect(leaf('/finance').label).toBe('Accounts');
    expect(leaf('/finance').permission).toBe('erp.expenses.view');
  });

  it('adds an Audit Log leaf on settings.audit.view', () => {
    expect(leaf('/audit').label).toBe('Audit Log');
    expect(leaf('/audit').permission).toBe('settings.audit.view');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `frontend/`): `npx vitest run src/components/shared/__tests__/navItems.test.ts`
Expected: FAIL — e.g. `leaf /crm/deals not found`, Accounts label mismatch, Tasks still in CRM.

- [ ] **Step 3: Add the new icon imports**

In `frontend/src/components/shared/AppShell.tsx`, replace the lucide-react import block (lines 5-10) with (adds `Target, Contact, ShieldCheck, Tag, Truck, Undo2, Clock, FileMinus, ScrollText`):

```tsx
import {
  LayoutDashboard, Wrench, Users, ShoppingCart, FileText,
  Package, ShoppingBag, CreditCard, TrendingUp, Settings,
  Building, BarChart3, DollarSign, Menu, X, ChevronDown,
  Bell, Search, LogOut, User, UserCheck, Boxes, Receipt, ClipboardList, ListChecks, Filter, Activity, Send,
  Target, Contact, ShieldCheck, Tag, Truck, Undo2, Clock, FileMinus, ScrollText,
} from 'lucide-react';
```

- [ ] **Step 4: Rewrite the `NAV_ITEMS` array**

Replace the `NAV_ITEMS` array (currently lines 53-93) with:

```tsx
export const NAV_ITEMS: NavEntry[] = [
  { type: 'section', label: 'Operations' },
  { type: 'leaf', label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { type: 'group', label: 'Repair', icon: Wrench, children: [
    { type: 'leaf', label: 'Overview',        href: '/repair',                icon: LayoutDashboard, permission: 'repair.jobs.view' },
    { type: 'leaf', label: 'Jobs',            href: '/jobs',                  icon: Wrench,          permission: 'repair.jobs.view' },
    { type: 'leaf', label: 'Estimates',       href: '/repair/estimates',      icon: FileText,        permission: 'repair.estimates.view' },
    { type: 'leaf', label: 'Spare Parts',     href: '/repair/spare-parts',    icon: Package,         permission: 'repair.spare_parts.request' },
    { type: 'leaf', label: 'Fault Templates', href: '/repair/fault-templates',icon: ClipboardList,   permission: 'repair.templates.manage' },
    { type: 'leaf', label: 'Warranty',        href: '/repair/warranty',       icon: ShieldCheck,     permission: 'repair.warranty.view' },
  ]},
  { type: 'group', label: 'CRM', icon: UserCheck, children: [
    { type: 'leaf', label: 'Overview',  href: '/crm',           icon: LayoutDashboard, permission: 'crm.customers.view' },
    { type: 'leaf', label: 'Leads',     href: '/leads',         icon: Users,           permission: 'crm.leads.view' },
    { type: 'leaf', label: 'Deals',     href: '/crm/deals',     icon: Target,          permission: 'crm.deals.view' },
    { type: 'leaf', label: 'Contacts',  href: '/crm/contacts',  icon: Contact,         permission: 'crm.contacts.view' },
    { type: 'leaf', label: 'Customers', href: '/customers',     icon: Users,           permission: 'crm.customers.view' },
    { type: 'leaf', label: 'Quotes',    href: '/crm/quotes',    icon: FileText,        permission: 'crm.leads.view' },
    { type: 'leaf', label: 'Activity',  href: '/crm/activity',  icon: Activity,        permission: 'crm.communications.log' },
    { type: 'leaf', label: 'Segments',  href: '/crm/segments',  icon: Filter,          permission: 'crm.segments.manage' },
    { type: 'leaf', label: 'Campaigns', href: '/crm/campaigns', icon: Send,            permission: 'crm.segments.manage' },
  ]},
  { type: 'leaf', label: 'POS',   href: '/pos',   icon: ShoppingCart, permission: 'pos.counter_sale.create' },
  { type: 'leaf', label: 'AMC',   href: '/amc',   icon: Building,     permission: 'amc.contracts.view' },
  { type: 'leaf', label: 'Tasks', href: '/tasks', icon: ListChecks,  anyOf: ['tasks.tasks.view', 'crm.tasks.manage'] },

  { type: 'section', label: 'Finance' },
  { type: 'group', label: 'Inventory', icon: Boxes, children: [
    { type: 'leaf', label: 'Products',        href: '/products',         icon: Tag,        permission: 'erp.products.view' },
    { type: 'leaf', label: 'Stock',           href: '/inventory',        icon: Package,    permission: 'erp.inventory.view' },
    { type: 'leaf', label: 'Suppliers',       href: '/suppliers',        icon: Truck,      permission: 'erp.suppliers.manage' },
    { type: 'leaf', label: 'Purchase Orders', href: '/purchases',        icon: ShoppingBag,permission: 'erp.purchase_orders.create' },
    { type: 'leaf', label: 'Purchase Returns',href: '/purchases/returns',icon: Undo2,      permission: 'erp.purchase_returns.view' },
  ]},
  { type: 'group', label: 'Billing', icon: Receipt, children: [
    { type: 'leaf', label: 'Invoices',     href: '/invoices',            icon: FileText,   permission: 'billing.repair_invoices.view' },
    { type: 'leaf', label: 'Payments',     href: '/payments',            icon: CreditCard, permission: 'billing.payments.record' },
    { type: 'leaf', label: 'Outstanding',  href: '/billing/outstanding', icon: Clock,      permission: 'billing.outstanding.view' },
    { type: 'leaf', label: 'Credit Notes', href: '/billing/credit-notes',icon: FileMinus,  permission: 'billing.credit_notes.view' },
    { type: 'leaf', label: 'Refunds',      href: '/billing/refunds',     icon: Undo2,      permission: 'billing.refunds.view' },
  ]},
  { type: 'leaf', label: 'Accounts', href: '/finance', icon: DollarSign, permission: 'erp.expenses.view' },

  { type: 'section', label: 'Management' },
  { type: 'leaf', label: 'Commissions', href: '/commissions', icon: TrendingUp, permission: 'hr.salary.view' },
  { type: 'leaf', label: 'HR',          href: '/hr',          icon: Users,       permission: 'hr.employees.view' },
  { type: 'leaf', label: 'Reports',     href: '/reports',     icon: BarChart3,   anyOf: ['reports.revenue.view', 'reports.repair.view'] },
  { type: 'leaf', label: 'Audit Log',   href: '/audit',       icon: ScrollText,  permission: 'settings.audit.view' },

  { type: 'section', label: 'Config' },
  { type: 'leaf', label: 'Settings', href: '/settings', icon: Settings, permission: 'settings.shop.edit' },
];
```

- [ ] **Step 5: Run the test to verify it passes**

Run (from `frontend/`): `npx vitest run src/components/shared/__tests__/navItems.test.ts`
Expected: PASS (all describe blocks green).

- [ ] **Step 6: Type-check**

Run (from `frontend/`): `npx tsc --noEmit`
Expected: no errors. (Confirms every icon name resolves.)

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/shared/AppShell.tsx frontend/src/components/shared/__tests__/navItems.test.ts
git commit -m "feat(nav): restructure NAV_ITEMS to target IA (Deals/Contacts, global Tasks, Inventory rename, Billing+Audit leaves, Accounts label)"
```

---

## Task 4: Header shells — ⌘K search palette + notification dropdown

Wire the two existing-but-dead header buttons (`AppShell.tsx:438-443`). Search opens a stubbed command palette (also via ⌘K / Ctrl-K); Bell opens a stubbed "all caught up" dropdown.

**Files:**
- Create: `frontend/src/components/shared/CommandPalette.tsx`
- Test: `frontend/src/components/shared/__tests__/CommandPalette.test.tsx`
- Modify: `frontend/src/components/shared/AppShell.tsx` (add `useEffect/useState` import; add palette state + ⌘K handler in the `AppShell` function; replace the Search + Bell buttons)

- [ ] **Step 1: Write the failing test for the palette**

Create `frontend/src/components/shared/__tests__/CommandPalette.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CommandPalette } from '../CommandPalette';

describe('CommandPalette', () => {
  it('renders the search input and coming-soon message when open', () => {
    render(<CommandPalette open={true} onOpenChange={() => {}} />);
    expect(screen.getByPlaceholderText(/search/i)).toBeInTheDocument();
    expect(screen.getByText(/coming soon/i)).toBeInTheDocument();
  });

  it('renders nothing when closed', () => {
    render(<CommandPalette open={false} onOpenChange={() => {}} />);
    expect(screen.queryByText(/coming soon/i)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `frontend/`): `npx vitest run src/components/shared/__tests__/CommandPalette.test.tsx`
Expected: FAIL — cannot resolve `../CommandPalette`.

- [ ] **Step 3: Write the CommandPalette component**

Create `frontend/src/components/shared/CommandPalette.tsx`:

```tsx
'use client';

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-[20%] translate-y-0">
        <DialogHeader>
          <DialogTitle className="sr-only">Search</DialogTitle>
        </DialogHeader>
        <Input autoFocus placeholder="Search customers, jobs, invoices…" />
        <p className="text-body-sm text-[var(--text-muted)] py-6 text-center">
          Global search is coming soon.
        </p>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run (from `frontend/`): `npx vitest run src/components/shared/__tests__/CommandPalette.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Add the React hooks import to AppShell**

In `frontend/src/components/shared/AppShell.tsx`, add this import near the top (after line 1 `'use client';`, alongside the other imports):

```tsx
import { useEffect, useState } from 'react';
```

Also add the palette import next to the other `@/components/shared/*` imports:

```tsx
import { CommandPalette } from '@/components/shared/CommandPalette';
```

- [ ] **Step 6: Add palette state + ⌘K handler inside the `AppShell` function**

In the `AppShell` function body (after `const router = useRouter();`, ~line 321), add:

```tsx
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
```

- [ ] **Step 7: Replace the dead Search + Bell buttons**

In the topbar (`AppShell.tsx:438-443`), replace the two `<button>` elements with the wired versions:

```tsx
            <button
              onClick={() => setPaletteOpen(true)}
              className="p-2 rounded-md hover:bg-[var(--surface-2)] text-[var(--text-muted)] min-h-[auto] min-w-[auto]"
              aria-label="Search"
            >
              <Search className="h-5 w-5" />
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="p-2 rounded-md hover:bg-[var(--surface-2)] text-[var(--text-muted)] min-h-[auto] min-w-[auto]"
                  aria-label="Notifications"
                >
                  <Bell className="h-5 w-5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <div className="px-2 py-1.5 text-xs font-semibold text-[var(--text-muted)]">Notifications</div>
                <div className="px-2 py-6 text-center text-body-sm text-[var(--text-muted)]">
                  You&apos;re all caught up.
                </div>
              </DropdownMenuContent>
            </DropdownMenu>
```

- [ ] **Step 8: Render the palette**

Just before the final closing `</TooltipProvider>` of `AppShell` (after the mobile bottom-tab `</nav>`, ~line 465), add:

```tsx
        <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
```

- [ ] **Step 9: Type-check + run the shared component tests**

Run (from `frontend/`):
```bash
npx tsc --noEmit
npx vitest run src/components/shared/__tests__/
```
Expected: tsc exit 0; all shared tests PASS (ComingSoon, CommandPalette, navItems).

- [ ] **Step 10: Commit**

```bash
git add frontend/src/components/shared/CommandPalette.tsx \
        frontend/src/components/shared/__tests__/CommandPalette.test.tsx \
        frontend/src/components/shared/AppShell.tsx
git commit -m "feat(nav): wire header ⌘K search palette + notification dropdown shells"
```

---

## Task 5: Register new permission slugs in the seed

Append the new slugs to `permissions_catalogue` in `_seed_roles_and_permissions`. Tenant Admin auto-receives every permission (existing "grant all" logic at `services.py:493-502`), so no `DEFAULT_ROLE_PERMISSIONS` change is needed. Assigning these to other roles happens when each module is built (out of scope here).

**Files:**
- Modify: `backend/apps/master/services.py` (the `permissions_catalogue` list, ~lines 346-395)
- Test: `backend/apps/master/tests/test_permission_seed.py` (new)

- [x] **Step 1: Write the failing test**

Create `backend/apps/master/tests/test_permission_seed.py`:

```python
"""Phase-0 nav blueprint: assert new permission slugs are seeded and granted to Tenant Admin.

The tenant DB router falls back to the default DB when no tenant alias is set
(see core/routers.py), so calling _seed_roles_and_permissions() under the `db`
fixture writes the catalogue into the test database.
"""

import pytest

NEW_SLUGS = [
    # crm
    "crm.deals.view", "crm.deals.create", "crm.deals.edit",
    "crm.deals.change_stage", "crm.deals.close",
    "crm.contacts.view", "crm.contacts.create", "crm.contacts.edit",
    # repair
    "repair.estimates.view",
    # erp
    "erp.products.view", "erp.products.manage", "erp.purchase_returns.view",
    # billing
    "billing.credit_notes.view", "billing.credit_notes.create", "billing.credit_notes.approve",
    "billing.refunds.view", "billing.refunds.create", "billing.refunds.approve",
    # accounts
    "accounts.income.view", "accounts.income.record", "accounts.cashbook.view",
    "accounts.bank.view", "accounts.bank.manage",
    "accounts.ledger.view", "accounts.ledger.export",
    "accounts.journal.view", "accounts.journal.create", "accounts.journal.post",
    # tasks
    "tasks.tasks.view", "tasks.tasks.manage",
    # hr
    "hr.departments.manage",
    # settings
    "settings.taxes.manage", "settings.branches.manage",
    "settings.integrations.manage", "settings.backup.manage", "settings.audit.view",
]


@pytest.mark.django_db
def test_new_slugs_are_seeded_and_granted_to_admin():
    from authentication.models import Permission, Role, RolePermission
    from master.services import _seed_roles_and_permissions

    _seed_roles_and_permissions()

    seeded = set(Permission.objects.values_list("codename", flat=True))
    missing = [s for s in NEW_SLUGS if s not in seeded]
    assert not missing, f"slugs not seeded: {missing}"

    admin = Role.objects.get(name="Tenant Admin")
    admin_slugs = set(
        RolePermission.objects.filter(role=admin).values_list("permission__codename", flat=True)
    )
    not_granted = [s for s in NEW_SLUGS if s not in admin_slugs]
    assert not not_granted, f"slugs not granted to Tenant Admin: {not_granted}"
```

- [x] **Step 2: Run the test to verify it fails**

Run (from `backend/`): `python -m pytest apps/master/tests/test_permission_seed.py -p no:cacheprovider -o addopts="" -q`
Expected: FAIL — `slugs not seeded: [...]` listing the new slugs.

- [x] **Step 3: Append the new slugs to the catalogue**

In `backend/apps/master/services.py`, inside `_seed_roles_and_permissions`, append these entries to the `permissions_catalogue` list (place each block under its module's existing comment; add new `# accounts` and `# tasks` comment groups before `# settings`):

```python
        # crm — Phase-0 nav blueprint additions
        ("crm.deals.view", "crm"), ("crm.deals.create", "crm"), ("crm.deals.edit", "crm"),
        ("crm.deals.change_stage", "crm"), ("crm.deals.close", "crm"),
        ("crm.contacts.view", "crm"), ("crm.contacts.create", "crm"), ("crm.contacts.edit", "crm"),
        # repair — Phase-0 additions
        ("repair.estimates.view", "repair"),
        # erp — Phase-0 additions
        ("erp.products.view", "erp"), ("erp.products.manage", "erp"),
        ("erp.purchase_returns.view", "erp"),
        # billing — Phase-0 additions
        ("billing.credit_notes.view", "billing"), ("billing.credit_notes.create", "billing"),
        ("billing.credit_notes.approve", "billing"),
        ("billing.refunds.view", "billing"), ("billing.refunds.create", "billing"),
        ("billing.refunds.approve", "billing"),
        # accounts — Phase-0 new module (expenses stay under erp.expenses.*)
        ("accounts.income.view", "accounts"), ("accounts.income.record", "accounts"),
        ("accounts.cashbook.view", "accounts"),
        ("accounts.bank.view", "accounts"), ("accounts.bank.manage", "accounts"),
        ("accounts.ledger.view", "accounts"), ("accounts.ledger.export", "accounts"),
        ("accounts.journal.view", "accounts"), ("accounts.journal.create", "accounts"),
        ("accounts.journal.post", "accounts"),
        # tasks — Phase-0 new global module
        ("tasks.tasks.view", "tasks"), ("tasks.tasks.manage", "tasks"),
        # hr — Phase-0 additions
        ("hr.departments.manage", "hr"),
        # settings — Phase-0 additions
        ("settings.taxes.manage", "settings"), ("settings.branches.manage", "settings"),
        ("settings.integrations.manage", "settings"), ("settings.backup.manage", "settings"),
        ("settings.audit.view", "settings"),
```

> Note: the catalogue is consumed by a `get_or_create` loop (`services.py:396-400`) and Tenant Admin is granted all permissions via the diff at `services.py:493-502`, so appending is sufficient — no other edits needed.

- [x] **Step 4: Run the test to verify it passes**

Run (from `backend/`): `python -m pytest apps/master/tests/test_permission_seed.py -p no:cacheprovider -o addopts="" -q`
Expected: PASS.

- [x] **Step 5: Run the broader master + auth suites for regressions**

Run (from `backend/`): `python -m pytest apps/master apps/authentication -p no:cacheprovider -o addopts="" -q`
Expected: PASS (no existing tests broken by the added slugs).

- [x] **Step 6: Commit**

```bash
git add backend/apps/master/services.py backend/apps/master/tests/test_permission_seed.py
git commit -m "feat(perms): seed Phase-0 nav permission slugs (deals, contacts, accounts, tasks, audit, …)"
```

---

## Task 6: Backfill existing tenants (ops step — no new code)

New slugs are added to already-provisioned tenant DBs by re-running the existing idempotent seed via `backfill_role_permissions`. New tenants get them automatically at provisioning. This task is a runbook step plus a verification.

- [ ] **Step 1: Run the backfill against all active tenants**

Run (from the deployment environment, per the command's docstring):
```bash
docker compose exec backend python manage.py backfill_role_permissions
```
Expected output: one `✓ <slug>` line per active tenant, ending with `Backfill complete.`

(For a single tenant during testing: `… backfill_role_permissions --slug <slug>`.)

- [ ] **Step 2: Verify a tenant received the new slugs**

Run (from the deployment environment):
```bash
docker compose exec backend python manage.py shell -c "
from core.context import set_tenant_db_alias
from master.models import TenantDatabase
from authentication.models import Permission
tdb = TenantDatabase.objects.using('default').filter(is_active=True).select_related('tenant').first()
set_tenant_db_alias(f'tenant_{tdb.tenant.slug}')
print('audit seeded:', Permission.objects.filter(codename='settings.audit.view').exists())
print('deals seeded:', Permission.objects.filter(codename='crm.deals.view').exists())
set_tenant_db_alias(None)
"
```
Expected: `audit seeded: True` and `deals seeded: True`.

> This step requires a running environment with provisioned tenants. If running in CI/local without tenants, skip and note it — there is no code to commit for this task.

---

## Final Verification

- [ ] **Step 1: Frontend — full test suite + type-check + lint**

Run (from `frontend/`):
```bash
npx tsc --noEmit
npm run test
npm run lint
```
Expected: tsc exit 0; all Vitest tests PASS; lint clean.

- [ ] **Step 2: Frontend — production build (catches route/SSR issues in the 9 stub pages)**

Run (from `frontend/`): `npm run build`
Expected: build succeeds; the 9 new routes appear in the route manifest.

- [ ] **Step 3: Backend — seed + auth suites**

Run (from `backend/`): `python -m pytest apps/master apps/authentication -p no:cacheprovider -o addopts="" -q`
Expected: PASS.

- [ ] **Step 4: Confirm CI deny-list is unaffected**

Run (from `backend/`): `cat ci-known-failures.txt`
Expected: still comments-only (no new entries needed; this plan adds no known-failing tests).

---

## Self-Review (completed by plan author)

- **Spec coverage (§6):** NAV_ITEMS rewrite → Task 3; 9 stub routes + ComingSoon → Tasks 1–2; header shells (⌘K + bell) → Task 4; seed new slugs + grant Admin → Task 5; idempotent backfill for existing tenants → Task 6; navItems test + backend slug test → Tasks 3 & 5. Accounts route stays `/finance` (label only) and Tasks `anyOf` transition are both encoded in Task 3. Dense-area tabs are explicitly *not* in Phase 0 (spec §6 decision 2) — correct to omit.
- **Placeholder scan:** none — every code step contains full code; every run step has an exact command + expected result.
- **Type/name consistency:** `ComingSoon({ title })`, `CommandPalette({ open, onOpenChange })`, and the `NavLeaf`/`NavGroup` shapes match across tasks; the 36 slugs in the Task 5 test list exactly match the 36 catalogue entries added in Task 5 Step 3; nav permission strings in Task 3 match those slugs (`crm.deals.view`, `crm.contacts.view`, `repair.estimates.view`, `erp.products.view`, `erp.purchase_returns.view`, `billing.credit_notes.view`, `billing.refunds.view`, `settings.audit.view`) and reuse existing slugs where intended (`repair.warranty.view`, `billing.outstanding.view`, `erp.inventory.view`, `erp.suppliers.manage`, `erp.expenses.view`, `crm.tasks.manage`).
- **Out of scope (unchanged):** no net-new feature modules, no uniform-CRUD migration, no 3rd nav level.
