import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Can } from '@/components/shared/Can';
import * as authStoreModule from '@/lib/stores/authStore';

vi.mock('@/lib/stores/authStore', () => ({
  useAuthStore: vi.fn(),
}));

function mockAuth({
  hasPermission = (_p: string) => false,
  hasAnyPermission = (_ps: string[]) => false,
}: {
  hasPermission?: (p: string) => boolean;
  hasAnyPermission?: (ps: string[]) => boolean;
} = {}) {
  vi.mocked(authStoreModule.useAuthStore).mockReturnValue({
    hasPermission,
    hasAnyPermission,
  } as ReturnType<typeof authStoreModule.useAuthStore>);
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Single permission ─────────────────────────────────────────────────────────

describe('Can — single permission', () => {
  it('renders children when user has the permission', () => {
    mockAuth({ hasPermission: p => p === 'crm.leads.create' });
    render(<Can permission="crm.leads.create"><span>New Lead</span></Can>);
    expect(screen.getByText('New Lead')).toBeInTheDocument();
  });

  it('hides children when user lacks the permission', () => {
    mockAuth({ hasPermission: () => false });
    render(<Can permission="crm.leads.create"><span>New Lead</span></Can>);
    expect(screen.queryByText('New Lead')).not.toBeInTheDocument();
  });

  it('renders fallback when user lacks permission and fallback is provided', () => {
    mockAuth({ hasPermission: () => false });
    render(
      <Can permission="crm.leads.create" fallback={<span>No access</span>}>
        <span>New Lead</span>
      </Can>,
    );
    expect(screen.queryByText('New Lead')).not.toBeInTheDocument();
    expect(screen.getByText('No access')).toBeInTheDocument();
  });

  it('renders nothing (not fallback) by default when lacking permission', () => {
    mockAuth({ hasPermission: () => false });
    const { container } = render(
      <Can permission="crm.leads.create"><span>Hidden</span></Can>,
    );
    expect(container.firstChild).toBeNull();
  });
});

// ── anyOf (multiple permissions) ─────────────────────────────────────────────

describe('Can — anyOf', () => {
  it('renders children when user has at least one listed permission', () => {
    mockAuth({ hasAnyPermission: ps => ps.includes('reports.revenue.view') });
    render(
      <Can anyOf={['reports.revenue.view', 'reports.repair.view']}>
        <span>Reports</span>
      </Can>,
    );
    expect(screen.getByText('Reports')).toBeInTheDocument();
  });

  it('hides children when user has none of the listed permissions', () => {
    mockAuth({ hasAnyPermission: () => false });
    render(
      <Can anyOf={['reports.revenue.view', 'reports.repair.view']}>
        <span>Reports</span>
      </Can>,
    );
    expect(screen.queryByText('Reports')).not.toBeInTheDocument();
  });
});

// ── No gate (open content) ────────────────────────────────────────────────────

describe('Can — no permission gate', () => {
  it('always renders children when no permission or anyOf is provided', () => {
    mockAuth({ hasPermission: () => false, hasAnyPermission: () => false });
    render(<Can><span>Open content</span></Can>);
    expect(screen.getByText('Open content')).toBeInTheDocument();
  });
});

// ── Specific CRM lead gating ──────────────────────────────────────────────────

describe('Can — CRM lead action gating', () => {
  it('hides "New Lead" button for a permissionless role (e.g. Technician)', () => {
    // Technician has crm.leads.view but NOT crm.leads.create
    mockAuth({ hasPermission: p => p === 'crm.leads.view' });
    render(
      <Can permission="crm.leads.create">
        <button>New Lead</button>
      </Can>,
    );
    expect(screen.queryByRole('button', { name: 'New Lead' })).not.toBeInTheDocument();
  });

  it('shows "New Lead" button for a Receptionist (has crm.leads.create)', () => {
    mockAuth({ hasPermission: p => ['crm.leads.view', 'crm.leads.create'].includes(p) });
    render(
      <Can permission="crm.leads.create">
        <button>New Lead</button>
      </Can>,
    );
    expect(screen.getByRole('button', { name: 'New Lead' })).toBeInTheDocument();
  });
});
