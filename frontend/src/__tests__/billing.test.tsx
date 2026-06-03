import { describe, it, expect } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "./test-utils";
import BillingPage from "@/app/(dashboard)/billing/page";
import InvoiceDetailPage from "@/app/(dashboard)/billing/[id]/page";

describe("Billing list page", () => {
  it("renders Repair Invoices and POS Sales tabs", () => {
    renderWithProviders(<BillingPage />);
    expect(screen.getByText("Repair Invoices")).toBeInTheDocument();
    expect(screen.getByText("POS Sales")).toBeInTheDocument();
  });

  it("shows invoice number and status", async () => {
    renderWithProviders(<BillingPage />);
    await waitFor(() => {
      expect(screen.getByText("INV-2025-001")).toBeInTheDocument();
      // Status badge may appear multiple times (in tab filter + in card)
      expect(screen.getAllByText("Part Paid").length).toBeGreaterThanOrEqual(1);
    });
  });

  it("shows customer name and job number", async () => {
    renderWithProviders(<BillingPage />);
    await waitFor(() => {
      expect(screen.getByText("Ravi Kumar")).toBeInTheDocument();
      expect(screen.getByText("Job: JOB-001")).toBeInTheDocument();
    });
  });

  it("shows outstanding amount", async () => {
    renderWithProviders(<BillingPage />);
    await waitFor(() => {
      expect(screen.getByText(/2,130/)).toBeInTheDocument();
    });
  });

  it("switches to POS Sales tab on click", async () => {
    renderWithProviders(<BillingPage />);
    const user = userEvent.setup();
    await user.click(screen.getByText("POS Sales"));
    await waitFor(() => {
      expect(screen.getByText("No sales found")).toBeInTheDocument();
    });
  });

  it("Tally Export link is visible", () => {
    renderWithProviders(<BillingPage />);
    expect(screen.getByText("Tally Export")).toBeInTheDocument();
  });
});

describe("Invoice detail page", () => {
  it("renders invoice number and status", async () => {
    renderWithProviders(<InvoiceDetailPage params={{ id: "inv-1" }} />);
    await waitFor(() => {
      expect(screen.getByText("INV-2025-001")).toBeInTheDocument();
      expect(screen.getByText("Partially Paid")).toBeInTheDocument();
    });
  });

  it("shows customer details", async () => {
    renderWithProviders(<InvoiceDetailPage params={{ id: "inv-1" }} />);
    await waitFor(() => {
      expect(screen.getByText("Ravi Kumar")).toBeInTheDocument();
      expect(screen.getByText("+919876543210")).toBeInTheDocument();
    });
  });

  it("shows GST breakdown", async () => {
    renderWithProviders(<InvoiceDetailPage params={{ id: "inv-1" }} />);
    await waitFor(() => {
      expect(screen.getByText("CGST")).toBeInTheDocument();
      expect(screen.getByText("SGST")).toBeInTheDocument();
    });
  });

  it("shows line items section", async () => {
    renderWithProviders(<InvoiceDetailPage params={{ id: "inv-1" }} />);
    await waitFor(() => {
      expect(screen.getByText("Screen Replacement")).toBeInTheDocument();
    });
  });

  it("shows payment history", async () => {
    renderWithProviders(<InvoiceDetailPage params={{ id: "inv-1" }} />);
    await waitFor(() => {
      expect(screen.getByText("Payment History")).toBeInTheDocument();
      expect(screen.getByText("Cash")).toBeInTheDocument();
    });
  });

  it("shows Record Payment button for partially paid invoice", async () => {
    renderWithProviders(<InvoiceDetailPage params={{ id: "inv-1" }} />);
    await waitFor(() => {
      expect(screen.getByText("Record Payment")).toBeInTheDocument();
    });
  });

  it("opens inline payment form on click", async () => {
    renderWithProviders(<InvoiceDetailPage params={{ id: "inv-1" }} />);
    const user = userEvent.setup();
    await waitFor(() => screen.getByText("Record Payment"));
    await user.click(screen.getByText("Record Payment"));
    await waitFor(() => {
      expect(screen.getByText("Confirm Payment")).toBeInTheDocument();
    });
  });

  it("pre-fills outstanding amount in payment form", async () => {
    renderWithProviders(<InvoiceDetailPage params={{ id: "inv-1" }} />);
    const user = userEvent.setup();
    await waitFor(() => screen.getByText("Record Payment"));
    await user.click(screen.getByText("Record Payment"));
    await waitFor(() => {
      const input = screen.getByDisplayValue("2130.00");
      expect(input).toBeInTheDocument();
    });
  });

  it("submits payment and refreshes invoice", async () => {
    renderWithProviders(<InvoiceDetailPage params={{ id: "inv-1" }} />);
    const user = userEvent.setup();
    await waitFor(() => screen.getByText("Record Payment"));
    await user.click(screen.getByText("Record Payment"));
    await waitFor(() => screen.getByText("Confirm Payment"));
    await user.click(screen.getByText("Confirm Payment"));
    await waitFor(() => {
      // Payment form should close after success
      expect(screen.queryByText("Confirm Payment")).not.toBeInTheDocument();
    });
  });
});
