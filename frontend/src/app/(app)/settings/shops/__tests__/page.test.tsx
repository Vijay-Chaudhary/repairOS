import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ShopsPage from '../page';

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn();
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
});

vi.mock('@/lib/stores/authStore', () => ({
  useAuthStore: () => ({ hasPermission: () => true, hasAnyPermission: () => true }),
}));

const setShops = vi.fn();
vi.mock('@/lib/stores/activeShopStore', () => ({
  useActiveShopStore: () => ({ setShops }),
}));

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

const listShops = vi.fn();
const createShop = vi.fn();
const getTenantBranding = vi.fn();
vi.mock('@/lib/api/settings', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/api/settings')>();
  return {
    ...actual,
    settingsApi: {
      ...actual.settingsApi,
      listShops: (...a: unknown[]) => listShops(...a),
      createShop: (...a: unknown[]) => createShop(...a),
      getTenantBranding: (...a: unknown[]) => getTenantBranding(...a),
    },
  };
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><ShopsPage /></QueryClientProvider>);
}

describe('ShopsPage', () => {
  beforeEach(() => {
    listShops.mockReset().mockResolvedValue([
      { id: 's-1', name: 'Sunrise Main', code: 'SM', address: '1 Main Rd', city: 'Bengaluru' },
    ]);
    createShop.mockReset();
    getTenantBranding.mockReset().mockResolvedValue({});
    push.mockReset();
  });

  it('renders existing shops as cards', async () => {
    renderPage();
    expect(await screen.findByText('Sunrise Main')).toBeInTheDocument();
    expect(screen.getByText(/SM/)).toBeInTheDocument();
  });

  it('navigates to the shop detail route when a card is clicked', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByText('Sunrise Main'));
    expect(push).toHaveBeenCalledWith('/settings/shops/s-1');
  });

  it('creates a shop and refreshes the store on success', async () => {
    createShop.mockResolvedValue({ id: 's-2', name: 'Second Shop', code: 'SS', address: 'A', city: 'B', state: 'Karnataka', state_code: '29', phone: '+919900000000', is_active: true });
    listShops.mockResolvedValueOnce([
      { id: 's-1', name: 'Sunrise Main', code: 'SM', address: '1 Main Rd', city: 'Bengaluru' },
    ]).mockResolvedValueOnce([
      { id: 's-1', name: 'Sunrise Main', code: 'SM', address: '1 Main Rd', city: 'Bengaluru' },
      { id: 's-2', name: 'Second Shop', code: 'SS', address: 'A', city: 'B' },
    ]);

    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Sunrise Main');

    await user.click(screen.getByRole('button', { name: /add shop/i }));
    await user.type(screen.getByLabelText(/shop name/i), 'Second Shop');
    await user.type(screen.getByLabelText(/^address/i), 'A');
    await user.type(screen.getByLabelText(/^city/i), 'B');
    await user.type(screen.getByLabelText(/gst state code/i), '29');
    await user.clear(screen.getByLabelText(/^phone/i));
    await user.type(screen.getByLabelText(/^phone/i), '+919900000000');
    await user.click(screen.getByRole('button', { name: /create shop/i }));

    await waitFor(() => expect(createShop).toHaveBeenCalled());
    await waitFor(() => expect(setShops).toHaveBeenCalled());
  });

  it('shows the create error inline in the dialog, not as a toast', async () => {
    const { ApiError } = await import('@/lib/api/client');
    createShop.mockRejectedValue(new ApiError('PLAN_SHOP_LIMIT_EXCEEDED', 'Your plan allows 1 shop(s). Upgrade to add more.', 403));

    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Sunrise Main');

    await user.click(screen.getByRole('button', { name: /add shop/i }));
    await user.type(screen.getByLabelText(/shop name/i), 'Second Shop');
    await user.type(screen.getByLabelText(/^address/i), 'A');
    await user.type(screen.getByLabelText(/^city/i), 'B');
    await user.type(screen.getByLabelText(/gst state code/i), '29');
    await user.clear(screen.getByLabelText(/^phone/i));
    await user.type(screen.getByLabelText(/^phone/i), '+919900000000');
    await user.click(screen.getByRole('button', { name: /create shop/i }));

    expect(await screen.findByText(/upgrade to add more/i)).toBeInTheDocument();
  });
});
