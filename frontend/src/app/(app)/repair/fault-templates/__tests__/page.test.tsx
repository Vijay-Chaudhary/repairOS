import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import FaultTemplatesPage from '../page';

vi.mock('@/lib/stores/activeShopStore', () => ({
  useActiveShopStore: () => ({ activeShopId: 'shop-1', isAllShops: false }),
}));
vi.mock('@/lib/stores/authStore', () => ({
  useAuthStore: () => ({ hasPermission: () => true, hasAnyPermission: () => true }),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const listTemplates = vi.fn();
const deleteTemplate = vi.fn();
vi.mock('@/lib/api/repair', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/api/repair')>();
  return {
    ...actual,
    repairApi: {
      ...actual.repairApi,
      listTemplates: (...a: unknown[]) => listTemplates(...a),
      deleteTemplate: (...a: unknown[]) => deleteTemplate(...a),
    },
  };
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><FaultTemplatesPage /></QueryClientProvider>);
}

const TEMPLATE = {
  id: 't1', shop_id: 'shop-1', name: 'iPhone screen swap', device_type: 'Smartphone',
  device_brand: 'Apple', problem_description: 'Cracked screen after drop', default_sc: 1500,
  estimated_duration_hours: 2, is_active: true,
  parts: [{ id: 'p1', custom_part_name: 'LCD', quantity: 1 }],
};

describe('FaultTemplatesPage', () => {
  beforeEach(() => { listTemplates.mockReset(); deleteTemplate.mockReset(); });

  it('renders a template row with its parts count', async () => {
    listTemplates.mockResolvedValue({ items: [TEMPLATE] });
    renderPage();
    expect(await screen.findByText('iPhone screen swap')).toBeInTheDocument();
    expect(screen.getByText('1 part')).toBeInTheDocument();
  });

  it('searches by name (debounced) and passes the search param', async () => {
    const user = userEvent.setup();
    listTemplates.mockResolvedValue({ items: [TEMPLATE] });
    renderPage();
    await screen.findByText('iPhone screen swap');
    await user.type(screen.getByLabelText(/search templates/i), 'samsung');
    await waitFor(() => {
      expect(listTemplates).toHaveBeenLastCalledWith('shop-1', { search: 'samsung' });
    });
  });

  it('shows a filter-aware empty state when a search has no matches', async () => {
    const user = userEvent.setup();
    listTemplates.mockResolvedValue({ items: [] });
    renderPage();
    await user.type(screen.getByLabelText(/search templates/i), 'zzz');
    expect(await screen.findByText('No templates match')).toBeInTheDocument();
  });

  it('deletes a template after confirmation', async () => {
    const user = userEvent.setup();
    listTemplates.mockResolvedValue({ items: [TEMPLATE] });
    deleteTemplate.mockResolvedValue(undefined);
    renderPage();
    await screen.findByText('iPhone screen swap');
    await user.click(screen.getByRole('button', { name: /delete template/i }));
    // confirm dialog
    const confirm = await screen.findByRole('button', { name: /^delete$/i });
    await user.click(confirm);
    expect(deleteTemplate).toHaveBeenCalledWith('t1');
  });
});
