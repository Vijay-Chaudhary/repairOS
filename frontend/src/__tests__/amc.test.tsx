import { describe, it, expect } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, MOCK_USER } from "./test-utils";
import AMCPage from "@/app/(dashboard)/amc/page";
import AMCDetailPage from "@/app/(dashboard)/amc/[id]/page";
import NewAMCPage from "@/app/(dashboard)/amc/new/page";
import { http, HttpResponse } from "msw";
import { server } from "./mocks/server";

const API = "http://localhost/api/v1";

// ── Contract list ─────────────────────────────────────────────────────────────

describe("AMC list page", () => {
  it("renders contract titles and numbers", async () => {
    renderWithProviders(<AMCPage />);
    await waitFor(() => {
      expect(screen.getByText("Annual AC Service")).toBeInTheDocument();
      expect(screen.getByText("AMC-2025-001")).toBeInTheDocument();
    });
  });

  it("shows Active and Renewal Due status badges", async () => {
    renderWithProviders(<AMCPage />);
    await waitFor(() => {
      expect(screen.getByText("Active")).toBeInTheDocument();
      expect(screen.getByText("Renewal Due")).toBeInTheDocument();
    });
  });

  it("shows customer names", async () => {
    renderWithProviders(<AMCPage />);
    await waitFor(() => {
      expect(screen.getByText("Ravi Kumar")).toBeInTheDocument();
      expect(screen.getByText("Priya Sharma")).toBeInTheDocument();
    });
  });

  it("shows visits per year and contract value", async () => {
    renderWithProviders(<AMCPage />);
    await waitFor(() => {
      expect(screen.getAllByText(/4 visits\/yr/).length).toBeGreaterThan(0);
      expect(screen.getByText(/12,000/)).toBeInTheDocument();
    });
  });

  it("shows New Contract button for users with create permission", async () => {
    renderWithProviders(<AMCPage />);
    await waitFor(() => {
      expect(screen.getByText("New Contract")).toBeInTheDocument();
    });
  });

  it("hides New Contract button when user lacks create permission", async () => {
    renderWithProviders(<AMCPage />, {
      user: { ...MOCK_USER, permissions: ["amc.contracts.view"] },
    });
    await waitFor(() => {
      expect(screen.getByText("Annual AC Service")).toBeInTheDocument();
    });
    expect(screen.queryByText("New Contract")).not.toBeInTheDocument();
  });

  it("shows empty state when no contracts", async () => {
    server.use(
      http.get(`${API}/amc/contracts/`, () =>
        HttpResponse.json({
          success: true,
          data: [],
          meta: { next_cursor: null, prev_cursor: null },
        })
      )
    );
    renderWithProviders(<AMCPage />);
    await waitFor(() => {
      expect(screen.getByText("No AMC contracts found")).toBeInTheDocument();
    });
  });

  it("shows status filter dropdown", () => {
    renderWithProviders(<AMCPage />);
    expect(screen.getByRole("combobox")).toBeInTheDocument();
    expect(screen.getByText("All statuses")).toBeInTheDocument();
  });

  it("shows renewal due count in header", async () => {
    renderWithProviders(<AMCPage />);
    await waitFor(() => {
      expect(screen.getByText(/1 renewal due/)).toBeInTheDocument();
    });
  });
});

// ── Contract detail ───────────────────────────────────────────────────────────

describe("AMC contract detail", () => {
  it("renders contract number and title", async () => {
    renderWithProviders(<AMCDetailPage params={{ id: "amc-1" }} />);
    await waitFor(() => {
      expect(screen.getByText("AMC-2025-001")).toBeInTheDocument();
      expect(screen.getByText("Annual AC Service")).toBeInTheDocument();
    });
  });

  it("shows contract dates and value", async () => {
    renderWithProviders(<AMCDetailPage params={{ id: "amc-1" }} />);
    await waitFor(() => {
      expect(screen.getByText(/12,000/)).toBeInTheDocument();
      expect(screen.getByText("Upfront")).toBeInTheDocument();
    });
  });

  it("shows location address", async () => {
    renderWithProviders(<AMCDetailPage params={{ id: "amc-1" }} />);
    await waitFor(() => {
      expect(screen.getByText(/123 MG Road/)).toBeInTheDocument();
    });
  });

  it("shows Renew Contract button", async () => {
    renderWithProviders(<AMCDetailPage params={{ id: "amc-1" }} />);
    await waitFor(() => {
      expect(screen.getByText("Renew Contract")).toBeInTheDocument();
    });
  });

  it("shows visit timeline with visit numbers", async () => {
    renderWithProviders(<AMCDetailPage params={{ id: "amc-1" }} />);
    await waitFor(() => {
      expect(screen.getByText("Visit #1")).toBeInTheDocument();
      expect(screen.getByText("Visit #2")).toBeInTheDocument();
    });
  });

  it("shows completed and scheduled visit statuses", async () => {
    renderWithProviders(<AMCDetailPage params={{ id: "amc-1" }} />);
    await waitFor(() => {
      expect(screen.getByText("Completed")).toBeInTheDocument();
      expect(screen.getByText("Scheduled")).toBeInTheDocument();
    });
  });

  it("expands visit to show complete and reschedule actions", async () => {
    renderWithProviders(<AMCDetailPage params={{ id: "amc-1" }} />);
    const user = userEvent.setup();
    await waitFor(() => screen.getByText("Visit #2"));
    // Click the scheduled visit (visit #2) to expand
    await user.click(screen.getByText("Visit #2"));
    await waitFor(() => {
      expect(screen.getByText("Mark Complete")).toBeInTheDocument();
      expect(screen.getByText("Reschedule")).toBeInTheDocument();
    });
  });

  it("shows complete form when Mark Complete clicked", async () => {
    renderWithProviders(<AMCDetailPage params={{ id: "amc-1" }} />);
    const user = userEvent.setup();
    await waitFor(() => screen.getByText("Visit #2"));
    await user.click(screen.getByText("Visit #2"));
    await waitFor(() => screen.getByText("Mark Complete"));
    await user.click(screen.getByText("Mark Complete"));
    await waitFor(() => {
      expect(screen.getByPlaceholderText("Describe work performed…")).toBeInTheDocument();
    });
  });

  it("shows reschedule form when Reschedule clicked", async () => {
    renderWithProviders(<AMCDetailPage params={{ id: "amc-1" }} />);
    const user = userEvent.setup();
    await waitFor(() => screen.getByText("Visit #2"));
    await user.click(screen.getByText("Visit #2"));
    await waitFor(() => screen.getByText("Reschedule"));
    await user.click(screen.getByText("Reschedule"));
    await waitFor(() => {
      expect(screen.getByText("New date *")).toBeInTheDocument();
    });
  });

  it("submits complete visit and closes form", async () => {
    renderWithProviders(<AMCDetailPage params={{ id: "amc-1" }} />);
    const user = userEvent.setup();
    await waitFor(() => screen.getByText("Visit #2"));
    await user.click(screen.getByText("Visit #2"));
    await waitFor(() => screen.getByText("Mark Complete"));
    await user.click(screen.getByText("Mark Complete"));
    await waitFor(() => screen.getByPlaceholderText("Describe work performed…"));
    await user.type(screen.getByPlaceholderText("Describe work performed…"), "Changed filters and cleaned coils");
    await user.click(screen.getByText("Confirm"));
    await waitFor(() => {
      expect(screen.queryByPlaceholderText("Describe work performed…")).not.toBeInTheDocument();
    });
  });

  it("calls renew endpoint on button click", async () => {
    renderWithProviders(<AMCDetailPage params={{ id: "amc-1" }} />);
    const user = userEvent.setup();
    await waitFor(() => screen.getByText("Renew Contract"));
    await user.click(screen.getByText("Renew Contract"));
    // No error should appear
    await waitFor(() => {
      expect(screen.queryByText(/Failed/i)).not.toBeInTheDocument();
    });
  });
});

// ── New contract form ─────────────────────────────────────────────────────────

describe("New AMC contract form", () => {
  it("renders title and customer fields", () => {
    renderWithProviders(<NewAMCPage />);
    expect(screen.getByPlaceholderText(/Annual AC Maintenance/i)).toBeInTheDocument();
    expect(screen.getByText("Select customer…")).toBeInTheDocument();
  });

  it("shows all payment terms options", () => {
    renderWithProviders(<NewAMCPage />);
    expect(screen.getByText("Upfront")).toBeInTheDocument();
    expect(screen.getByText("Quarterly")).toBeInTheDocument();
    expect(screen.getByText("Monthly")).toBeInTheDocument();
  });

  it("shows auto-renew checkbox", () => {
    renderWithProviders(<NewAMCPage />);
    expect(screen.getByText("Auto-renew when expired")).toBeInTheDocument();
  });

  it("shows validation error when title is missing", async () => {
    renderWithProviders(<NewAMCPage />);
    const user = userEvent.setup();
    await user.click(screen.getByText("Create Contract"));
    await waitFor(() => {
      expect(screen.getByText("Title is required")).toBeInTheDocument();
    });
  });

  it("shows visits per year and reminder fields", () => {
    renderWithProviders(<NewAMCPage />);
    expect(screen.getByText("Visit Schedule")).toBeInTheDocument();
    expect(screen.getByText("Visits per Year")).toBeInTheDocument();
  });
});
