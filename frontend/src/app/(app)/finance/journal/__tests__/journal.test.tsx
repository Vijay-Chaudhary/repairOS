import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import JournalPage from '../page';

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

const listJournal = vi.fn();
const listAccounts = vi.fn();
vi.mock('@/lib/api/accounts', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/api/accounts')>();
  return {
    ...actual,
    accountsApi: {
      ...actual.accountsApi,
      listJournal: (...a: unknown[]) => listJournal(...a),
      listAccounts: (...a: unknown[]) => listAccounts(...a),
    },
  };
});

const ENTRY = {
  id: 'j-1', entry_number: 'JV-00001', date: '2026-06-15', narration: 'Cash sale',
  reference: '', status: 'draft', posted_by: null, posted_at: null,
  lines: [
    { id: 'l-1', account_id: 'a-1', account_code: '1000', account_name: 'Cash', debit: '100.00', credit: '0.00', line_narration: '' },
    { id: 'l-2', account_id: 'a-2', account_code: '4000', account_name: 'Sales', debit: '0.00', credit: '100.00', line_narration: '' },
  ],
};

const META = { count: 1, total_pages: 1, page: 1, page_size: 20 };

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><JournalPage /></QueryClientProvider>);
}

describe('JournalPage', () => {
  beforeEach(() => {
    listJournal.mockReset().mockResolvedValue({ items: [ENTRY], meta: META });
    listAccounts.mockReset().mockResolvedValue({
      items: [
        { id: 'a-1', code: '1000', name: 'Cash', account_type: 'asset', parent_id: null, is_active: true, is_system: false, normal_balance: 'debit' },
        { id: 'a-2', code: '4000', name: 'Sales', account_type: 'income', parent_id: null, is_active: true, is_system: false, normal_balance: 'credit' },
      ],
      meta: META,
    });
  });

  it('renders a journal entry row', async () => {
    renderPage();
    expect(await screen.findByText('JV-00001')).toBeInTheDocument();
    expect(screen.getByText('Cash sale')).toBeInTheDocument();
  });

  it('disables Save draft until the entry is balanced', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderPage();
    await screen.findByText('JV-00001');

    await user.click(screen.getByRole('button', { name: /new entry/i }));
    await screen.findByRole('dialog');

    // Empty grid → unbalanced → Save draft disabled.
    const save = screen.getByRole('button', { name: /save draft/i });
    expect(save).toBeDisabled();
    expect(screen.getByText(/unbalanced/i)).toBeInTheDocument();
  });
});
