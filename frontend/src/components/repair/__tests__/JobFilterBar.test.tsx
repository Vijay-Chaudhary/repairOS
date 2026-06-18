import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { JobFilterBar } from '../JobFilterBar';
import { EMPTY_JOB_FILTERS, type JobFilterState } from '@/lib/repair/jobFilters';

const CTX = { todayIso: '2026-06-18', currentUserId: 'u1', technicianName: (id: string) => (id === 'u1' ? 'Asha' : id) };
const TECHS = [{ id: 'u1', name: 'Asha' }, { id: 'u2', name: 'Ravi' }];

function setup(initial: Partial<JobFilterState> = {}) {
  const onChange = vi.fn();
  const filters = { ...EMPTY_JOB_FILTERS, ...initial };
  render(<JobFilterBar filters={filters} onChange={onChange} technicians={TECHS} ctx={CTX} />);
  return { onChange, filters };
}

describe('JobFilterBar', () => {
  it('shows the active-filter count on the Filters button', () => {
    setup({ status: 'open', paymentStatus: 'unpaid' });
    expect(screen.getByRole('button', { name: /filters/i })).toHaveTextContent('2');
  });

  it('removing a chip calls onChange with that field reset', async () => {
    const user = userEvent.setup();
    const { onChange } = setup({ priority: 'vip' });
    await user.click(screen.getByRole('button', { name: /remove VIP/i }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ priority: 'all' }));
  });

  it('Clear all resets filters but keeps search', async () => {
    const user = userEvent.setup();
    const { onChange } = setup({ search: 'samsung', status: 'open', priority: 'vip' });
    await user.click(screen.getByRole('button', { name: /clear all/i }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ status: 'all', priority: 'all', search: 'samsung' }));
  });

  it('changing the priority select in the panel calls onChange', async () => {
    const user = userEvent.setup();
    const { onChange } = setup();
    await user.click(screen.getByRole('button', { name: /filters/i }));
    fireEvent.change(screen.getByLabelText('Priority'), { target: { value: 'urgent' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ priority: 'urgent' }));
  });
});
