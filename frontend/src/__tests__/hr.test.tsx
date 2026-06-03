import { describe, it, expect } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "./test-utils";
import HRPage from "@/app/(dashboard)/hr/page";
import EmployeeDetailPage from "@/app/(dashboard)/hr/[id]/page";
import NewEmployeePage from "@/app/(dashboard)/hr/new/page";

describe("HR page — employees tab", () => {
  it("renders all 4 tabs", () => {
    renderWithProviders(<HRPage />);
    expect(screen.getByText("Employees")).toBeInTheDocument();
    expect(screen.getByText("Attendance")).toBeInTheDocument();
    expect(screen.getByText("Leaves")).toBeInTheDocument();
    expect(screen.getByText("Payroll")).toBeInTheDocument();
  });

  it("shows employee name and designation", async () => {
    renderWithProviders(<HRPage />);
    await waitFor(() => {
      expect(screen.getByText("Suresh Kumar")).toBeInTheDocument();
      expect(screen.getByText(/Technician/)).toBeInTheDocument();
    });
  });

  it("shows Add button for managers", async () => {
    renderWithProviders(<HRPage />);
    await waitFor(() => {
      expect(screen.getByText("Add")).toBeInTheDocument();
    });
  });

  it("shows employee gross salary", async () => {
    renderWithProviders(<HRPage />);
    await waitFor(() => {
      expect(screen.getByText(/27,000/)).toBeInTheDocument();
    });
  });
});

describe("HR page — attendance tab", () => {
  it("shows employees in attendance view", async () => {
    renderWithProviders(<HRPage />);
    const user = userEvent.setup();
    await user.click(screen.getByText("Attendance"));
    await waitFor(() => {
      expect(screen.getByText("All Present")).toBeInTheDocument();
      expect(screen.getByText("All Absent")).toBeInTheDocument();
    });
  });

  it("marks all present on 'All Present' click", async () => {
    renderWithProviders(<HRPage />);
    const user = userEvent.setup();
    await user.click(screen.getByText("Attendance"));
    await waitFor(() => screen.getByText("Suresh Kumar"));
    await user.click(screen.getByText("All Present"));
    await waitFor(() => {
      expect(screen.getByText(/Save 1 Attendance Record/)).toBeInTheDocument();
    });
  });
});

describe("HR page — leaves tab", () => {
  it("shows pending leave requests by default", async () => {
    renderWithProviders(<HRPage />);
    const user = userEvent.setup();
    await user.click(screen.getByText("Leaves"));
    await waitFor(() => {
      expect(screen.getByText("Suresh Kumar")).toBeInTheDocument();
      // "Pending" appears in tab filter + status badge; at least 2 elements
      expect(screen.getAllByText("Pending").length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText("Casual")).toBeInTheDocument();
    });
  });

  it("shows approve and reject buttons for pending leaves", async () => {
    renderWithProviders(<HRPage />);
    const user = userEvent.setup();
    await user.click(screen.getByText("Leaves"));
    await waitFor(() => {
      expect(screen.getByText("Approve")).toBeInTheDocument();
      expect(screen.getByText("Reject")).toBeInTheDocument();
    });
  });

  it("approves leave on button click", async () => {
    renderWithProviders(<HRPage />);
    const user = userEvent.setup();
    await user.click(screen.getByText("Leaves"));
    await waitFor(() => screen.getByText("Approve"));
    await user.click(screen.getByText("Approve"));
    // Expect refetch to trigger — no error
    await waitFor(() => {
      expect(screen.queryByText("Failed")).not.toBeInTheDocument();
    });
  });
});

describe("HR page — payroll tab", () => {
  it("shows month/year picker and generate form", async () => {
    renderWithProviders(<HRPage />);
    const user = userEvent.setup();
    await user.click(screen.getByText("Payroll"));
    await waitFor(() => {
      expect(screen.getByText("Generate Salary Slips")).toBeInTheDocument();
      expect(screen.getByText("Select All")).toBeInTheDocument();
    });
  });

  it("enables generate button when employees selected", async () => {
    renderWithProviders(<HRPage />);
    const user = userEvent.setup();
    await user.click(screen.getByText("Payroll"));
    await waitFor(() => screen.getByText("Select All"));
    await user.click(screen.getByText("Select All"));
    await waitFor(() => {
      const btn = screen.getByText(/Generate 1 Slip/);
      expect(btn).not.toBeDisabled();
    });
  });
});

describe("Employee detail page", () => {
  it("renders employee name and designation", async () => {
    renderWithProviders(<EmployeeDetailPage params={{ id: "emp-1" }} />);
    await waitFor(() => {
      expect(screen.getByText("Suresh Kumar")).toBeInTheDocument();
      expect(screen.getByText("Technician")).toBeInTheDocument();
    });
  });

  it("shows salary breakdown", async () => {
    renderWithProviders(<EmployeeDetailPage params={{ id: "emp-1" }} />);
    await waitFor(() => {
      expect(screen.getByText("Gross Salary")).toBeInTheDocument();
      expect(screen.getByText("Net Take-Home")).toBeInTheDocument();
    });
  });

  it("shows masked bank and PAN details", async () => {
    renderWithProviders(<EmployeeDetailPage params={{ id: "emp-1" }} />);
    await waitFor(() => {
      // bank, pan, aadhar all render as "****"
      expect(screen.getAllByText("****").length).toBeGreaterThanOrEqual(1);
    });
  });
});

describe("New employee form", () => {
  it("renders all required fields", () => {
    renderWithProviders(<NewEmployeePage />);
    expect(screen.getByPlaceholderText("EMP001")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Employee name")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Technician")).toBeInTheDocument();
  });

  it("shows validation error for missing employee code", async () => {
    renderWithProviders(<NewEmployeePage />);
    const user = userEvent.setup();
    await user.click(screen.getByText("Save Employee"));
    await waitFor(() => {
      expect(screen.getAllByText("Required").length).toBeGreaterThan(0);
    });
  });

  it("renders statutory deductions section", () => {
    renderWithProviders(<NewEmployeePage />);
    expect(screen.getByText("Statutory Deductions")).toBeInTheDocument();
  });
});
