import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import HrOverviewPage from '../page';

vi.mock('@/lib/stores/activeShopStore', () => ({
  useActiveShopStore: () => ({ activeShopId: 's-1', isAllShops: false }),
}));

vi.mock('@/lib/stores/authStore', () => ({
  useAuthStore: (selector: (s: { hasPermission: () => boolean }) => unknown) =>
    selector({ hasPermission: () => true }),
}));

const listEmployees = vi.fn();
const listAttendance = vi.fn();
const listLeaves = vi.fn();
const listSalarySlips = vi.fn();
vi.mock('@/lib/api/hr', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/api/hr')>();
  return {
    ...actual,
    hrApi: {
      ...actual.hrApi,
      listEmployees: (...a: unknown[]) => listEmployees(...a),
      listAttendance: (...a: unknown[]) => listAttendance(...a),
      listLeaves: (...a: unknown[]) => listLeaves(...a),
      listSalarySlips: (...a: unknown[]) => listSalarySlips(...a),
    },
  };
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><HrOverviewPage /></QueryClientProvider>);
}

describe('HrOverviewPage', () => {
  beforeEach(() => {
    listEmployees.mockReset().mockResolvedValue({ items: [], meta: { count: 7, total_pages: 1, page: 1, page_size: 20 } });
    listAttendance.mockReset().mockResolvedValue({ items: [] });
    listLeaves.mockReset().mockResolvedValue({ items: [], meta: { count: 2, total_pages: 1, page: 1, page_size: 20 } });
    listSalarySlips.mockReset().mockResolvedValue({ items: [], meta: { count: 0, total_pages: 0, page: 1, page_size: 20 } });
  });

  it('renders KPI cards and headcount from the employees endpoint', async () => {
    renderPage();
    expect(await screen.findByText('7')).toBeInTheDocument();
    expect(screen.getByText('Headcount')).toBeInTheDocument();
    expect(screen.getByText('Pending leave')).toBeInTheDocument();
  });

  it('renders the manage quick links', async () => {
    renderPage();
    expect(await screen.findByRole('link', { name: /departments/i })).toHaveAttribute('href', '/hr/departments');
  });
});
