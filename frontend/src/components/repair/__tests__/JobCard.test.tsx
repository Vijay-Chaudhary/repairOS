import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { JobCard } from '../JobCard';
import type { JobListItem } from '@/lib/api/repair';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

function job(overrides: Partial<JobListItem> = {}): JobListItem {
  return {
    id: 'j1', job_number: 'JOY-2026-0001', customer_id: 'c1', customer_name: 'Ravi Kumar',
    device_type: 'Smartphone', status: 'open', priority: 'normal',
    service_charge: 500 as unknown as number, advance_paid: 0 as unknown as number,
    intake_date: '2026-06-10', shop_id: 's1',
    ...overrides,
  };
}

describe('JobCard payment signal', () => {
  it('shows the outstanding balance when unpaid (string money fields)', () => {
    render(<JobCard job={job({ service_charge: '500.00' as unknown as number, advance_paid: '100.00' as unknown as number })} />);
    expect(screen.getByText('Due')).toBeInTheDocument();
    expect(screen.getByText('₹400.00')).toBeInTheDocument();
  });

  it('shows Paid when fully paid', () => {
    render(<JobCard job={job({ service_charge: '500.00' as unknown as number, advance_paid: '500.00' as unknown as number })} />);
    expect(screen.getByText('Paid')).toBeInTheDocument();
  });

  it('shows neither Paid nor Due when there is no charge', () => {
    render(<JobCard job={job({ service_charge: '0.00' as unknown as number, advance_paid: '0.00' as unknown as number })} />);
    expect(screen.queryByText('Paid')).not.toBeInTheDocument();
    expect(screen.queryByText('Due')).not.toBeInTheDocument();
  });
});
