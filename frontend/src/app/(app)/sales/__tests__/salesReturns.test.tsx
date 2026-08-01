import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SalesReturnsPage from '../returns/page';

const authState = {
  hasPermission: () => true,
  hasAnyPermission: () => true,
  user: { id: 'u-1' },
};
vi.mock('@/lib/stores/authStore', () => ({
  useAuthStore: (selector?: (s: typeof authState) => unknown) =>
    selector ? selector(authState) : authState,
}));

const listReturns = vi.fn();
const reviewReturn = vi.fn();
vi.mock('@/lib/api/pos', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/api/pos')>();
  return {
    ...actual,
    posApi: {
      listReturns: (...a: unknown[]) => listReturns(...a),
      reviewReturn: (...a: unknown[]) => reviewReturn(...a),
    },
  };
});

const PENDING = {
  id: 'ret-1',
  sale_id: 'sale-1',
  sale_number: 'JOY-S-0001',
  return_number: 'JOY-RET-0001',
  reason: 'Defective item',
  status: 'pending' as const,
  total_refund_amount: 500,
  refund_method: 'cash' as const,
  credit_note_number: null,
  created_at: '2026-07-20T10:30:00Z',
};

const APPROVED = {
  ...PENDING,
  id: 'ret-2',
  sale_id: 'sale-2',
  sale_number: 'JOY-S-0002',
  return_number: 'JOY-RET-0002',
  reason: 'Wrong model',
  status: 'approved' as const,
  credit_note_number: 'JOY-CN-0002',
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SalesReturnsPage />
    </QueryClientProvider>,
  );
}

describe('SalesReturnsPage', () => {
  beforeEach(() => {
    listReturns.mockReset().mockResolvedValue([PENDING, APPROVED]);
    reviewReturn.mockReset().mockResolvedValue({ ...PENDING, status: 'approved' });
  });

  it('lists returns with their sale number and credit note', async () => {
    renderPage();
    expect(await screen.findByText('JOY-RET-0001')).toBeInTheDocument();
    expect(screen.getByText('JOY-S-0001')).toBeInTheDocument();
    expect(screen.getByText('JOY-CN-0002')).toBeInTheDocument();
    expect(screen.getByText('Defective item')).toBeInTheDocument();
  });

  it('shows an empty state when there are no returns', async () => {
    listReturns.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText('No sales returns')).toBeInTheDocument();
  });

  it('offers review actions on pending returns only', async () => {
    renderPage();
    await screen.findByText('JOY-RET-0001');
    expect(screen.getByLabelText('Approve JOY-RET-0001')).toBeInTheDocument();
    expect(screen.queryByLabelText('Approve JOY-RET-0002')).not.toBeInTheDocument();
  });

  it('approves a pending return', async () => {
    renderPage();
    fireEvent.click(await screen.findByLabelText('Approve JOY-RET-0001'));
    await waitFor(() => expect(reviewReturn).toHaveBeenCalledWith('ret-1', 'approved'));
  });

  it('requests only the selected status from the API', async () => {
    renderPage();
    await screen.findByText('JOY-RET-0001');
    expect(listReturns).toHaveBeenLastCalledWith(undefined);

    fireEvent.click(screen.getByRole('button', { name: 'Pending' }));
    await waitFor(() =>
      expect(listReturns).toHaveBeenLastCalledWith({ status: 'pending' }),
    );
  });
});
