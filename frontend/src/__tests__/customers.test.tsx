import { describe, it, expect } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, MOCK_USER } from "./test-utils";
import CustomersPage from "@/app/(dashboard)/customers/page";
import CustomerDetailPage from "@/app/(dashboard)/customers/[id]/page";
import NewCustomerPage from "@/app/(dashboard)/customers/new/page";
import { http, HttpResponse } from "msw";
import { server } from "./mocks/server";

const API = "http://localhost/api/v1";

describe("Customers list", () => {
  it("renders customer name and phone from API", async () => {
    renderWithProviders(<CustomersPage />);
    await waitFor(() => {
      expect(screen.getByText("Ravi Kumar")).toBeInTheDocument();
      expect(screen.getByText("+919876543210")).toBeInTheDocument();
    });
  });

  it("shows 'Add Customer' button when user has create permission", async () => {
    renderWithProviders(<CustomersPage />);
    await waitFor(() => {
      expect(screen.getByText("Add Customer")).toBeInTheDocument();
    });
  });

  it("hides 'Add Customer' when user lacks create permission", async () => {
    renderWithProviders(<CustomersPage />, {
      user: { ...MOCK_USER, permissions: ["crm.customers.view"] },
    });
    await waitFor(() => {
      expect(screen.getByText("Ravi Kumar")).toBeInTheDocument();
    });
    expect(screen.queryByText("Add Customer")).not.toBeInTheDocument();
  });

  it("shows empty state when no customers returned", async () => {
    server.use(
      http.get(`${API}/crm/customers/`, () =>
        HttpResponse.json({
          success: true,
          data: [],
          meta: { next_cursor: null, prev_cursor: null },
        })
      )
    );
    renderWithProviders(<CustomersPage />);
    await waitFor(() => {
      expect(screen.getByText("No customers found")).toBeInTheDocument();
    });
  });

  it("shows outstanding badge when customer has dues", async () => {
    renderWithProviders(<CustomersPage />);
    await waitFor(() => {
      expect(screen.getByText(/2,000/)).toBeInTheDocument();
    });
  });
});

describe("Customer detail", () => {
  it("renders customer full name and stats", async () => {
    renderWithProviders(<CustomerDetailPage params={{ id: "cust-1" }} />);
    await waitFor(() => {
      expect(screen.getByText("Ravi Kumar")).toBeInTheDocument();
    });
  });

  it("shows New Repair action link", async () => {
    renderWithProviders(<CustomerDetailPage params={{ id: "cust-1" }} />);
    await waitFor(() => {
      expect(screen.getByText("New Repair")).toBeInTheDocument();
    });
  });

  it("shows customer city", async () => {
    renderWithProviders(<CustomerDetailPage params={{ id: "cust-1" }} />);
    await waitFor(() => {
      expect(screen.getByText(/Bangalore/)).toBeInTheDocument();
    });
  });
});

describe("New customer form", () => {
  it("renders name and phone fields", () => {
    renderWithProviders(<NewCustomerPage />);
    expect(screen.getByPlaceholderText("Customer name")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("+919876543210")).toBeInTheDocument();
  });

  it("shows validation error for missing name", async () => {
    renderWithProviders(<NewCustomerPage />);
    const user = userEvent.setup();
    await user.click(screen.getByText("Save Customer"));
    await waitFor(() => {
      expect(screen.getByText("Name is required")).toBeInTheDocument();
    });
  });

  it("individual/business toggle switches type", async () => {
    renderWithProviders(<NewCustomerPage />);
    const user = userEvent.setup();
    await user.click(screen.getByText("Business"));
    await waitFor(() => {
      expect(screen.getByPlaceholderText("22AAAAA0000A1Z5")).toBeInTheDocument();
    });
  });
});
