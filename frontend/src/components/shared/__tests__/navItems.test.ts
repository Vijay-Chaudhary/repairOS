import { describe, it, expect } from 'vitest';
import { NAV_ITEMS } from '../AppShell';

describe('NAV_ITEMS — Repair group', () => {
  const repair = NAV_ITEMS.find(
    (e): e is Extract<typeof e, { type: 'group' }> => e.type === 'group' && e.label === 'Repair',
  );

  it('exists and is a group', () => {
    expect(repair).toBeDefined();
  });

  it('has Overview and Jobs children with correct hrefs', () => {
    const hrefs = repair!.children.map((c) => c.href);
    expect(hrefs).toContain('/repair');
    expect(hrefs).toContain('/jobs');
    // Overview must come first (it is the group landing page)
    expect(repair!.children[0].href).toBe('/repair');
  });

  it('gates Overview and Jobs on repair.jobs.view', () => {
    for (const child of repair!.children) {
      expect(child.permission).toBe('repair.jobs.view');
    }
  });
});
