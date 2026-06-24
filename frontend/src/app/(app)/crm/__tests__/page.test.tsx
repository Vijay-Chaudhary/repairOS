import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CrmOverviewPage from '../page';

vi.mock('@/lib/stores/activeShopStore', () => ({
  useActiveShopStore: () => ({ activeShopId: 'shop-1', isAllShops: false }),
}));
vi.mock('@/lib/stores/authStore', () => ({
  useAuthStore: () => ({ hasPermission: () => true, hasAnyPermission: () => true }),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const getOverview = vi.fn();
vi.mock('@/lib/api/crm', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/api/crm')>();
  return { ...actual, crmApi: { ...actual.crmApi, getOverview: (...a: unknown[]) => getOverview(...a) } };
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><CrmOverviewPage /></QueryClientProvider>);
}

const SAMPLE = {
  kpis: { new_leads: 3, tasks_due_today: 5, tasks_overdue: 2, conversions_30d: 4, new_customers_30d: 6 },
  pipeline: [
    { status: 'new', count: 3 }, { status: 'contacted', count: 1 }, { status: 'interested', count: 0 },
    { status: 'quoted', count: 0 }, { status: 'converted', count: 4 }, { status: 'lost', count: 1 },
  ],
  overdue_tasks: [
    { id: 't1', title: 'Call Ravi', due_date: '2026-06-20', assigned_to_name: 'Asha', customer_name: 'Ravi Kumar' },
  ],
  unassigned_leads: [
    { id: 'l1', name: 'New Lead', phone: '+919812345678', source: 'walk_in', created_at: '2026-06-23' },
  ],
};

describe('CrmOverviewPage', () => {
  beforeEach(() => getOverview.mockReset());

  it('renders KPI values and needs-attention items', async () => {
    getOverview.mockResolvedValue(SAMPLE);
    renderPage();
    expect(await screen.findByText('Call Ravi')).toBeInTheDocument();
    expect(screen.getByText('New Lead')).toBeInTheDocument();
    expect(screen.getAllByText('3').length).toBeGreaterThan(0);
  });

  it('shows an empty needs-attention state when lists are empty', async () => {
    getOverview.mockResolvedValue({ ...SAMPLE, overdue_tasks: [], unassigned_leads: [] });
    renderPage();
    expect(await screen.findByText(/All clear/i)).toBeInTheDocument();
  });
});
