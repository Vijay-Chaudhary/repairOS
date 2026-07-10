import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import NewJobPage from '../page';

// Radix components rely on pointer-capture + scrollIntoView, which jsdom lacks.
beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn();
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
}));

vi.mock('@/lib/stores/activeShopStore', () => ({
  useActiveShopStore: () => ({ activeShopId: 'shop-1' }),
}));

vi.mock('@/lib/stores/offlineQueueStore', () => ({
  useOfflineQueueStore: () => ({ isOnline: true }),
}));

const { apiGet, apiPost } = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
}));

vi.mock('@/lib/api/client', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/api/client')>();
  return {
    ...actual,
    apiGet: (...a: unknown[]) => apiGet(...a),
    apiPost: (...a: unknown[]) => apiPost(...a),
  };
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NewJobPage />
    </QueryClientProvider>
  );
}

describe('New Job — quick-create customer', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiPost.mockReset();
    // Customer search returns no matches so the "Create new" affordance shows.
    apiGet.mockResolvedValue({ items: [] });
    apiPost.mockResolvedValue({ id: 'cust-1', name: 'Rahul Sharma', phone: '+919876543210', email: null });
  });

  it('sends the active shop_id when creating a customer from the jobs flow', async () => {
    const user = userEvent.setup();
    renderPage();

    // Open the quick-create dialog via the customer search "no results" path.
    await user.type(screen.getByPlaceholderText(/search by name or phone/i), 'Rahul');
    const createNew = await screen.findByRole('button', { name: /create new customer/i });
    await user.click(createNew);

    await user.type(await screen.findByPlaceholderText('Rahul Sharma'), 'Rahul Sharma');
    await user.type(screen.getByPlaceholderText(/98765 43210/), '9876543210');
    await user.click(screen.getByRole('button', { name: /^create$/i }));

    await waitFor(() => expect(apiPost).toHaveBeenCalled());
    const [path, body] = apiPost.mock.calls[0];
    expect(path).toBe('/crm/customers/');
    expect(body).toMatchObject({ shop_id: 'shop-1', name: 'Rahul Sharma' });
  });
});
