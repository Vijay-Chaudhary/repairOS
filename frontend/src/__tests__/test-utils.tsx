import React from "react";
import { render, type RenderOptions } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore } from "@/stores/auth.store";

const MOCK_USER = {
  id: "user-1",
  name: "Test Admin",
  phone: "+919876543210",
  email: "admin@test.com",
  tenant_slug: "demo",
  shop_ids: ["shop-1"],
  role_ids: ["role-1"],
  permissions: [
    "crm.customers.view", "crm.customers.create", "crm.customers.edit",
    "repair.jobs.view", "repair.jobs.create", "repair.jobs.edit",
    "pos.counter_sale.create",
    "erp.inventory.view", "erp.inventory.adjust",
    "erp.procurement.view",
    "billing.repair_invoices.view", "billing.repair_invoices.create", "billing.payments.record",
    "hr.employees.view", "hr.employees.manage",
    "hr.attendance.view", "hr.attendance.mark",
    "hr.leaves.manage", "hr.salary.view", "hr.salary.generate",
    "reports.billing.view", "reports.repair.view", "reports.erp.view",
    "reports.hr.view", "reports.crm.view", "reports.amc.view",
    "amc.contracts.view", "amc.contracts.create", "amc.contracts.edit",
    "amc.visits.schedule", "amc.visits.complete", "amc.renewals.manage",
  ],
  is_platform_admin: false,
};

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
}

function AllProviders({ children }: { children: React.ReactNode }) {
  const qc = makeQueryClient();
  return (
    <QueryClientProvider client={qc}>
      {children}
    </QueryClientProvider>
  );
}

export function renderWithProviders(
  ui: React.ReactElement,
  options?: Omit<RenderOptions, "wrapper"> & { user?: typeof MOCK_USER | null }
) {
  const { user = MOCK_USER, ...renderOptions } = options ?? {};
  useAuthStore.setState({ user, isAuthenticated: !!user, isLoading: false });
  return render(ui, { wrapper: AllProviders, ...renderOptions });
}

export { MOCK_USER };
export * from "@testing-library/react";
