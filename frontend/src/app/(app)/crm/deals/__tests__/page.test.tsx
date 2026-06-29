import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import DealsPage from '../page';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/lib/stores/activeShopStore', () => ({
  useActiveShopStore: () => ({ activeShopId: 's1', isAllShops: false }),
}));
vi.mock('@/components/crm/DealBoard', () => ({
  DealBoard: () => <div data-testid="deal-board" />,
}));
vi.mock('@/lib/api/crm', async (orig) => {
  const actual = await orig<typeof import('@/lib/api/crm')>();
  return {
    ...actual,
    crmApi: {
      ...actual.crmApi,
      listDeals: vi.fn().mockResolvedValue({ items: [], meta: { count: 0 } }),
      listCustomers: vi.fn().mockResolvedValue({ items: [], meta: { count: 0 } }),
    },
  };
});

describe('DealsPage', () => {
  it('renders the Deals heading and board', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <DealsPage />
      </QueryClientProvider>,
    );
    expect(screen.getByRole('heading', { name: 'Deals' })).toBeInTheDocument();
    expect(screen.getByTestId('deal-board')).toBeInTheDocument();
  });
});
