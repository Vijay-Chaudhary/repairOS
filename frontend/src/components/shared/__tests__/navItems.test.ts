import { describe, it, expect } from 'vitest';
import { NAV_ITEMS, type NavEntry } from '../AppShell';

function repairGroup() {
  const entry = NAV_ITEMS.find(
    (e: NavEntry) => e.type === 'group' && e.label === 'Repair',
  );
  if (!entry || entry.type !== 'group') throw new Error('Repair group not found');
  return entry;
}

describe('NAV_ITEMS — Repair group', () => {
  it('has a Repair group with children', () => {
    expect(repairGroup().children.length).toBeGreaterThan(0);
  });

  it('has the Overview leaf first, at /repair, gated on repair.jobs.view', () => {
    const children = repairGroup().children;
    expect(children[0].href).toBe('/repair');
    expect(children[0].label).toBe('Overview');
    expect(children[0].permission).toBe('repair.jobs.view');
  });

  it('keeps the Jobs leaf gated on repair.jobs.view', () => {
    const jobs = repairGroup().children.find((c) => c.href === '/jobs');
    expect(jobs).toBeDefined();
    expect(jobs!.permission).toBe('repair.jobs.view');
  });

  it('includes the Spare Parts leaf gated on repair.spare_parts.request', () => {
    const sp = repairGroup().children.find((c) => c.href === '/repair/spare-parts');
    expect(sp).toBeDefined();
    expect(sp!.label).toBe('Spare Parts');
    expect(sp!.permission).toBe('repair.spare_parts.request');
  });

  it('includes the Fault Templates leaf gated on repair.templates.manage', () => {
    const ft = repairGroup().children.find((c) => c.href === '/repair/fault-templates');
    expect(ft).toBeDefined();
    expect(ft!.label).toBe('Fault Templates');
    expect(ft!.permission).toBe('repair.templates.manage');
  });
});

function crmGroup() {
  const entry = NAV_ITEMS.find(
    (e: NavEntry) => e.type === 'group' && e.label === 'CRM',
  );
  if (!entry || entry.type !== 'group') throw new Error('CRM group not found');
  return entry;
}

describe('NAV_ITEMS — CRM group', () => {
  it('has the Overview leaf first, at /crm, gated on crm.customers.view', () => {
    const children = crmGroup().children;
    expect(children[0].href).toBe('/crm');
    expect(children[0].label).toBe('Overview');
    expect(children[0].permission).toBe('crm.customers.view');
  });

  it('surfaces Tasks gated on crm.tasks.manage', () => {
    const t = crmGroup().children.find((c) => c.href === '/tasks');
    expect(t).toBeDefined();
    expect(t!.permission).toBe('crm.tasks.manage');
  });

  it('surfaces Segments gated on crm.segments.manage', () => {
    const s = crmGroup().children.find((c) => c.href === '/crm/segments');
    expect(s).toBeDefined();
    expect(s!.label).toBe('Segments');
    expect(s!.permission).toBe('crm.segments.manage');
  });

  it('surfaces Activity gated on crm.communications.log', () => {
    const a = crmGroup().children.find((c) => c.href === '/crm/activity');
    expect(a).toBeDefined();
    expect(a!.label).toBe('Activity');
    expect(a!.permission).toBe('crm.communications.log');
  });

  it('keeps Customers and Leads', () => {
    const hrefs = crmGroup().children.map((c) => c.href);
    expect(hrefs).toContain('/customers');
    expect(hrefs).toContain('/leads');
  });
});
