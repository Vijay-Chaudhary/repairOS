import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import QuotesWorklistPage from '../page';

// Radix Select uses pointer-capture + scrollIntoView, which jsdom lacks.
beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn();
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
});

vi.mock('@/lib/stores/authStore', () => ({
  useAuthStore: () => ({ hasPermission: () => true, hasAnyPermission: () => true }),
}));

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

const listQuotes = vi.fn();
vi.mock('@/lib/api/crm', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/api/crm')>();
  return { ...actual, crmApi: { ...actual.crmApi, listQuotes: (...a: unknown[]) => listQuotes(...a) } };
});

const META = { count: 0, total_pages: 0, page: 1, page_size: 20 };

const ROWS = {
  items: [
    {
      id: 'q-1', quote_number: 'ALPHA-QT-2026-0001', lead_id: 'lead-1', lead_name: 'Ravi Kumar',
      lead_status: 'quoted', items: [], total_amount: '4500.00', valid_until: '2026-12-31',
      notes: '', sent_via_whatsapp: true, sent_by: 'u-1', sent_by_name: 'Asha',
      created_at: '2026-06-20T10:00:00Z',
    },
  ],
  meta: { ...META, count: 1, total_pages: 1 },
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><QuotesWorklistPage /></QueryClientProvider>);
}

describe('QuotesWorklistPage', () => {
  beforeEach(() => {
    listQuotes.mockReset().mockResolvedValue(ROWS);
    push.mockReset();
  });

  it('renders a quote row with lead name and amount', async () => {
    renderPage();
    expect(await screen.findByText('Ravi Kumar')).toBeInTheDocument();
    expect(screen.getByText('₹4,500.00')).toBeInTheDocument();
  });

  it('navigates to the lead on row click', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderPage();
    await user.click(await screen.findByText('Ravi Kumar'));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/leads/lead-1'));
  });

  it('passes the selected lead_status into the query', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderPage();
    await screen.findByText('Ravi Kumar');

    const trigger = screen.getByRole('combobox', { name: /lead status/i });
    await user.click(trigger);
    await user.click(await screen.findByRole('option', { name: 'Converted' }));

    await waitFor(() =>
      expect(listQuotes).toHaveBeenCalledWith(expect.objectContaining({ lead_status: 'converted' })),
    );
  });

  it('shows an empty state when there are no quotes', async () => {
    listQuotes.mockResolvedValue({ items: [], meta: META });
    renderPage();
    expect(await screen.findByText(/no quotes yet/i)).toBeInTheDocument();
  });

  it('shows an error state when the query fails', async () => {
    listQuotes.mockRejectedValue(new Error('boom'));
    renderPage();
    expect(await screen.findByText(/boom/i)).toBeInTheDocument();
  });
});
