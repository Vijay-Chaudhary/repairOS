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
