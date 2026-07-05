import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AuditPage from '../page';

const authState = {
  hasPermission: () => true,
  hasAnyPermission: () => true,
  user: { id: 'u-1' },
};
vi.mock('@/lib/stores/authStore', () => ({
  useAuthStore: (selector?: (s: typeof authState) => unknown) =>
    selector ? selector(authState) : authState,
}));

const list = vi.fn();
const facets = vi.fn();
vi.mock('@/lib/api/audit', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/api/audit')>();
  return {
    ...actual,
    auditApi: {
      list: (...a: unknown[]) => list(...a),
      facets: (...a: unknown[]) => facets(...a),
    },
  };
});

const ROW = {
  id: 'log-1',
  user_id: 'u-9',
  user_name: 'Priya Shah',
  action: 'update' as const,
  model_name: 'Invoice',
  object_id: 'obj-1',
  old_value: { status: 'draft' },
  new_value: { status: 'issued' },
  ip_address: '10.0.0.1',
  user_agent: 'pytest',
  created_at: '2026-07-05T10:30:00Z',
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><AuditPage /></QueryClientProvider>);
}

describe('AuditPage', () => {
  beforeEach(() => {
    list.mockReset().mockResolvedValue({
      items: [ROW],
      meta: { count: 1, total_pages: 1, page: 1, page_size: 20 },
    });
    facets.mockReset().mockResolvedValue({
      actions: ['create', 'update', 'delete', 'login', 'logout', 'permission_denied'],
      model_names: ['Customer', 'Invoice'],
      users: [{ id: 'u-9', full_name: 'Priya Shah' }],
    });
  });

  it('renders audit rows with user, action, and model', async () => {
    renderPage();
    expect(await screen.findByText('Priya Shah')).toBeInTheDocument();
    expect(screen.getByText('Invoice')).toBeInTheDocument();
    expect(screen.getByText('Update')).toBeInTheDocument();
  });

  it('opens a detail dialog with old/new values on row click', async () => {
    renderPage();
    fireEvent.click(await screen.findByText('Invoice'));
    expect(await screen.findByText('Audit entry')).toBeInTheDocument();
    expect(screen.getByText(/"draft"/)).toBeInTheDocument();
    expect(screen.getByText(/"issued"/)).toBeInTheDocument();
  });

  it('requests page 1 with no filters by default', async () => {
    renderPage();
    await screen.findByText('Priya Shah');
    expect(list).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 1, action: undefined, user_id: undefined, model_name: undefined }),
    );
  });
});
