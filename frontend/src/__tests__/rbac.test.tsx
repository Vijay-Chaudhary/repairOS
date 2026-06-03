import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders, MOCK_USER } from "./test-utils";
import { PermissionGate } from "@/components/ui/permission-gate";
import { PERMISSIONS } from "@/lib/permissions";
import { useAuthStore } from "@/stores/auth.store";
import { usePermission } from "@/hooks/use-permission";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>
    {children}
  </QueryClientProvider>
);

const LIMITED_USER = {
  ...MOCK_USER,
  permissions: ["crm.customers.view"],
  is_platform_admin: false,
} as const;

const ADMIN_USER = {
  ...MOCK_USER,
  permissions: [],
  is_platform_admin: true,
} as const;

describe("usePermission hook", () => {
  it("returns true when user has permission", () => {
    useAuthStore.setState({ user: LIMITED_USER, isAuthenticated: true, isLoading: false });
    const { result } = renderHook(() => usePermission(PERMISSIONS.CRM_CUSTOMERS_VIEW), { wrapper });
    expect(result.current).toBe(true);
  });

  it("returns false when user lacks permission", () => {
    useAuthStore.setState({ user: LIMITED_USER, isAuthenticated: true, isLoading: false });
    const { result } = renderHook(() => usePermission(PERMISSIONS.BILLING_PAYMENTS_RECORD), { wrapper });
    expect(result.current).toBe(false);
  });

  it("returns true for platform admins regardless of permissions", () => {
    useAuthStore.setState({ user: ADMIN_USER, isAuthenticated: true, isLoading: false });
    const { result } = renderHook(() => usePermission(PERMISSIONS.BILLING_PAYMENTS_RECORD), { wrapper });
    expect(result.current).toBe(true);
  });

  it("returns false when no user is logged in", () => {
    useAuthStore.setState({ user: null, isAuthenticated: false, isLoading: false });
    const { result } = renderHook(() => usePermission(PERMISSIONS.CRM_CUSTOMERS_VIEW), { wrapper });
    expect(result.current).toBe(false);
  });
});

describe("PermissionGate component", () => {
  it("renders children when user has the required permission", () => {
    renderWithProviders(
      <PermissionGate perm={PERMISSIONS.CRM_CUSTOMERS_VIEW}>
        <button>Allowed Action</button>
      </PermissionGate>,
      { user: LIMITED_USER }
    );
    expect(screen.getByText("Allowed Action")).toBeInTheDocument();
  });

  it("renders nothing when user lacks the required permission", () => {
    renderWithProviders(
      <PermissionGate perm={PERMISSIONS.BILLING_PAYMENTS_RECORD}>
        <button>Hidden Action</button>
      </PermissionGate>,
      { user: LIMITED_USER }
    );
    expect(screen.queryByText("Hidden Action")).not.toBeInTheDocument();
  });

  it("renders fallback node when user lacks permission and fallback is provided", () => {
    renderWithProviders(
      <PermissionGate perm={PERMISSIONS.BILLING_PAYMENTS_RECORD} fallback={<span>No Access</span>}>
        <button>Hidden</button>
      </PermissionGate>,
      { user: LIMITED_USER }
    );
    expect(screen.getByText("No Access")).toBeInTheDocument();
    expect(screen.queryByText("Hidden")).not.toBeInTheDocument();
  });

  it("renders children when any= contains at least one matching permission", () => {
    renderWithProviders(
      <PermissionGate any={[PERMISSIONS.CRM_CUSTOMERS_VIEW, PERMISSIONS.BILLING_PAYMENTS_RECORD]}>
        <button>Partially Allowed</button>
      </PermissionGate>,
      { user: LIMITED_USER }
    );
    expect(screen.getByText("Partially Allowed")).toBeInTheDocument();
  });

  it("renders nothing when any= contains no matching permissions", () => {
    renderWithProviders(
      <PermissionGate any={[PERMISSIONS.BILLING_PAYMENTS_RECORD, PERMISSIONS.HR_SALARY_GENERATE]}>
        <button>Should Hide</button>
      </PermissionGate>,
      { user: LIMITED_USER }
    );
    expect(screen.queryByText("Should Hide")).not.toBeInTheDocument();
  });

  it("platform admin can see all gated content", () => {
    renderWithProviders(
      <PermissionGate perm={PERMISSIONS.BILLING_PAYMENTS_RECORD}>
        <button>Admin Action</button>
      </PermissionGate>,
      { user: ADMIN_USER }
    );
    expect(screen.getByText("Admin Action")).toBeInTheDocument();
  });
});
