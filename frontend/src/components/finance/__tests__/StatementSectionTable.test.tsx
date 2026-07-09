import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatementSectionTable } from '../StatementSectionTable';

const section = {
  rows: [
    { account_id: 'a-1', code: '5100', name: 'Salaries', amount: '100.00', level: 0, total: '750.00' },
    { account_id: 'a-2', code: '5110', name: 'Salaries — Tech', amount: '400.00', level: 1, total: null },
    { account_id: 'a-3', code: '5120', name: 'Salaries — Office', amount: '250.00', level: 1, total: null },
  ],
  subtotal: '750.00',
};

describe('StatementSectionTable', () => {
  it('indents child rows by level', () => {
    render(<StatementSectionTable title="Expenses" section={section} />);
    const child = screen.getByText('Salaries — Tech');
    expect(child).toHaveStyle({ paddingLeft: '2rem' }); // 0.75 + 1 * 1.25
    expect(screen.getByText('Salaries')).toHaveStyle({ paddingLeft: '0.75rem' });
  });

  it('shows a group rollup total on parent rows only', () => {
    render(<StatementSectionTable title="Expenses" section={section} />);
    expect(screen.getAllByText(/Σ/)).toHaveLength(1); // one parent → one rollup
  });
});
