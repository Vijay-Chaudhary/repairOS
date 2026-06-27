import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ActivityFeedPage from '../page';

// Radix Select uses pointer-capture + scrollIntoView, which jsdom lacks.
beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn();
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
});

vi.mock('@/lib/stores/authStore', () => ({
  useAuthStore: () => ({ hasPermission: () => true, hasAnyPermission: () => true }),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const listCommunications = vi.fn();
vi.mock('@/lib/api/crm', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/api/crm')>();
  return {
    ...actual,
    crmApi: { ...actual.crmApi, listCommunications: (...a: unknown[]) => listCommunications(...a) },
  };
});

const META = { count: 0, total_pages: 0, page: 1, page_size: 20, next_cursor: null, prev_cursor: null };

const ROWS = {
  items: [
    {
      id: 'c-1', customer_id: 'cust-1', customer_name: 'Ravi Kumar', lead_id: null, lead_name: null,
      type: 'call', summary: 'Called about repair status', logged_by: 'u-1', logged_by_name: 'Asha',
      logged_at: '2026-06-20T10:00:00Z',
    },
    {
      id: 'c-2', customer_id: null, customer_name: null, lead_id: 'lead-1', lead_name: 'New Prospect',
      type: 'whatsapp', summary: 'Sent quote', logged_by: 'u-1', logged_by_name: 'Asha',
      logged_at: '2026-06-19T10:00:00Z',
    },
  ],
  meta: { ...META, count: 2 },
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><ActivityFeedPage /></QueryClientProvider>);
}

describe('ActivityFeedPage', () => {
  beforeEach(() => {
    listCommunications.mockReset().mockResolvedValue(ROWS);
  });

  it('renders communication rows deep-linked to customer/lead', async () => {
    renderPage();

    expect(await screen.findByText('Ravi Kumar')).toBeInTheDocument();
    expect(screen.getByText('Called about repair status')).toBeInTheDocument();

    const custLink = screen.getByText('Ravi Kumar').closest('a');
    expect(custLink).toHaveAttribute('href', '/customers/cust-1');

    const leadLink = screen.getByText('New Prospect').closest('a');
    expect(leadLink).toHaveAttribute('href', '/leads/lead-1');
  });

  it('passes the selected type into the query', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderPage();

    await screen.findByText('Ravi Kumar');
    const trigger = screen.getByRole('combobox', { name: /type/i });
    await user.click(trigger);
    await user.click(await screen.findByRole('option', { name: 'WhatsApp' }));

    await waitFor(() =>
      expect(listCommunications).toHaveBeenCalledWith(expect.objectContaining({ type: 'whatsapp' })),
    );
  });

  it('shows an empty state when there is no activity', async () => {
    listCommunications.mockResolvedValue({ items: [], meta: META });
    renderPage();
    expect(await screen.findByText(/no activity yet/i)).toBeInTheDocument();
  });

  it('shows an error state when the query fails', async () => {
    listCommunications.mockRejectedValue(new Error('boom'));
    renderPage();
    expect(await screen.findByText(/couldn't load activity/i)).toBeInTheDocument();
  });
});
