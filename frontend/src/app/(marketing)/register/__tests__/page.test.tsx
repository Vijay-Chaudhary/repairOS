import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RegisterPage from '../page';

const apiFetchMock = vi.fn();
vi.mock('@/lib/api/client', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/api/client')>();
  return { ...actual, apiFetch: (...a: unknown[]) => apiFetchMock(...a) };
});

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

vi.mock('@/lib/stores/authStore', () => ({
  useAuthStore: () => ({ setAccessToken: vi.fn(), setUser: vi.fn() }),
}));
vi.mock('@/lib/stores/activeShopStore', () => ({
  useActiveShopStore: Object.assign(
    () => ({ setShops: vi.fn() }),
    { getState: () => ({ activeShopId: null }) },
  ),
}));

function renderPage() {
  return render(<RegisterPage />);
}

describe('RegisterPage — shop name field', () => {
  beforeEach(() => {
    apiFetchMock.mockReset().mockResolvedValue({ slug: 'sunrise', phone_masked: '+91****1111', expires_in: 600 });
  });

  it('defaults the shop name field to the business name until manually edited', async () => {
    const user = userEvent.setup();
    renderPage();

    const businessNameInput = screen.getByPlaceholderText('Sunrise Repairs');
    await user.type(businessNameInput, 'Sunrise Repairs');

    const shopNameInput = screen.getByLabelText(/shop name/i) as HTMLInputElement;
    expect(shopNameInput.value).toBe('Sunrise Repairs');
  });

  it('stops auto-syncing once the shop name is manually edited', async () => {
    const user = userEvent.setup();
    renderPage();

    const businessNameInput = screen.getByPlaceholderText('Sunrise Repairs');
    await user.type(businessNameInput, 'Sunrise Repairs');

    const shopNameInput = screen.getByLabelText(/shop name/i) as HTMLInputElement;
    await user.clear(shopNameInput);
    await user.type(shopNameInput, 'Sunrise Repairs - Main');

    await user.type(businessNameInput, ' Co');

    expect(shopNameInput.value).toBe('Sunrise Repairs - Main');
  });

  it('includes shop_name in the /register/ POST body', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByPlaceholderText('Sunrise Repairs'), 'Sunrise Repairs');
    await user.type(screen.getByPlaceholderText('Ravi Kumar'), 'Ravi Kumar');
    await user.type(screen.getByPlaceholderText('+91XXXXXXXXXX'), '9876543210');
    await user.type(screen.getByPlaceholderText('you@company.com'), 'ravi@sunrise.com');
    await user.type(screen.getByLabelText(/^password/i), 'Passw0rd!');

    await user.click(screen.getByRole('button', { name: /continue/i }));

    expect(apiFetchMock).toHaveBeenCalledWith(
      '/register/',
      expect.objectContaining({
        body: expect.stringContaining('"shop_name":"Sunrise Repairs"'),
      }),
    );
  });
});
