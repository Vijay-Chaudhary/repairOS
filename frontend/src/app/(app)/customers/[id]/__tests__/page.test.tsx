import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CustomerProfilePage from '../page';

// Radix Tabs/Select rely on pointer-capture + scrollIntoView, which jsdom lacks.
beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn();
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
});

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'cust-1' }),
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
}));
vi.mock('@/lib/stores/authStore', () => ({
  useAuthStore: () => ({ hasPermission: () => true, hasAnyPermission: () => true }),
}));

// Hoisted so the (hoisted) vi.mock factories can reference these spies safely.
const { listSales, listContracts } = vi.hoisted(() => ({
  listSales: vi.fn(),
  listContracts: vi.fn(),
}));

vi.mock('@/lib/api/crm', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/api/crm')>();
  const empty = { items: [], meta: {} };
  return {
    ...actual,
    crmApi: {
      ...actual.crmApi,
      getCustomer: vi.fn().mockResolvedValue({
        id: 'cust-1', shop_id: 'shop-1', name: 'Anita Desai', phone: '+919110000900',
        total_jobs: 0, total_billed: 0, total_outstanding: 0, credit_limit: 0, tags: [],
      }),
      getCustomerTimeline: vi.fn().mockResolvedValue(empty),
      listTasks: vi.fn().mockResolvedValue(empty),
    },
  };
});

vi.mock('@/lib/api/repair', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/api/repair')>();
  return { ...actual, repairApi: { ...actual.repairApi, listJobs: vi.fn().mockResolvedValue({ items: [], meta: {} }) } };
});

vi.mock('@/lib/api/pos', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/api/pos')>();
  return { ...actual, posApi: { ...actual.posApi, listSales: (...a: unknown[]) => listSales(...a) } };
});

vi.mock('@/lib/api/amc', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/api/amc')>();
  return { ...actual, amcApi: { ...actual.amcApi, listContracts: (...a: unknown[]) => listContracts(...a) } };
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><CustomerProfilePage /></QueryClientProvider>);
}

describe('CustomerProfilePage — Sales + AMC tabs', () => {
  beforeEach(() => {
    listSales.mockReset().mockResolvedValue({ items: [], meta: {} });
    listContracts.mockReset().mockResolvedValue({ items: [], meta: {} });
  });

  it('renders the spec tab order', async () => {
    renderPage();
    const tabs = await screen.findAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(
      ['Repair History', 'Sales', 'AMC', 'Timeline', 'Tasks', 'Financial'],
    );
  });

  it('lazily loads Sales by customer_id only when the Sales tab is opened', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderPage();
    await screen.findByRole('tab', { name: 'Sales' });
    expect(listSales).not.toHaveBeenCalled();
    await user.click(screen.getByRole('tab', { name: 'Sales' }));
    await waitFor(() =>
      expect(listSales).toHaveBeenCalledWith(expect.objectContaining({ customer_id: 'cust-1' })),
    );
  });

  it('lazily loads AMC contracts when the AMC tab is opened', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderPage();
    await user.click(await screen.findByRole('tab', { name: 'AMC' }));
    await waitFor(() =>
      expect(listContracts).toHaveBeenCalledWith(expect.objectContaining({ customer_id: 'cust-1' })),
    );
  });
});
