import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ProfitLossPage from '../page';

const authState = {
  hasPermission: () => true,
  hasAnyPermission: () => true,
  user: { id: 'u-1' },
};
vi.mock('@/lib/stores/authStore', () => ({
  useAuthStore: (selector?: (s: typeof authState) => unknown) =>
    selector ? selector(authState) : authState,
}));

vi.mock('@/lib/stores/activeShopStore', () => ({
  useActiveShopStore: () => ({ activeShopId: 's-1', isAllShops: false }),
}));

const getProfitLoss = vi.fn();
vi.mock('@/lib/api/accounts', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/api/accounts')>();
  return {
    ...actual,
    accountsApi: {
      ...actual.accountsApi,
      getProfitLoss: (...a: unknown[]) => getProfitLoss(...a),
    },
  };
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><ProfitLossPage /></QueryClientProvider>);
}

describe('ProfitLossPage', () => {
  beforeEach(() => {
    getProfitLoss.mockReset().mockResolvedValue({
      income: {
        rows: [{ account_id: 'a-4', code: '4000', name: 'Sales', amount: '1000.00' }],
        subtotal: '1000.00',
      },
      expense: {
        rows: [{ account_id: 'a-5', code: '5200', name: 'Rent', amount: '300.00' }],
        subtotal: '300.00',
      },
      net_profit: '700.00',
      date_from: null,
      date_to: null,
    });
  });

  it('renders income and expense sections with subtotals', async () => {
    renderPage();
    expect(await screen.findByText('Sales')).toBeInTheDocument();
    expect(screen.getByText('Rent')).toBeInTheDocument();
    expect(screen.getByText('Income')).toBeInTheDocument();
    expect(screen.getByText('Expenses')).toBeInTheDocument();
  });

  it('renders the net profit footer', async () => {
    renderPage();
    expect(await screen.findByText(/net profit/i)).toBeInTheDocument();
    expect(screen.getByText('₹700.00')).toBeInTheDocument();
  });
});
