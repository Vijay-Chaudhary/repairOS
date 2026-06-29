import { describe, it, expect } from 'vitest';
import { REPORT_CATALOGUE } from '../reports';

// The six report permission slugs the backend ReportView actually enforces
// (apps/reports/views.py: perm = f"reports.{group}.view", group ∈ these).
const ENFORCED = new Set([
  'reports.revenue.view',
  'reports.inventory.view',
  'reports.repair.view',
  'reports.hr.view',
  'reports.crm.view',
  'reports.amc.view',
]);

describe('REPORT_CATALOGUE permissions', () => {
  it('every report gates on a backend-enforced reports.<group>.view slug', () => {
    const bad = REPORT_CATALOGUE.filter((r) => !ENFORCED.has(r.permission));
    expect(bad.map((r) => `${r.type}:${r.permission}`)).toEqual([]);
  });
});
