import { describe, it, expect } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "./test-utils";
import CommissionsPage from "@/app/(dashboard)/commissions/page";

describe("Commissions — Rules tab", () => {
  it("renders all 3 tabs", () => {
    renderWithProviders(<CommissionsPage />);
    expect(screen.getByText("Rules")).toBeInTheDocument();
    expect(screen.getByText("Technician Ledger")).toBeInTheDocument();
    expect(screen.getByText("Payouts")).toBeInTheDocument();
  });

  it("shows commission rules list with names", async () => {
    renderWithProviders(<CommissionsPage />);
    await waitFor(() => {
      expect(screen.getByText("Standard Rate")).toBeInTheDocument();
      expect(screen.getByText("Smartphone Rate")).toBeInTheDocument();
    });
  });

  it("shows commission rates in percentage", async () => {
    renderWithProviders(<CommissionsPage />);
    await waitFor(() => {
      // rate "10.00" renders as "10.00% of SC"
      expect(screen.getByText(/10\.00%/)).toBeInTheDocument();
    });
  });

  it("shows job-type filter for Smartphone rule", async () => {
    renderWithProviders(<CommissionsPage />);
    await waitFor(() => {
      // "For: Smartphone" appears in rule card description
      expect(screen.getByText(/For: Smartphone/)).toBeInTheDocument();
    });
  });

  it("shows New Rule button", async () => {
    renderWithProviders(<CommissionsPage />);
    await waitFor(() => {
      expect(screen.getByText("New Rule")).toBeInTheDocument();
    });
  });

  it("opens create rule form on click", async () => {
    renderWithProviders(<CommissionsPage />);
    const user = userEvent.setup();
    await waitFor(() => screen.getByText("New Rule"));
    await user.click(screen.getByText("New Rule"));
    await waitFor(() => {
      expect(screen.getByText("New Commission Rule")).toBeInTheDocument();
    });
  });

  it("shows validation error for missing rule name", async () => {
    renderWithProviders(<CommissionsPage />);
    const user = userEvent.setup();
    await waitFor(() => screen.getByText("New Rule"));
    await user.click(screen.getByText("New Rule"));
    await waitFor(() => screen.getByText("New Commission Rule"));
    await user.click(screen.getByText("Save Rule"));
    await waitFor(() => {
      expect(screen.getByText("Name required")).toBeInTheDocument();
    });
  });

  it("shows lead tech share for each rule", async () => {
    renderWithProviders(<CommissionsPage />);
    await waitFor(() => {
      // lead_tech_share "60.00" → "Lead share: 60.00%"
      expect(screen.getByText(/Lead share: 60\.00%/)).toBeInTheDocument();
    });
  });
});

describe("Commissions — Ledger tab", () => {
  it("shows technician picker prompt on ledger tab", async () => {
    renderWithProviders(<CommissionsPage />);
    const user = userEvent.setup();
    await user.click(screen.getByText("Technician Ledger"));
    await waitFor(() => {
      expect(screen.getByText("Choose a technician…")).toBeInTheDocument();
    });
  });

  it("loads commission entries after selecting technician", async () => {
    renderWithProviders(<CommissionsPage />);
    const user = userEvent.setup();
    await user.click(screen.getByText("Technician Ledger"));
    await waitFor(() => screen.getByText("Choose a technician…"));
    await user.selectOptions(screen.getByRole("combobox"), "emp-1");
    await waitFor(() => {
      expect(screen.getByText("Job #JOB-001")).toBeInTheDocument();
    });
  });

  it("shows total unpaid amount", async () => {
    renderWithProviders(<CommissionsPage />);
    const user = userEvent.setup();
    await user.click(screen.getByText("Technician Ledger"));
    await waitFor(() => screen.getByText("Choose a technician…"));
    await user.selectOptions(screen.getByRole("combobox"), "emp-1");
    await waitFor(() => {
      expect(screen.getByText(/1,500/)).toBeInTheDocument();
    });
  });

  it("shows both paid and unpaid commission rows", async () => {
    renderWithProviders(<CommissionsPage />);
    const user = userEvent.setup();
    await user.click(screen.getByText("Technician Ledger"));
    await waitFor(() => screen.getByText("Choose a technician…"));
    await user.selectOptions(screen.getByRole("combobox"), "emp-1");
    await waitFor(() => {
      expect(screen.getByText("Job #JOB-001")).toBeInTheDocument();
      expect(screen.getByText("Job #JOB-002")).toBeInTheDocument();
    });
  });
});

describe("Commissions — Payouts tab", () => {
  it("shows existing payout", async () => {
    renderWithProviders(<CommissionsPage />);
    const user = userEvent.setup();
    await user.click(screen.getByText("Payouts"));
    await waitFor(() => {
      // technician_name is "Suresh Kumar" — may also appear in ledger/employee dropdown
      expect(screen.getAllByText("Suresh Kumar").length).toBeGreaterThanOrEqual(1);
    });
  });

  it("shows Draft status badge for payout", async () => {
    renderWithProviders(<CommissionsPage />);
    const user = userEvent.setup();
    await user.click(screen.getByText("Payouts"));
    await waitFor(() => {
      expect(screen.getByText("Draft")).toBeInTheDocument();
    });
  });

  it("shows payout total commission amount", async () => {
    renderWithProviders(<CommissionsPage />);
    const user = userEvent.setup();
    await user.click(screen.getByText("Payouts"));
    await waitFor(() => {
      expect(screen.getAllByText(/1,500/).length).toBeGreaterThanOrEqual(1);
    });
  });

  it("shows Approve button for draft payout", async () => {
    renderWithProviders(<CommissionsPage />);
    const user = userEvent.setup();
    await user.click(screen.getByText("Payouts"));
    await waitFor(() => {
      expect(screen.getByText("Approve")).toBeInTheDocument();
    });
  });

  it("shows Create Payout button", async () => {
    renderWithProviders(<CommissionsPage />);
    const user = userEvent.setup();
    await user.click(screen.getByText("Payouts"));
    await waitFor(() => {
      expect(screen.getByText("Create Payout")).toBeInTheDocument();
    });
  });
});
