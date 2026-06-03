import { describe, it, expect } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, MOCK_USER } from "./test-utils";
import PlatformAdminPage from "@/app/(dashboard)/platform/page";

const PLATFORM_USER = { ...MOCK_USER, is_platform_admin: true };
const REGULAR_USER  = { ...MOCK_USER, is_platform_admin: false };

describe("Platform Admin — access control", () => {
  it("shows access denied for regular user", () => {
    renderWithProviders(<PlatformAdminPage />, { user: REGULAR_USER });
    expect(screen.getByText("Platform Admin Access Only")).toBeInTheDocument();
  });

  it("shows admin panel for platform admin", () => {
    renderWithProviders(<PlatformAdminPage />, { user: PLATFORM_USER });
    expect(screen.getByText("Platform Admin")).toBeInTheDocument();
    expect(screen.getByText("Tenants")).toBeInTheDocument();
    expect(screen.getByText("Subscription Plans")).toBeInTheDocument();
  });
});

describe("Platform Admin — Tenants tab", () => {
  it("shows tenant names", async () => {
    renderWithProviders(<PlatformAdminPage />, { user: PLATFORM_USER });
    await waitFor(() => {
      expect(screen.getByText("Tech Repairs Pvt Ltd")).toBeInTheDocument();
      expect(screen.getByText("QuickFix Solutions")).toBeInTheDocument();
    });
  });

  it("shows tenant status badges", async () => {
    renderWithProviders(<PlatformAdminPage />, { user: PLATFORM_USER });
    await waitFor(() => {
      // "Active" and "Suspended" appear as badges and in stats — use getAllByText
      expect(screen.getAllByText("Active").length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText("Suspended").length).toBeGreaterThanOrEqual(1);
    });
  });

  it("shows tenant stats (Total, Active, Suspended)", async () => {
    renderWithProviders(<PlatformAdminPage />, { user: PLATFORM_USER });
    await waitFor(() => {
      expect(screen.getByText("Total")).toBeInTheDocument();
    });
  });

  it("shows owner email in tenant card", async () => {
    renderWithProviders(<PlatformAdminPage />, { user: PLATFORM_USER });
    await waitFor(() => {
      expect(screen.getByText(/owner@techrepairs.in/)).toBeInTheDocument();
    });
  });

  it("opens tenant detail panel on click", async () => {
    renderWithProviders(<PlatformAdminPage />, { user: PLATFORM_USER });
    const user = userEvent.setup();
    await waitFor(() => screen.getByText("Tech Repairs Pvt Ltd"));
    await user.click(screen.getByText("Tech Repairs Pvt Ltd"));
    await waitFor(() => {
      expect(screen.getByText("techrepairs")).toBeInTheDocument();
    });
  });

  it("shows Suspend button for active tenant", async () => {
    renderWithProviders(<PlatformAdminPage />, { user: PLATFORM_USER });
    const user = userEvent.setup();
    await waitFor(() => screen.getByText("Tech Repairs Pvt Ltd"));
    await user.click(screen.getByText("Tech Repairs Pvt Ltd"));
    await waitFor(() => {
      expect(screen.getByText("Suspend Tenant")).toBeInTheDocument();
    });
  });

  it("shows subscription plan in detail panel", async () => {
    renderWithProviders(<PlatformAdminPage />, { user: PLATFORM_USER });
    const user = userEvent.setup();
    await waitFor(() => screen.getByText("Tech Repairs Pvt Ltd"));
    await user.click(screen.getByText("Tech Repairs Pvt Ltd"));
    await waitFor(() => {
      expect(screen.getByText(/Professional/)).toBeInTheDocument();
    });
  });

  it("filters tenants by search text", async () => {
    renderWithProviders(<PlatformAdminPage />, { user: PLATFORM_USER });
    const user = userEvent.setup();
    await waitFor(() => screen.getByText("Tech Repairs Pvt Ltd"));
    await user.type(screen.getByPlaceholderText("Search tenants…"), "QuickFix");
    await waitFor(() => {
      expect(screen.getByText("QuickFix Solutions")).toBeInTheDocument();
      expect(screen.queryByText("Tech Repairs Pvt Ltd")).not.toBeInTheDocument();
    });
  });
});

describe("Platform Admin — Plans tab", () => {
  it("shows all 3 subscription plan names", async () => {
    renderWithProviders(<PlatformAdminPage />, { user: PLATFORM_USER });
    const user = userEvent.setup();
    await user.click(screen.getByText("Subscription Plans"));
    await waitFor(() => {
      expect(screen.getByText("Starter")).toBeInTheDocument();
      expect(screen.getByText("Professional")).toBeInTheDocument();
      expect(screen.getByText("Enterprise")).toBeInTheDocument();
    });
  });

  it("shows plan prices", async () => {
    renderWithProviders(<PlatformAdminPage />, { user: PLATFORM_USER });
    const user = userEvent.setup();
    await user.click(screen.getByText("Subscription Plans"));
    await waitFor(() => {
      // Plans show ₹999, ₹2,999, ₹9,999 — all contain digits; at least 3 /mo labels
      expect(screen.getAllByText(/\/mo/).length).toBeGreaterThanOrEqual(3);
    });
  });

  it("shows plan limit labels", async () => {
    renderWithProviders(<PlatformAdminPage />, { user: PLATFORM_USER });
    const user = userEvent.setup();
    await user.click(screen.getByText("Subscription Plans"));
    await waitFor(() => {
      expect(screen.getAllByText("Shops").length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText("Users").length).toBeGreaterThanOrEqual(1);
    });
  });

  it("shows Unlimited for zero-limit enterprise plan fields", async () => {
    renderWithProviders(<PlatformAdminPage />, { user: PLATFORM_USER });
    const user = userEvent.setup();
    await user.click(screen.getByText("Subscription Plans"));
    await waitFor(() => {
      expect(screen.getAllByText("Unlimited").length).toBeGreaterThanOrEqual(1);
    });
  });

  it("shows feature flags per plan", async () => {
    renderWithProviders(<PlatformAdminPage />, { user: PLATFORM_USER });
    const user = userEvent.setup();
    await user.click(screen.getByText("Subscription Plans"));
    await waitFor(() => {
      expect(screen.getAllByText("whatsapp").length).toBeGreaterThanOrEqual(1);
    });
  });
});
