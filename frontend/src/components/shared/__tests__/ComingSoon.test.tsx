import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ComingSoon } from '../ComingSoon';

describe('ComingSoon', () => {
  it('renders the title and a coming-soon message', () => {
    render(<ComingSoon title="Estimates" />);
    expect(screen.getByText('Estimates')).toBeInTheDocument();
    expect(screen.getByText(/coming soon/i)).toBeInTheDocument();
  });

  it('links back to the dashboard', () => {
    render(<ComingSoon title="Refunds" />);
    const link = screen.getByRole('link', { name: /dashboard/i });
    expect(link).toHaveAttribute('href', '/dashboard');
  });
});
