import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import RepairOverviewPage from '../page';

vi.mock('@/lib/stores/activeShopStore', () => ({
  useActiveShopStore: () => ({ activeShopId: 'shop-1', isAllShops: false }),
}));

const getOverview = vi.fn();
vi.mock('@/lib/api/repair', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/api/repair')>();
  return {
    ...actual,  // keep KANBAN_COLUMNS and other real exports the page imports
    repairApi: { ...actual.repairApi, getOverview: (...args: unknown[]) => getOverview(...args) },
  };
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <RepairOverviewPage />
    </QueryClientProvider>,
  );
}

const SAMPLE = {
  kpis: { open_jobs: 42, overdue: 7, awaiting_parts: 9, ready_for_pickup: 5 },
  by_status: [
    { status: 'open', count: 14 },
    { status: 'in_progress', count: 11 },
  ],
  needs_attention: [
    {
      id: 'j1', job_number: 'JOY-2026-0001', customer_name: 'Ravi Kumar',
      device_type: 'Smartphone', status: 'open',
      expected_delivery_date: null, service_charge: 500, advance_paid: 0,
    },
  ],
};

describe('RepairOverviewPage', () => {
  beforeEach(() => getOverview.mockReset());

  it('shows a loading skeleton while fetching', () => {
    // Resolves eventually, but the first synchronous render is still loading
    // (the query promise settles on a later microtask). Avoids leaking a
    // never-resolving promise into teardown.
    getOverview.mockResolvedValue(SAMPLE);
    renderPage();
    expect(screen.getByTestId('overview-loading')).toBeInTheDocument();
  });

  it('renders KPI numbers and needs-attention rows when data loads', async () => {
    getOverview.mockResolvedValue(SAMPLE);
    renderPage();
    expect(await screen.findByText('42')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByText('JOY-2026-0001')).toBeInTheDocument();
    expect(screen.getByText('Ravi Kumar')).toBeInTheDocument();
  });

  it('shows an empty state when there are no jobs', async () => {
    getOverview.mockResolvedValue({
      kpis: { open_jobs: 0, overdue: 0, awaiting_parts: 0, ready_for_pickup: 0 },
      by_status: [],
      needs_attention: [],
    });
    renderPage();
    expect(await screen.findByText(/no jobs yet/i)).toBeInTheDocument();
  });
});
