"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, Wrench, Users, ShoppingCart,
  Package, TruckIcon, Receipt, UserCheck,
  BarChart2, Shield, LogOut, Menu, X, DollarSign, Wallet, Building2,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth.store";
import { useAnyPermission } from "@/hooks/use-permission";
import { PERMISSIONS } from "@/lib/permissions";

interface NavItem {
  href: string;
  icon: React.ElementType;
  label: string;
  perms?: (keyof typeof PERMISSIONS)[];
}

const NAV: NavItem[] = [
  { href: "/dashboard",   icon: LayoutDashboard, label: "Dashboard" },
  { href: "/repairs",     icon: Wrench,          label: "Repairs",      perms: ["REPAIR_JOBS_VIEW"] },
  { href: "/customers",   icon: Users,           label: "Customers",    perms: ["CRM_CUSTOMERS_VIEW"] },
  { href: "/pos",         icon: ShoppingCart,    label: "POS",          perms: ["POS_COUNTER_SALE", "POS_WHOLESALE_SALE"] },
  { href: "/inventory",   icon: Package,         label: "Inventory",    perms: ["ERP_INVENTORY_VIEW"] },
  { href: "/procurement", icon: TruckIcon,       label: "Procurement",  perms: ["ERP_PROCUREMENT_VIEW"] },
  { href: "/billing",     icon: Receipt,         label: "Billing",      perms: ["BILLING_INVOICES_VIEW", "BILLING_SALES_VIEW"] },
  { href: "/hr",          icon: UserCheck,       label: "HR",           perms: ["HR_EMPLOYEES_VIEW"] },
  { href: "/commissions", icon: DollarSign,      label: "Commissions",  perms: ["HR_SALARY_VIEW"] },
  { href: "/finance",     icon: Wallet,          label: "Finance",      perms: ["ERP_EXPENSES_MANAGE"] },
  { href: "/amc",         icon: Shield,          label: "AMC",          perms: ["AMC_CONTRACTS_VIEW"] },
  { href: "/reports",     icon: BarChart2,       label: "Reports",      perms: ["REPORTS_BILLING", "REPORTS_REPAIR", "REPORTS_ERP", "REPORTS_HR", "REPORTS_CRM", "REPORTS_AMC"] },
  { href: "/platform",   icon: Building2,       label: "Platform Admin" }, // shown only to is_platform_admin
];

function NavLink({ item }: { item: NavItem }) {
  const pathname = usePathname();
  const user = useAuthStore((s) => s.user);
  const permKeys = (item.perms ?? []).map((k) => PERMISSIONS[k]);
  const allowed = useAnyPermission(...(permKeys as Parameters<typeof useAnyPermission>));

  // Platform Admin link is only for platform admins
  if (item.href === "/platform" && !user?.is_platform_admin) return null;
  if (item.perms && !allowed) return null;

  const active = pathname === item.href || pathname.startsWith(item.href + "/");
  return (
    <Link
      href={item.href}
      className={cn(
        "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition min-h-[44px]",
        active
          ? "bg-blue-50 text-blue-700"
          : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
      )}
    >
      <item.icon className="w-4 h-4 flex-shrink-0" />
      {item.label}
    </Link>
  );
}

export function Sidebar() {
  const { user, logout } = useAuthStore();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <>
      {/* Mobile toggle */}
      <button
        onClick={() => setMobileOpen(!mobileOpen)}
        className="md:hidden fixed top-4 left-4 z-50 p-2 bg-white rounded-lg shadow-md border border-gray-200"
        aria-label="Toggle menu"
      >
        {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
      </button>

      {/* Overlay */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 bg-black/40 z-40" onClick={() => setMobileOpen(false)} />
      )}

      {/* Sidebar panel */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 w-60 bg-white border-r border-gray-200 flex flex-col transition-transform duration-200",
          "md:translate-x-0 md:static md:inset-auto",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* Logo */}
        <div className="flex items-center gap-3 px-4 py-5 border-b border-gray-100">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center flex-shrink-0">
            <span className="text-white font-bold text-sm">R</span>
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-gray-900 text-sm truncate">RepairOS</p>
            <p className="text-xs text-gray-500 truncate">{user?.tenant_slug ?? "—"}</p>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5" onClick={() => setMobileOpen(false)}>
          {NAV.map((item) => <NavLink key={item.href} item={item} />)}
        </nav>

        {/* User / Logout */}
        <div className="border-t border-gray-100 p-3">
          <div className="flex items-center gap-3 px-2 py-2 mb-1">
            <div className="w-8 h-8 bg-gray-200 rounded-full flex items-center justify-center flex-shrink-0">
              <span className="text-xs font-medium text-gray-600">
                {user?.name?.charAt(0)?.toUpperCase() ?? "U"}
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-gray-900 truncate">{user?.name || "User"}</p>
              <p className="text-xs text-gray-500 truncate">{user?.phone}</p>
            </div>
          </div>
          <button
            onClick={() => logout()}
            className="flex items-center gap-3 w-full px-3 py-2 rounded-lg text-sm text-gray-500 hover:bg-red-50 hover:text-red-600 transition min-h-[44px]"
          >
            <LogOut className="w-4 h-4" />
            Sign out
          </button>
        </div>
      </aside>
    </>
  );
}
