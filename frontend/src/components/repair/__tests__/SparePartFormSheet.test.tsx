import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SparePartFormSheet } from '../SparePartFormSheet';
import type { SparePartListItem } from '@/lib/api/repair';
import { useActiveShopStore } from '@/lib/stores/activeShopStore';

const createSparePart = vi.fn();
const updateSparePart = vi.fn();
const listJobs = vi.fn();
vi.mock('@/lib/api/repair', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/api/repair')>();
  return {
    ...actual,
    repairApi: {
      ...actual.repairApi,
      createSparePart: (...a: unknown[]) => createSparePart(...a),
      updateSparePart: (...a: unknown[]) => updateSparePart(...a),
      listJobs: (...a: unknown[]) => listJobs(...a),
    },
  };
});

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const EDIT_TARGET: SparePartListItem = {
  id: 'r1', shop_id: 'shop1', shop_name: 'Main Shop',
  job_id: 'j1', job_number: 'JOY-2026-0001', customer_name: 'Ravi Kumar',
  device_type: 'Smartphone', custom_part_name: 'LCD', quantity: 2, is_urgent: false,
  status: 'requested', requested_by: 'u1', created_at: '2026-06-10',
};

describe('SparePartFormSheet', () => {
  beforeEach(() => {
    createSparePart.mockReset(); updateSparePart.mockReset(); listJobs.mockReset();
    useActiveShopStore.setState({ shops: [], activeShopId: null, isAllShops: false });
  });

  it('edit mode pre-fills part fields and submits an update', async () => {
    const user = userEvent.setup();
    updateSparePart.mockResolvedValue({ ...EDIT_TARGET, quantity: 5 });
    wrap(<SparePartFormSheet open onOpenChange={() => {}} editTarget={EDIT_TARGET} />);
    const qty = screen.getByLabelText(/quantity/i);
    expect(qty).toHaveValue(2);
    await user.clear(qty);
    await user.type(qty, '5');
    await user.click(screen.getByRole('button', { name: /save/i }));
    expect(updateSparePart).toHaveBeenCalledWith('r1', expect.objectContaining({ quantity: 5 }));
  });

  it('create mode requires picking a job before submit', async () => {
    const user = userEvent.setup();
    wrap(<SparePartFormSheet open onOpenChange={() => {}} editTarget={null} />);
    await user.type(screen.getByLabelText(/part name/i), 'Battery');
    await user.click(screen.getByRole('button', { name: /create/i }));
    // No job selected → createSparePart not called, a validation message shows
    expect(createSparePart).not.toHaveBeenCalled();
    expect(await screen.findByText(/select a job/i)).toBeInTheDocument();
  });

  it('stock mode creates a job-less request with shop_id and no job_id', async () => {
    const user = userEvent.setup();
    useActiveShopStore.setState({
      shops: [{ id: 'shop1', name: 'Main Shop' }], activeShopId: 'shop1', isAllShops: false,
    });
    createSparePart.mockResolvedValue({ ...EDIT_TARGET, id: 'r2', job_id: null });
    wrap(<SparePartFormSheet open onOpenChange={() => {}} editTarget={null} />);
    await user.click(screen.getByRole('radio', { name: /stock \(no job\)/i }));
    await user.type(screen.getByLabelText(/part name/i), 'Bulk screens');
    await user.click(screen.getByRole('button', { name: /create/i }));
    expect(createSparePart).toHaveBeenCalledWith(
      expect.objectContaining({ shop_id: 'shop1', custom_part_name: 'Bulk screens' }),
    );
    expect(createSparePart.mock.calls[0][0]).not.toHaveProperty('job_id');
  });

  it('stock mode under "All shops" blocks submit until a shop is chosen', async () => {
    const user = userEvent.setup();
    useActiveShopStore.setState({
      shops: [{ id: 'shop1', name: 'Main Shop' }, { id: 'shop2', name: 'Branch' }],
      activeShopId: null, isAllShops: true,
    });
    wrap(<SparePartFormSheet open onOpenChange={() => {}} editTarget={null} />);
    await user.click(screen.getByRole('radio', { name: /stock \(no job\)/i }));
    await user.type(screen.getByLabelText(/part name/i), 'Bulk screens');
    await user.click(screen.getByRole('button', { name: /create/i }));
    expect(createSparePart).not.toHaveBeenCalled();
    expect(await screen.findByText(/choose a shop/i)).toBeInTheDocument();
    // Choosing a shop then submitting works
    await user.selectOptions(screen.getByLabelText(/^shop$/i), 'shop2');
    createSparePart.mockResolvedValue({ ...EDIT_TARGET, id: 'r3', job_id: null });
    await user.click(screen.getByRole('button', { name: /create/i }));
    expect(createSparePart).toHaveBeenCalledWith(
      expect.objectContaining({ shop_id: 'shop2' }),
    );
  });
});
