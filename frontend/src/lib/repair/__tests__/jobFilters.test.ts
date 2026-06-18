import { describe, it, expect } from 'vitest';
import {
  EMPTY_JOB_FILTERS,
  toBaseApiFilters,
  activeChips,
  activeFilterCount,
  clearChip,
  clearAll,
  applyPreset,
  isPresetActive,
  type JobFilterState,
} from '../jobFilters';

const TODAY = '2026-06-18';
const CTX = { todayIso: TODAY, currentUserId: 'u1', technicianName: (id: string) => (id === 'u1' ? 'Asha' : id) };

function state(overrides: Partial<JobFilterState> = {}): JobFilterState {
  return { ...EMPTY_JOB_FILTERS, ...overrides };
}

describe('toBaseApiFilters', () => {
  it('omits defaults and status (status is applied per view by the caller)', () => {
    expect(toBaseApiFilters(state(), CTX)).toEqual({});
  });

  it('maps active fields to API params, excluding status', () => {
    const f = toBaseApiFilters(
      state({ status: 'open', technicianId: 'u1', priority: 'urgent', deviceType: ' Laptop ', paymentStatus: 'unpaid', dateFrom: '2026-06-01', dateTo: '2026-06-10' }),
      CTX,
    );
    expect(f).toEqual({
      technician_id: 'u1',
      priority: 'urgent',
      device_type: 'Laptop',
      payment_status: 'unpaid',
      date_from: '2026-06-01',
      date_to: '2026-06-10',
    });
    expect('status' in f).toBe(false);
  });

  it('maps overdue and dueToday presets to backend params', () => {
    expect(toBaseApiFilters(state({ overdue: true }), CTX)).toEqual({ overdue: true });
    expect(toBaseApiFilters(state({ dueToday: true }), CTX)).toEqual({ due_on: TODAY });
  });
});

describe('chips & count', () => {
  it('produces a removable chip per active filter (search excluded)', () => {
    const s = state({ search: 'samsung', status: 'on_hold', paymentStatus: 'unpaid', overdue: true });
    const chips = activeChips(s, CTX);
    const keys = chips.map((c) => c.key);
    expect(keys).toContain('status');
    expect(keys).toContain('paymentStatus');
    expect(keys).toContain('overdue');
    expect(keys).not.toContain('search');
    expect(activeFilterCount(s)).toBe(chips.length);
  });

  it('renders a human label for the technician chip via ctx', () => {
    const chips = activeChips(state({ technicianId: 'u1' }), CTX);
    expect(chips.find((c) => c.key === 'technicianId')?.label).toBe('Tech: Asha');
  });

  it('clearChip resets one field to default, clearAll resets all but keeps search', () => {
    const s = state({ search: 'x', status: 'open', priority: 'vip' });
    expect(clearChip(s, 'status').status).toBe('all');
    expect(clearChip(s, 'status').priority).toBe('vip');
    const cleared = clearAll(s);
    expect(cleared.status).toBe('all');
    expect(cleared.priority).toBe('all');
    expect(cleared.search).toBe('x');
  });
});

describe('presets', () => {
  it('toggles a preset on and off', () => {
    const on = applyPreset(state(), 'unpaid', CTX);
    expect(on.paymentStatus).toBe('unpaid');
    expect(isPresetActive(on, 'unpaid', CTX)).toBe(true);
    const off = applyPreset(on, 'unpaid', CTX);
    expect(off.paymentStatus).toBe('all');
    expect(isPresetActive(off, 'unpaid', CTX)).toBe(false);
  });

  it('my_jobs maps to the current user, overdue/due_today set their flags', () => {
    expect(applyPreset(state(), 'my_jobs', CTX).technicianId).toBe('u1');
    expect(applyPreset(state(), 'overdue', CTX).overdue).toBe(true);
    expect(applyPreset(state(), 'due_today', CTX).dueToday).toBe(true);
    expect(isPresetActive(state({ technicianId: 'u1' }), 'my_jobs', CTX)).toBe(true);
  });
});
