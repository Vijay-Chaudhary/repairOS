import { describe, it, expect } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "./test-utils";
import RepairsPage from "@/app/(dashboard)/repairs/page";
import { http, HttpResponse } from "msw";
import { server } from "./mocks/server";

const API = "http://localhost/api/v1";

describe("Repairs list", () => {
  it("renders job number", async () => {
    renderWithProviders(<RepairsPage />);
    await waitFor(() => {
      expect(screen.getByText("JOB-001")).toBeInTheDocument();
    });
  });

  it("renders status badge for active job", async () => {
    renderWithProviders(<RepairsPage />);
    await waitFor(() => {
      // "In Repair" status badge appears in job card (may also appear in dropdown option)
      expect(screen.getAllByText("In Repair").length).toBeGreaterThanOrEqual(1);
    });
  });

  it("shows customer name and device info", async () => {
    renderWithProviders(<RepairsPage />);
    await waitFor(() => {
      expect(screen.getByText("Ravi Kumar")).toBeInTheDocument();
      expect(screen.getByText(/Apple.*iPhone 13/)).toBeInTheDocument();
    });
  });

  it("shows technician name when assigned", async () => {
    renderWithProviders(<RepairsPage />);
    await waitFor(() => {
      expect(screen.getByText("Suresh")).toBeInTheDocument();
    });
  });

  it("shows New Job button for users with create permission", async () => {
    renderWithProviders(<RepairsPage />);
    await waitFor(() => {
      expect(screen.getByText("New Job")).toBeInTheDocument();
    });
  });

  it("shows empty state when no jobs returned", async () => {
    server.use(
      http.get(`${API}/repair/jobs/`, () =>
        HttpResponse.json({
          success: true,
          data: [],
          meta: { next_cursor: null, prev_cursor: null },
        })
      )
    );
    renderWithProviders(<RepairsPage />);
    await waitFor(() => {
      expect(screen.getByText("No repair jobs found")).toBeInTheDocument();
    });
  });

  it("renders status filter dropdown", () => {
    renderWithProviders(<RepairsPage />);
    expect(screen.getByRole("combobox")).toBeInTheDocument();
    expect(screen.getByText("All statuses")).toBeInTheDocument();
  });
});
