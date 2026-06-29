import { describe, it, expect } from 'vitest';
import { buildFilterRules, parseFilterRules } from '../segment-filters';

describe('segment filter rules', () => {
  it('emits city + customer_type when set', () => {
    const rules = buildFilterRules({
      name: 'x', description: '', is_dynamic: true,
      tags: ['vip'], min_total_billed: 5000, min_total_jobs: 0,
      customer_type: 'business', city: 'Delhi',
    });
    expect(rules).toEqual({ tags: ['vip'], min_total_billed: 5000, customer_type: 'business', city: 'Delhi' });
  });

  it('omits city + customer_type when empty / "all"', () => {
    const rules = buildFilterRules({
      name: 'x', description: '', is_dynamic: true,
      tags: [], min_total_billed: 0, min_total_jobs: 0,
      customer_type: 'all', city: '   ',
    });
    expect(rules).toEqual({});
  });

  it('round-trips city + customer_type through parseFilterRules', () => {
    const parsed = parseFilterRules({ city: 'Mumbai', customer_type: 'individual' });
    expect(parsed.city).toBe('Mumbai');
    expect(parsed.customer_type).toBe('individual');
  });
});
