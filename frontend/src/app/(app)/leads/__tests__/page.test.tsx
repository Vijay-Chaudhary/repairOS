import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import LeadsPage from '../page';

// Radix Select uses pointer-capture + scrollIntoView, which jsdom lacks.
beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn();
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
});

vi.mock('@/lib/stores/activeShopStore', () => ({
  useActiveShopStore: () => ({ activeShopId: 'shop-1', isAllShops: false }),
}));
vi.mock('@/lib/stores/authStore', () => ({
  useAuthStore: () => ({ hasPermission: () => true, hasAnyPermission: () => true }),
}));
vi.mock('@/lib/stores/offlineQueueStore', () => ({
  useOfflineQueueStore: () => ({ isOnline: true }),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const listLeads = vi.fn();
vi.mock('@/lib/api/crm', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/api/crm')>();
  return { ...actual, crmApi: { ...actual.crmApi, listLeads: (...a: unknown[]) => listLeads(...a) } };
});

const listUsers = vi.fn();
vi.mock('@/lib/api/settings', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/api/settings')>();
  return { ...actual, settingsApi: { ...actual.settingsApi, listUsers: (...a: unknown[]) => listUsers(...a) } };
});

const EMPTY = { items: [], meta: { count: 0, total_pages: 0, page: 1, page_size: 20 } };

const USERS = {
  items: [
    { id: 'u-1', full_name: 'Asha Verma', email: 'asha@x.io', phone: '+910000000001', is_active: true, role_names: [], created_at: '2026-01-01' },
    { id: 'u-2', full_name: 'Ravi Kumar', email: 'ravi@x.io', phone: '+910000000002', is_active: true, role_names: [], created_at: '2026-01-01' },
  ],
  meta: { count: 2, total_pages: 1, page: 1, page_size: 20 },
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><LeadsPage /></QueryClientProvider>);
}

describe('LeadsPage filters', () => {
  beforeEach(() => {
    listLeads.mockReset().mockResolvedValue(EMPTY);
    listUsers.mockReset().mockResolvedValue(USERS);
  });

  it('passes assigned_to into the leads query when a user is selected', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderPage();

    // Open the assignee filter and pick a user.
    const trigger = await screen.findByRole('combobox', { name: /assignee/i });
    await user.click(trigger);
    await user.click(await screen.findByRole('option', { name: 'Asha Verma' }));

    await waitFor(() =>
      expect(listLeads).toHaveBeenCalledWith(expect.objectContaining({ assigned_to: 'u-1' })),
    );
  });

  it('shows a removable chip for the active assignee filter', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderPage();

    const trigger = await screen.findByRole('combobox', { name: /assignee/i });
    await user.click(trigger);
    await user.click(await screen.findByRole('option', { name: 'Asha Verma' }));

    const chip = await screen.findByRole('button', { name: /assignee: asha verma/i });
    await user.click(chip);

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /assignee: asha verma/i })).not.toBeInTheDocument(),
    );
  });
});
