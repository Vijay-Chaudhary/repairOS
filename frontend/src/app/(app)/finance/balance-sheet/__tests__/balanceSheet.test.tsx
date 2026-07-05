import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import BalanceSheetPage from '../page';

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

const getBalanceSheet = vi.fn();
vi.mock('@/lib/api/accounts', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/api/accounts')>();
  return {
    ...actual,
    accountsApi: {
      ...actual.accountsApi,
      getBalanceSheet: (...a: unknown[]) => getBalanceSheet(...a),
    },
  };
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><BalanceSheetPage /></QueryClientProvider>);
}

describe('BalanceSheetPage', () => {
  beforeEach(() => {
    getBalanceSheet.mockReset().mockResolvedValue({
      assets: {
        rows: [{ account_id: 'a-1', code: '1000', name: 'Cash', amount: '5700.00' }],
        subtotal: '5700.00',
      },
      liabilities: {
        rows: [{ account_id: 'a-2', code: '2000', name: 'Sundry Creditors', amount: '200.00' }],
        subtotal: '200.00',
      },
      equity: {
        rows: [
          { account_id: 'a-3', code: '3000', name: 'Capital', amount: '5000.00' },
          { account_id: null, code: null, name: 'Current Period Earnings', amount: '500.00' },
        ],
        subtotal: '5500.00',
      },
      total_assets: '5700.00',
      total_liabilities: '200.00',
      total_equity: '5500.00',
      is_balanced: true,
      as_of: null,
    });
  });

  it('renders the three sections including current period earnings', async () => {
    renderPage();
    expect(await screen.findByText('Cash')).toBeInTheDocument();
    expect(screen.getByText('Sundry Creditors')).toBeInTheDocument();
    expect(screen.getByText('Capital')).toBeInTheDocument();
    expect(screen.getByText('Current Period Earnings')).toBeInTheDocument();
  });

  it('renders the in-balance badge and totals', async () => {
    renderPage();
    expect(await screen.findByText(/in balance/i)).toBeInTheDocument();
    expect(screen.getByText('Total Assets')).toBeInTheDocument();
    // Cash row + Assets subtotal + Total Assets all show the same figure.
    expect(screen.getAllByText('₹5,700.00')).toHaveLength(3);
  });
});
