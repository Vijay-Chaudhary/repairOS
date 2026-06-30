import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import DepartmentsPage from '../page';

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn();
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
});

vi.mock('@/lib/stores/authStore', () => ({
  useAuthStore: () => ({ hasPermission: () => true, hasAnyPermission: () => true, user: { id: 'u-1' } }),
}));

vi.mock('@/lib/stores/activeShopStore', () => ({
  useActiveShopStore: () => ({ activeShopId: 's-1', isAllShops: false }),
}));

const listDepartments = vi.fn();
const listEmployees = vi.fn();
const createDepartment = vi.fn();
const deactivateDepartment = vi.fn();
vi.mock('@/lib/api/hr', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/api/hr')>();
  return {
    ...actual,
    hrApi: {
      ...actual.hrApi,
      listDepartments: (...a: unknown[]) => listDepartments(...a),
      listEmployees: (...a: unknown[]) => listEmployees(...a),
      createDepartment: (...a: unknown[]) => createDepartment(...a),
      deactivateDepartment: (...a: unknown[]) => deactivateDepartment(...a),
    },
  };
});

const ROWS = {
  items: [{
    id: 'd-1', shop_id: 's-1', name: 'Service', code: 'SVC',
    head_id: null, head_name: null, is_active: true, employee_count: 3,
    created_at: '2026-06-30T00:00:00Z',
  }],
  meta: { count: 1, total_pages: 1, page: 1, page_size: 20 },
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><DepartmentsPage /></QueryClientProvider>);
}

describe('DepartmentsPage', () => {
  beforeEach(() => {
    listDepartments.mockReset().mockResolvedValue(ROWS);
    listEmployees.mockReset().mockResolvedValue({ items: [], meta: ROWS.meta });
    createDepartment.mockReset().mockResolvedValue({});
    deactivateDepartment.mockReset().mockResolvedValue({});
  });

  it('renders a department row', async () => {
    renderPage();
    expect(await screen.findByText('Service')).toBeInTheDocument();
    expect(screen.getByText('SVC')).toBeInTheDocument();
  });

  it('opens the create dialog', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderPage();
    await screen.findByText('Service');

    await user.click(screen.getByRole('button', { name: /new department/i }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'New department' })).toBeInTheDocument();
  });
});
