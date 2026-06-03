import { describe, it, expect } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "./test-utils";
import FinancePage from "@/app/(dashboard)/finance/page";

describe("Finance — Petty Cash tab", () => {
  it("renders all 4 tab labels", () => {
    renderWithProviders(<FinancePage />);
    expect(screen.getByText("Petty Cash")).toBeInTheDocument();
    expect(screen.getByText("Expenses")).toBeInTheDocument();
    expect(screen.getByText("Budget")).toBeInTheDocument();
    expect(screen.getByText("Assets")).toBeInTheDocument();
  });

  it("shows petty cash account balance", async () => {
    renderWithProviders(<FinancePage />);
    await waitFor(() => {
      // Balance 5000.00 formatted as ₹5,000.00
      expect(screen.getByText(/5,000/)).toBeInTheDocument();
    });
  });

  it("shows account name", async () => {
    renderWithProviders(<FinancePage />);
    await waitFor(() => {
      expect(screen.getByText("Main Cash")).toBeInTheDocument();
    });
  });

  it("shows Add Transaction button", async () => {
    renderWithProviders(<FinancePage />);
    await waitFor(() => {
      expect(screen.getByText("Add Transaction")).toBeInTheDocument();
    });
  });

  it("shows recent transactions", async () => {
    renderWithProviders(<FinancePage />);
    await waitFor(() => {
      expect(screen.getByText("Pens and paper")).toBeInTheDocument();
      expect(screen.getByText("Cash top-up")).toBeInTheDocument();
    });
  });

  it("shows debit transaction amount", async () => {
    renderWithProviders(<FinancePage />);
    await waitFor(() => {
      // debit: "-₹200.00" — the sign and rupee symbol are adjacent
      expect(screen.getByText((content) => content.includes("-") && content.includes("200"))).toBeInTheDocument();
    });
  });

  it("shows credit transaction amount", async () => {
    renderWithProviders(<FinancePage />);
    await waitFor(() => {
      // credit: "+₹2,000.00"
      expect(screen.getByText((content) => content.includes("+") && content.includes("2,000"))).toBeInTheDocument();
    });
  });

  it("opens transaction form and shows Expense/Top Up buttons", async () => {
    renderWithProviders(<FinancePage />);
    const user = userEvent.setup();
    await waitFor(() => screen.getByText("Add Transaction"));
    await user.click(screen.getByText("Add Transaction"));
    await waitFor(() => {
      expect(screen.getByText("New Transaction")).toBeInTheDocument();
      expect(screen.getByText("Expense")).toBeInTheDocument();
      expect(screen.getByText("Top Up")).toBeInTheDocument();
    });
  });
});

describe("Finance — Expenses tab", () => {
  it("shows expenses list", async () => {
    renderWithProviders(<FinancePage />);
    const user = userEvent.setup();
    await user.click(screen.getByText("Expenses"));
    await waitFor(() => {
      expect(screen.getByText("Cab fare")).toBeInTheDocument();
    });
  });

  it("shows expense amount", async () => {
    renderWithProviders(<FinancePage />);
    const user = userEvent.setup();
    await user.click(screen.getByText("Expenses"));
    await waitFor(() => {
      expect(screen.getByText(/500/)).toBeInTheDocument();
    });
  });

  it("shows Add Expense button", async () => {
    renderWithProviders(<FinancePage />);
    const user = userEvent.setup();
    await user.click(screen.getByText("Expenses"));
    await waitFor(() => {
      expect(screen.getByText("Add Expense")).toBeInTheDocument();
    });
  });

  it("opens expense form on click", async () => {
    renderWithProviders(<FinancePage />);
    const user = userEvent.setup();
    await user.click(screen.getByText("Expenses"));
    await waitFor(() => screen.getByText("Add Expense"));
    await user.click(screen.getByText("Add Expense"));
    await waitFor(() => {
      expect(screen.getByPlaceholderText("Travel, Supplies, etc.")).toBeInTheDocument();
    });
  });

  it("shows monthly total", async () => {
    renderWithProviders(<FinancePage />);
    const user = userEvent.setup();
    await user.click(screen.getByText("Expenses"));
    await waitFor(() => {
      expect(screen.getByText(/This month:/)).toBeInTheDocument();
    });
  });
});

describe("Finance — Budget tab", () => {
  it("shows budget heads", async () => {
    renderWithProviders(<FinancePage />);
    const user = userEvent.setup();
    await user.click(screen.getByText("Budget"));
    await waitFor(() => {
      expect(screen.getByText("Operations")).toBeInTheDocument();
      expect(screen.getByText("Marketing")).toBeInTheDocument();
    });
  });

  it("shows budget vs actual amounts", async () => {
    renderWithProviders(<FinancePage />);
    const user = userEvent.setup();
    await user.click(screen.getByText("Budget"));
    await waitFor(() => {
      expect(screen.getByText(/7,500/)).toBeInTheDocument();
      expect(screen.getByText(/10,000/)).toBeInTheDocument();
    });
  });

  it("shows month selector", async () => {
    renderWithProviders(<FinancePage />);
    const user = userEvent.setup();
    await user.click(screen.getByText("Budget"));
    await waitFor(() => {
      // Month dropdown exists
      const selects = screen.getAllByRole("combobox");
      expect(selects.length).toBeGreaterThan(0);
    });
  });
});

describe("Finance — Assets tab", () => {
  it("shows asset name and code", async () => {
    renderWithProviders(<FinancePage />);
    const user = userEvent.setup();
    await user.click(screen.getByText("Assets"));
    await waitFor(() => {
      expect(screen.getByText("MacBook Pro")).toBeInTheDocument();
      expect(screen.getByText("ASSET-001")).toBeInTheDocument();
    });
  });

  it("shows Good condition badge", async () => {
    renderWithProviders(<FinancePage />);
    const user = userEvent.setup();
    await user.click(screen.getByText("Assets"));
    await waitFor(() => {
      // "Good" appears multiple times (badge + condition button) — at least 1
      expect(screen.getAllByText("Good").length).toBeGreaterThanOrEqual(1);
    });
  });

  it("shows purchase cost", async () => {
    renderWithProviders(<FinancePage />);
    const user = userEvent.setup();
    await user.click(screen.getByText("Assets"));
    await waitFor(() => {
      expect(screen.getByText(/1,20,000/)).toBeInTheDocument();
    });
  });

  it("shows Add Asset button", async () => {
    renderWithProviders(<FinancePage />);
    const user = userEvent.setup();
    await user.click(screen.getByText("Assets"));
    await waitFor(() => {
      expect(screen.getByText("Add Asset")).toBeInTheDocument();
    });
  });

  it("shows inline condition buttons", async () => {
    renderWithProviders(<FinancePage />);
    const user = userEvent.setup();
    await user.click(screen.getByText("Assets"));
    await waitFor(() => {
      expect(screen.getAllByText("Fair").length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText("Poor").length).toBeGreaterThanOrEqual(1);
    });
  });

  it("shows warranty expiry", async () => {
    renderWithProviders(<FinancePage />);
    const user = userEvent.setup();
    await user.click(screen.getByText("Assets"));
    await waitFor(() => {
      expect(screen.getByText(/Warranty till/)).toBeInTheDocument();
    });
  });
});
