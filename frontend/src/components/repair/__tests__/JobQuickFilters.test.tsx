import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { JobQuickFilters } from '../JobQuickFilters';
import { EMPTY_JOB_FILTERS } from '@/lib/repair/jobFilters';

const CTX = { todayIso: '2026-06-18', currentUserId: 'u1', technicianName: (id: string) => id };

describe('JobQuickFilters', () => {
  it('renders the four presets', () => {
    render(<JobQuickFilters filters={EMPTY_JOB_FILTERS} onChange={() => {}} ctx={CTX} />);
    for (const label of ['Overdue', 'Unpaid', 'Due today', 'My jobs']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
  });

  it('clicking a preset toggles it on via onChange', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<JobQuickFilters filters={EMPTY_JOB_FILTERS} onChange={onChange} ctx={CTX} />);
    await user.click(screen.getByRole('button', { name: 'Unpaid' }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ paymentStatus: 'unpaid' }));
  });

  it('marks an active preset as pressed', () => {
    render(<JobQuickFilters filters={{ ...EMPTY_JOB_FILTERS, overdue: true }} onChange={() => {}} ctx={CTX} />);
    expect(screen.getByRole('button', { name: 'Overdue' })).toHaveAttribute('aria-pressed', 'true');
  });
});
