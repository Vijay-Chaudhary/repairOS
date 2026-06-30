import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ChartOfAccountsPage from '../page';

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
vi.mock('@/lib/api/accounts', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/api/accounts')>();
  return {
    ...actual,
    accountsApi: { ...actual.accountsApi, listAccounts: (...a: unknown[]) => listAccounts(...a) },
  };
});

const ROWS = {
  items: [{
    id: 'a-1', code: '1000', name: 'Cash', account_type: 'asset',
    parent_id: null, is_active: true, is_system: false, normal_balance: 'debit',
  }],
  meta: { count: 1, total_pages: 1, page: 1, page_size: 20 },
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><ChartOfAccountsPage /></QueryClientProvider>);
}

describe('ChartOfAccountsPage', () => {
  beforeEach(() => {
    listAccounts.mockReset().mockResolvedValue(ROWS);
  });

  it('renders an account row grouped under its type', async () => {
    renderPage();
    expect(await screen.findByText('Cash')).toBeInTheDocument();
    expect(screen.getByText('1000')).toBeInTheDocument();
    expect(screen.getByText('Assets')).toBeInTheDocument();
  });

  it('opens the create dialog', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderPage();
    await screen.findByText('Cash');

    await user.click(screen.getByRole('button', { name: /new account/i }));

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'New account' })).toBeInTheDocument();
  });
});
