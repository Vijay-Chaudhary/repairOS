import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CommandPalette } from '../CommandPalette';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

function renderPalette(open: boolean) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CommandPalette open={open} onOpenChange={() => {}} />
    </QueryClientProvider>,
  );
}

describe('CommandPalette', () => {
  it('renders the search input and short-query hint when open', () => {
    renderPalette(true);
    expect(screen.getByPlaceholderText(/search/i)).toBeInTheDocument();
    expect(screen.getByText(/at least 2 characters/i)).toBeInTheDocument();
  });

  it('renders nothing when closed', () => {
    renderPalette(false);
    expect(screen.queryByPlaceholderText(/search/i)).not.toBeInTheDocument();
  });
});
