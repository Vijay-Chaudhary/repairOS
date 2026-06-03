import { describe, it, expect } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "./test-utils";
import ReportsPage from "@/app/(dashboard)/reports/page";

describe("Reports page", () => {
  it("renders dashboard KPI widget labels", async () => {
    renderWithProviders(<ReportsPage />);
    await waitFor(() => {
      expect(screen.getByText("Revenue Today")).toBeInTheDocument();
      expect(screen.getByText("Outstanding")).toBeInTheDocument();
      expect(screen.getByText("Active Repairs")).toBeInTheDocument();
    });
  });

  it("renders report catalog with all categories", async () => {
    renderWithProviders(<ReportsPage />);
    await waitFor(() => {
      // Category names appear as both section header (p) and filter button
      expect(screen.getAllByText("Billing").length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText("ERP").length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText("Repair").length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText("HR").length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText("CRM").length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText("AMC").length).toBeGreaterThanOrEqual(1);
    });
  });

  it("shows multiple report cards", async () => {
    renderWithProviders(<ReportsPage />);
    await waitFor(() => {
      expect(screen.getByText("Revenue Summary")).toBeInTheDocument();
      expect(screen.getByText("Job Status Summary")).toBeInTheDocument();
      expect(screen.getByText("Salary Register")).toBeInTheDocument();
      expect(screen.getByText("Lead Conversion")).toBeInTheDocument();
      expect(screen.getByText("AMC Revenue")).toBeInTheDocument();
    });
  });

  it("filters reports by search text", async () => {
    renderWithProviders(<ReportsPage />);
    const user = userEvent.setup();
    await waitFor(() => screen.getByText("Revenue Summary"));
    await user.type(screen.getByPlaceholderText("Search reports…"), "salary");
    await waitFor(() => {
      expect(screen.getByText("Salary Register")).toBeInTheDocument();
      expect(screen.queryByText("Revenue Summary")).not.toBeInTheDocument();
    });
  });

  it("filters reports by category button", async () => {
    renderWithProviders(<ReportsPage />);
    const user = userEvent.setup();
    await waitFor(() => screen.getByText("Revenue Summary"));
    // Click the "Billing" category filter button (not the section header)
    const buttons = screen.getAllByRole("button");
    const billingBtn = buttons.find((b) => b.textContent === "Billing");
    if (billingBtn) await user.click(billingBtn);
    await waitFor(() => {
      expect(screen.getByText("Revenue Summary")).toBeInTheDocument();
      expect(screen.queryByText("Salary Register")).not.toBeInTheDocument();
    });
  });

  it("opens report detail view on click", async () => {
    renderWithProviders(<ReportsPage />);
    const user = userEvent.setup();
    await waitFor(() => screen.getByText("Revenue Summary"));
    await user.click(screen.getByText("Revenue Summary"));
    await waitFor(() => {
      expect(screen.getByText("← Reports")).toBeInTheDocument();
    });
  });

  it("shows date range filter for revenue-summary", async () => {
    renderWithProviders(<ReportsPage />);
    const user = userEvent.setup();
    await waitFor(() => screen.getByText("Revenue Summary"));
    await user.click(screen.getByText("Revenue Summary"));
    await waitFor(() => {
      expect(screen.getByText("From")).toBeInTheDocument();
      expect(screen.getByText("To")).toBeInTheDocument();
      expect(screen.getByText("Run")).toBeInTheDocument();
    });
  });

  it("shows month/year filter for salary-register", async () => {
    renderWithProviders(<ReportsPage />);
    const user = userEvent.setup();
    await waitFor(() => screen.getByText("Salary Register"));
    await user.click(screen.getByText("Salary Register"));
    await waitFor(() => {
      expect(screen.getByText("Month")).toBeInTheDocument();
      expect(screen.getByText("Year")).toBeInTheDocument();
    });
  });

  it("shows GSTR downloads section", async () => {
    renderWithProviders(<ReportsPage />);
    await waitFor(() => {
      expect(screen.getByText("GST Downloads")).toBeInTheDocument();
      expect(screen.getByText("GSTR-1 (Outward Supplies)")).toBeInTheDocument();
    });
  });

  it("navigates back from report detail to catalog", async () => {
    renderWithProviders(<ReportsPage />);
    const user = userEvent.setup();
    await waitFor(() => screen.getByText("Revenue Summary"));
    await user.click(screen.getByText("Revenue Summary"));
    await waitFor(() => screen.getByText("← Reports"));
    await user.click(screen.getByText("← Reports"));
    await waitFor(() => {
      expect(screen.getByText("Revenue Summary")).toBeInTheDocument();
      expect(screen.queryByText("← Reports")).not.toBeInTheDocument();
    });
  });
});
