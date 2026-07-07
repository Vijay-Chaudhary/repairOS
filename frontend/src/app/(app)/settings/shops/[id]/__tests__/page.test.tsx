import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ShopDetailPage from '../page';

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn();
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
});

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'shop-1' }),
}));

let hasPermission = () => true;
vi.mock('@/lib/stores/authStore', () => ({
  useAuthStore: () => ({ hasPermission: (...a: unknown[]) => hasPermission(...(a as [])) }),
}));

const setShops = vi.fn();
let storeShops: { id: string; name: string; address?: string }[] = [];
vi.mock('@/lib/stores/activeShopStore', () => ({
  useActiveShopStore: { getState: () => ({ shops: storeShops, setShops }) },
}));

const getShop = vi.fn();
const updateShop = vi.fn();
vi.mock('@/lib/api/settings', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/api/settings')>();
  return {
    ...actual,
    settingsApi: {
      ...actual.settingsApi,
      getShop: (...a: unknown[]) => getShop(...a),
      updateShop: (...a: unknown[]) => updateShop(...a),
    },
  };
});

const SHOP = {
  id: 'shop-1',
  name: 'Sunrise Main',
  code: 'SM',
  address: '1 Main Rd',
  city: 'Bengaluru',
  state: 'Karnataka',
  state_code: '29',
  phone: '+919900000000',
  email: 'shop@sunrise.example',
  gstin: '29AAAAA0000A1Z5',
  is_active: true,
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><ShopDetailPage /></QueryClientProvider>);
}

describe('ShopDetailPage', () => {
  beforeEach(() => {
    hasPermission = () => true;
    getShop.mockReset();
    updateShop.mockReset();
    setShops.mockReset();
    storeShops = [{ id: 'shop-1', name: 'Sunrise Main', address: '1 Main Rd' }];
  });

  it('renders ForbiddenPage when the user lacks settings.shop.edit', async () => {
    hasPermission = () => false;
    getShop.mockResolvedValue(SHOP);
    renderPage();
    expect(await screen.findByText(/access denied/i)).toBeInTheDocument();
    expect(getShop).not.toHaveBeenCalled();
  });

  it('shows a not-found message when the shop fetch errors (deleted/cross-tenant/inaccessible)', async () => {
    getShop.mockRejectedValue(new Error('404'));
    renderPage();
    expect(await screen.findByText(/shop not found/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /back to shops/i })).toHaveAttribute('href', '/settings/shops');
  });

  it('loads shop details, saves an update, and syncs cache + active-shop store', async () => {
    getShop.mockResolvedValue(SHOP);
    updateShop.mockResolvedValue({ ...SHOP, name: 'Sunrise Renamed' });

    const user = userEvent.setup();
    renderPage();

    await screen.findByDisplayValue('Sunrise Main');
    expect(getShop).toHaveBeenCalledWith('shop-1');

    await user.click(screen.getByRole('button', { name: /save shop details/i }));

    await waitFor(() => expect(updateShop).toHaveBeenCalled());
    expect(updateShop).toHaveBeenCalledWith('shop-1', expect.objectContaining({
      name: 'Sunrise Main',
      address: '1 Main Rd',
      city: 'Bengaluru',
      state: 'Karnataka',
      state_code: '29',
      phone: '+919900000000',
      email: 'shop@sunrise.example',
      gstin: '29AAAAA0000A1Z5',
    }));

    await waitFor(() => expect(setShops).toHaveBeenCalledWith([
      { id: 'shop-1', name: 'Sunrise Renamed', address: '1 Main Rd' },
    ]));
  });
});
