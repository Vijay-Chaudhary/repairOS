import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { format } from 'date-fns';
import TasksPage from '../page';

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn();
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
});

vi.mock('@/lib/stores/authStore', () => ({
  useAuthStore: () => ({ hasPermission: () => true, hasAnyPermission: () => true, user: { id: 'u-1' } }),
}));

const listTasks = vi.fn();
const completeTask = vi.fn();
const createTask = vi.fn();
vi.mock('@/lib/api/crm', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/api/crm')>();
  return {
    ...actual,
    crmApi: {
      ...actual.crmApi,
      listTasks: (...a: unknown[]) => listTasks(...a),
      completeTask: (...a: unknown[]) => completeTask(...a),
      createTask: (...a: unknown[]) => createTask(...a),
    },
  };
});

// TaskBoard uses dnd-kit, which doesn't play well in jsdom — stub it for the smoke test.
vi.mock('@/components/crm/TaskBoard', () => ({
  TaskBoard: () => <div data-testid="task-board" />,
}));

// StaffPicker (inside TaskComposer) pulls users/employees from the settings API.
vi.mock('@/lib/api/settings', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/api/settings')>();
  const empty = { items: [], meta: { count: 0, total_pages: 0, page: 1, page_size: 20 } };
  return {
    ...actual,
    settingsApi: {
      ...actual.settingsApi,
      listUsers: vi.fn().mockResolvedValue(empty),
    },
  };
});

const META = { count: 1, total_pages: 1, page: 1, page_size: 20 };
const ROWS = {
  items: [{
    id: 't-1', title: 'Call Ravi', description: null, due_date: '2026-07-15', due_time: null,
    status: 'pending', priority: 'normal', assigned_to: 'u-1', assigned_to_name: 'Asha',
    customer_id: null, customer_name: null, lead_id: null, job_id: null,
    completed_at: null, completed_by: null,
  }],
  meta: META,
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><TasksPage /></QueryClientProvider>);
}

describe('TasksPage — My / Team / Calendar / Kanban', () => {
  beforeEach(() => {
    listTasks.mockReset().mockResolvedValue(ROWS);
    completeTask.mockReset().mockResolvedValue({});
    createTask.mockReset().mockResolvedValue({});
  });

  it('defaults to the My view and renders task rows', async () => {
    renderPage();
    expect(await screen.findByText('Call Ravi')).toBeInTheDocument();
  });

  it('switches to the kanban view and renders the board', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderPage();
    await screen.findByText('Call Ravi');

    await user.click(screen.getByRole('button', { name: /kanban view/i }));

    expect(await screen.findByTestId('task-board')).toBeInTheDocument();
  });

  it('switches to the calendar view and queries the visible month range', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderPage();
    await screen.findByText('Call Ravi');

    await user.click(screen.getByRole('button', { name: /calendar view/i }));

    // Calendar header shows the current month.
    const monthLabel = format(new Date(), 'MMMM yyyy');
    expect(await screen.findByText(monthLabel)).toBeInTheDocument();

    await waitFor(() =>
      expect(listTasks).toHaveBeenCalledWith(
        expect.objectContaining({ due_from: expect.any(String), due_to: expect.any(String), page_size: 200 }),
      ),
    );
  });

  it('opens the composer prefilled when a day is clicked', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderPage();
    await screen.findByText('Call Ravi');
    await user.click(screen.getByRole('button', { name: /calendar view/i }));

    const now = new Date();
    const day15 = new Date(now.getFullYear(), now.getMonth(), 15);
    await user.click(await screen.findByRole('button', { name: format(day15, 'MMMM d, yyyy') }));

    const dueInput = await screen.findByLabelText('Due date *');
    expect(dueInput).toHaveValue(format(day15, 'yyyy-MM-dd'));
  });
});
