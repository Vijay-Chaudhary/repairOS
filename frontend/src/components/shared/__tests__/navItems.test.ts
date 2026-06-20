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
});
