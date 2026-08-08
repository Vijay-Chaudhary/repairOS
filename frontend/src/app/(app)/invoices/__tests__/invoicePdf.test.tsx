import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import InvoiceDetailPage from '../[id]/page';

const authState = {
  hasPermission: () => true,
  hasAnyPermission: () => true,
  user: { id: 'u-1' },
};
vi.mock('@/lib/stores/authStore', () => ({
  useAuthStore: (selector?: (s: typeof authState) => unknown) =>
    selector ? selector(authState) : authState,
}));

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'inv-1' }),
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
}));

const toastError = vi.fn();
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: (...a: unknown[]) => toastError(...a) },
}));

const getInvoice = vi.fn();
const downloadInvoicePdf = vi.fn();
vi.mock('@/lib/api/billing', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/api/billing')>();
  return {
    ...actual,
    billingApi: {
      getInvoice: (...a: unknown[]) => getInvoice(...a),
      downloadInvoicePdf: (...a: unknown[]) => downloadInvoicePdf(...a),
      sendWhatsapp: vi.fn(),
    },
  };
});

const INVOICE = {
  id: 'inv-1',
  invoice_number: 'HTA-INV-2026-08-0001',
  status: 'paid',
  shop_id: 'shop-1',
  customer_name: 'Rakesh Traders',
  subtotal: 500,
  discount_amount: 0,
  cgst: 45,
  sgst: 45,
  igst: 0,
  grand_total: 590,
  amount_paid: 590,
  amount_outstanding: 0,
  created_at: '2026-08-01T10:00:00Z',
  items: [],
  payments: [],
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <InvoiceDetailPage />
    </QueryClientProvider>,
  );
}

describe('Invoice PDF button', () => {
  beforeEach(() => {
    getInvoice.mockReset().mockResolvedValue(INVOICE);
    downloadInvoicePdf.mockReset().mockResolvedValue(new Blob(['%PDF-1.7'], { type: 'application/pdf' }));
    toastError.mockReset();
    vi.stubGlobal('open', vi.fn());
    // jsdom implements neither of these; assign the methods directly rather
    // than replacing the whole URL global, which would break `new URL()`.
    URL.createObjectURL = vi.fn(() => 'blob:mock-url');
    URL.revokeObjectURL = vi.fn();
  });

  it('opens an object URL built from the downloaded blob', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /pdf/i }));

    await waitFor(() => expect(downloadInvoicePdf).toHaveBeenCalledWith('inv-1'));
    await waitFor(() => expect(window.open).toHaveBeenCalledWith('blob:mock-url', '_blank', 'noreferrer'));
  });

  it('shows the server error and opens nothing when the download fails', async () => {
    const { ApiError } = await import('@/lib/api/client');
    downloadInvoicePdf.mockRejectedValue(
      new ApiError('PDF_RENDER_FAILED', 'Could not generate the PDF. Please try again.', 500),
    );

    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /pdf/i }));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('Could not generate the PDF. Please try again.'),
    );
    expect(window.open).not.toHaveBeenCalled();
  });
});
