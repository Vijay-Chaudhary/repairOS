import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SparePartsPage from '../page';

vi.mock('@/lib/stores/activeShopStore', () => ({
  useActiveShopStore: () => ({ activeShopId: 'shop-1', isAllShops: false }),
}));
vi.mock('@/lib/stores/authStore', () => ({
  useAuthStore: () => ({ hasPermission: () => true, hasAnyPermission: () => true }),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const listSpareParts = vi.fn();
vi.mock('@/lib/api/repair', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/api/repair')>();
  return { ...actual, repairApi: { ...actual.repairApi, listSpareParts: (...a: unknown[]) => listSpareParts(...a) } };
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><SparePartsPage /></QueryClientProvider>);
}

const SAMPLE = {
  items: [{
    id: 'r1', job_id: 'j1', job_number: 'JOY-2026-0001', customer_name: 'Ravi Kumar',
    device_type: 'Smartphone', custom_part_name: 'LCD Screen', quantity: 2, is_urgent: true,
    status: 'requested', requested_by: 'u1', requested_by_name: 'Asha', created_at: '2026-06-10',
  }],
  meta: { count: 1, total_pages: 1, page: 1, page_size: 20 },
};

describe('SparePartsPage', () => {
  beforeEach(() => listSpareParts.mockReset());

  it('shows a loading skeleton then the request row', async () => {
    listSpareParts.mockResolvedValue(SAMPLE);
    renderPage();
    expect(await screen.findByText('LCD Screen')).toBeInTheDocument();
    expect(screen.getByText('JOY-2026-0001')).toBeInTheDocument();
    expect(screen.getByText('Ravi Kumar')).toBeInTheDocument();
  });

  it('renders an empty state when there are no requests', async () => {
    listSpareParts.mockResolvedValue({ items: [], meta: { count: 0, total_pages: 0, page: 1, page_size: 20 } });
    renderPage();
    expect(await screen.findByText(/no spare-part requests/i)).toBeInTheDocument();
  });
});
