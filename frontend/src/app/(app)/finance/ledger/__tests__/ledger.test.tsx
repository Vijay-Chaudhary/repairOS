import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import LedgerPage from '../page';

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn();
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
});

vi.mock('@/lib/stores/authStore', () => ({
  useAuthStore: () => ({ hasPermission: () => true, hasAnyPermission: () => true, user: { id: 'u-1' } }),
}));

vi.mock('@/lib/stores/activeShopStore', () => ({
  useActiveShopStore: () => ({ activeShopId: 's-1', isAllShops: false }),
}));

const listAccounts = vi.fn();
const getTrialBalance = vi.fn();
const getLedger = vi.fn();
vi.mock('@/lib/api/accounts', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/api/accounts')>();
  return {
    ...actual,
    accountsApi: {
      ...actual.accountsApi,
      listAccounts: (...a: unknown[]) => listAccounts(...a),
      getTrialBalance: (...a: unknown[]) => getTrialBalance(...a),
      getLedger: (...a: unknown[]) => getLedger(...a),
    },
  };
});

const META = { count: 1, total_pages: 1, page: 1, page_size: 20 };

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><LedgerPage /></QueryClientProvider>);
}

describe('LedgerPage', () => {
  beforeEach(() => {
    listAccounts.mockReset().mockResolvedValue({
      items: [{ id: 'a-1', code: '1000', name: 'Cash', account_type: 'asset', parent_id: null, is_active: true, is_system: false, normal_balance: 'debit' }],
      meta: META,
    });
    getTrialBalance.mockReset().mockResolvedValue({
      rows: [{ account_id: 'a-1', code: '1000', name: 'Cash', account_type: 'asset', debit: '150.00', credit: '0.00' }],
      total_debit: '150.00',
      total_credit: '150.00',
    });
    getLedger.mockReset().mockResolvedValue({
      account: { id: 'a-1', code: '1000', name: 'Cash', account_type: 'asset', parent_id: null, is_active: true, is_system: false, normal_balance: 'debit' },
      opening_balance: '0.00', closing_balance: '150.00', rows: [],
    });
  });

  it('prompts to pick an account in ledger view', async () => {
    renderPage();
    expect(await screen.findByText(/pick an account/i)).toBeInTheDocument();
  });

  it('renders the trial balance with a totals row', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderPage();
    await user.click(screen.getByRole('button', { name: /trial balance/i }));

    expect(await screen.findByText('Total')).toBeInTheDocument();
    expect(screen.getByText('Cash')).toBeInTheDocument();
  });
});
