import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CampaignsPage from '../page';

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn();
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
});

vi.mock('@/lib/stores/authStore', () => ({
  useAuthStore: () => ({ hasPermission: () => true, hasAnyPermission: () => true }),
}));

const listCampaigns = vi.fn();
const createCampaign = vi.fn();
const listSegments = vi.fn();
const getSegmentRecipientCount = vi.fn();
vi.mock('@/lib/api/crm', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/api/crm')>();
  return {
    ...actual,
    crmApi: {
      ...actual.crmApi,
      listCampaigns: (...a: unknown[]) => listCampaigns(...a),
      createCampaign: (...a: unknown[]) => createCampaign(...a),
      listSegments: (...a: unknown[]) => listSegments(...a),
      getSegmentRecipientCount: (...a: unknown[]) => getSegmentRecipientCount(...a),
    },
  };
});

const META = { count: 0, total_pages: 0, page: 1, page_size: 20 };

const ROWS = {
  items: [{
    id: 'c-1', name: 'June promo', segment: 'seg-1', segment_name: 'Big spenders',
    template: 'promo_june_2026', status: 'sent', recipient_count: 12, excluded_optout_count: 3,
    sent_at: '2026-06-20T10:00:00Z', created_by: 'u-1', created_by_name: 'Asha', created_at: '2026-06-20T10:00:00Z',
  }],
  meta: { ...META, count: 1, total_pages: 1 },
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><CampaignsPage /></QueryClientProvider>);
}

describe('CampaignsPage', () => {
  beforeEach(() => {
    listCampaigns.mockReset().mockResolvedValue(ROWS);
    createCampaign.mockReset().mockResolvedValue({ ...ROWS.items[0], id: 'c-2', recipient_count: 5 });
    listSegments.mockReset().mockResolvedValue({ items: [{ id: 'seg-1', name: 'Big spenders', filter_rules: {}, is_dynamic: true }] });
    getSegmentRecipientCount.mockReset().mockResolvedValue({ total: 8, recipients: 5, excluded_optout: 3 });
  });

  it('renders campaign history rows', async () => {
    renderPage();
    expect(await screen.findByText('June promo')).toBeInTheDocument();
    expect(screen.getByText('Big spenders')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
  });

  it('shows an empty state when there are no campaigns', async () => {
    listCampaigns.mockResolvedValue({ items: [], meta: META });
    renderPage();
    expect(await screen.findByText(/no campaigns yet/i)).toBeInTheDocument();
  });

  it('previews recipient count and creates a campaign', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderPage();
    await screen.findByText('June promo');

    await user.click(screen.getByRole('button', { name: /new campaign/i }));

    // Fill the form.
    await user.type(await screen.findByPlaceholderText('e.g. June promo'), 'July blast');
    await user.click(screen.getByRole('combobox', { name: /segment/i }));
    await user.click(await screen.findByRole('option', { name: 'Big spenders' }));

    // Recipient-count preview appears ("5" lives in a nested span).
    expect(await screen.findByText(/recipients will receive this/i)).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText('e.g. promo_june_2026'), 'tmpl_x');
    await user.click(screen.getByRole('button', { name: /^send$/i }));

    await waitFor(() =>
      expect(createCampaign).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'July blast', segment_id: 'seg-1', template: 'tmpl_x' }),
      ),
    );
  });
});
