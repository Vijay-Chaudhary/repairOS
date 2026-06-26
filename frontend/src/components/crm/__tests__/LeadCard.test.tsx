import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LeadCard } from '../LeadCard';
import type { Lead } from '@/lib/api/crm';

vi.mock('@/lib/stores/authStore', () => ({
  useAuthStore: () => ({ hasPermission: () => true, hasAnyPermission: () => true }),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const changeLeadStatus = vi.fn();
vi.mock('@/lib/api/crm', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/api/crm')>();
  return { ...actual, crmApi: { ...actual.crmApi, changeLeadStatus: (...a: unknown[]) => changeLeadStatus(...a) } };
});

function makeLead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: 'lead-1', shop_id: 'shop-1', name: 'Priya Nair', phone: '+919110000001',
    source: 'walk_in', status: 'new', created_at: '2026-06-20', ...overrides,
  };
}

function renderCard(lead: Lead) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}><LeadCard lead={lead} /></QueryClientProvider>);
}

describe('LeadCard re-open', () => {
  beforeEach(() => changeLeadStatus.mockReset().mockResolvedValue({}));

  it('re-opens a lost lead to its exact status_before_lost (not a hardcoded stage)', async () => {
    const user = userEvent.setup();
    const lead = makeLead({ status: 'lost', status_before_lost: 'contacted', lost_reason: 'no response' });
    renderCard(lead);

    await user.click(screen.getByRole('button', { name: /re-open/i }));

    await waitFor(() =>
      expect(changeLeadStatus).toHaveBeenCalledWith('lead-1', 'contacted', undefined),
    );
  });

  it('does not offer Re-open for a lost lead with no status_before_lost (avoids a 422)', () => {
    const lead = makeLead({ status: 'lost', status_before_lost: null, lost_reason: 'cold' });
    renderCard(lead);
    expect(screen.queryByRole('button', { name: /re-open/i })).not.toBeInTheDocument();
  });
});
