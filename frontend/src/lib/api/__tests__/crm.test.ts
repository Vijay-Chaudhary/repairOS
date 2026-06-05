import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LEAD_TRANSITIONS, LEAD_PIPELINE_COLS, crmApi } from '@/lib/api/crm';
import * as clientModule from '@/lib/api/client';

// Replace the entire client module so no real network calls are made
// and authStore's localStorage dependency is never evaluated.
vi.mock('@/lib/api/client', () => ({
  apiPost: vi.fn().mockResolvedValue({}),
  apiGet: vi.fn().mockResolvedValue({ items: [], meta: {} }),
  apiPatch: vi.fn().mockResolvedValue({}),
}));

// ── LEAD_TRANSITIONS ──────────────────────────────────────────────────────────

describe('LEAD_TRANSITIONS — pipeline state machine (frontend constant)', () => {
  it('new only allows → contacted', () => {
    const targets = LEAD_TRANSITIONS.new.map(t => t.to);
    expect(targets).toEqual(['contacted']);
  });

  it('contacted only allows → interested', () => {
    const targets = LEAD_TRANSITIONS.contacted.map(t => t.to);
    expect(targets).toEqual(['interested']);
  });

  it('interested only allows → quoted', () => {
    const targets = LEAD_TRANSITIONS.interested.map(t => t.to);
    expect(targets).toEqual(['quoted']);
  });

  it('quoted allows → converted', () => {
    const targets = LEAD_TRANSITIONS.quoted.map(t => t.to);
    expect(targets).toContain('converted');
  });

  /**
   * BUG (frontend): Backend VALID_LEAD_TRANSITIONS[quoted] = {converted, lost}.
   * LEAD_TRANSITIONS.quoted only has [{to:'converted'}] — omits 'lost'.
   * Effect: the UI never offers "Mark as lost" for a quoted lead, so users
   * cannot close lost deals without a backend API call outside the UI.
   * Fix: add {to: 'lost', label: 'Mark lost', requiresReason: true} to quoted.
   */
  it.fails('quoted allows → lost [BUG: currently missing from LEAD_TRANSITIONS]', () => {
    const targets = LEAD_TRANSITIONS.quoted.map(t => t.to);
    expect(targets).toContain('lost');
  });

  it('converted has no further transitions', () => {
    expect(LEAD_TRANSITIONS.converted).toHaveLength(0);
  });

  /**
   * BUG (frontend/backend mismatch): LEAD_TRANSITIONS.lost = [{to:'new', label:'Re-open'}]
   * but backend VALID_LEAD_TRANSITIONS[lost] = {} (empty set).
   * Effect: clicking "Re-open" triggers POST /leads/{id}/status/ → 400 INVALID_STATUS_TRANSITION.
   * Fix: remove the lost → new entry from LEAD_TRANSITIONS, or add the transition to the backend.
   */
  it.fails('lost has no valid transitions [BUG: frontend shows Re-open which backend rejects]', () => {
    expect(LEAD_TRANSITIONS.lost).toHaveLength(0);
  });
});

// ── LEAD_PIPELINE_COLS ────────────────────────────────────────────────────────

describe('LEAD_PIPELINE_COLS — kanban column definitions', () => {
  it('contains new, contacted, interested, quoted, converted', () => {
    const statuses = LEAD_PIPELINE_COLS.map(c => c.status);
    expect(statuses).toContain('new');
    expect(statuses).toContain('contacted');
    expect(statuses).toContain('interested');
    expect(statuses).toContain('quoted');
    expect(statuses).toContain('converted');
  });

  it('excludes lost (handled via filter, not a kanban column)', () => {
    const statuses = LEAD_PIPELINE_COLS.map(c => c.status);
    expect(statuses).not.toContain('lost');
  });

  it('has exactly 5 stages', () => {
    expect(LEAD_PIPELINE_COLS).toHaveLength(5);
  });
});

// ── crmApi.convertLead ────────────────────────────────────────────────────────

describe('crmApi.convertLead', () => {
  beforeEach(() => vi.clearAllMocks());

  it('POSTs to /crm/leads/{id}/convert/', async () => {
    const mockPost = vi.mocked(clientModule.apiPost);
    await crmApi.convertLead('lead-uuid-abc');
    expect(mockPost).toHaveBeenCalledWith('/crm/leads/lead-uuid-abc/convert/', {});
  });

  it('uses the exact lead ID passed as argument', async () => {
    const mockPost = vi.mocked(clientModule.apiPost);
    const id = '00000000-0000-0000-0000-000000000099';
    await crmApi.convertLead(id);
    expect(mockPost).toHaveBeenCalledWith(`/crm/leads/${id}/convert/`, {});
  });
});

// ── crmApi.createLead ─────────────────────────────────────────────────────────

describe('crmApi.createLead', () => {
  beforeEach(() => vi.clearAllMocks());

  it('POSTs to /crm/leads/', async () => {
    const mockPost = vi.mocked(clientModule.apiPost);
    const payload = {
      shop_id: 'shop-1',
      name: 'Rahul',
      phone: '+919876543210',
      source: 'walk_in' as const,
    };
    await crmApi.createLead(payload);
    expect(mockPost).toHaveBeenCalledWith('/crm/leads/', payload);
  });
});
