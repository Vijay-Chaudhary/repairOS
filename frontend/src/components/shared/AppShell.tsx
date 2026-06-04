'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, Wrench, Users, ShoppingCart, FileText,
  Package, ShoppingBag, CreditCard, TrendingUp, Settings,
  Building, BarChart3, DollarSign, Menu, X, ChevronDown,
  Bell, Search, LogOut, User
} from 'lucide-react';
import { useAuthStore } from '@/lib/stores/authStore';
import { useActiveShopStore } from '@/lib/stores/activeShopStore';
import { useUiStore } from '@/lib/stores/uiStore';
import { wsClient } from '@/lib/ws/client';
import { authApi } from '@/lib/api/auth';
import { Can } from '@/components/shared/Can';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { useRouter } from 'next/navigation';

interface NavItem {
  label: string;
  href: string;
  icon: React.ElementType;
  permission?: string;
  anyOf?: string[];
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { label: 'Jobs', href: '/jobs', icon: Wrench, permission: 'repair.jobs.view' },
  { label: 'Customers', href: '/customers', icon: Users, permission: 'crm.customers.view' },
  { label: 'Leads', href: '/leads', icon: Users, permission: 'crm.leads.view' },
  { label: 'POS', href: '/pos', icon: ShoppingCart, permission: 'pos.counter_sale.create' },
  { label: 'AMC', href: '/amc', icon: Building, permission: 'amc.contracts.view' },
  { label: 'Inventory', href: '/inventory', icon: Package, permission: 'erp.inventory.view' },
  { label: 'Purchases', href: '/purchases', icon: ShoppingBag, permission: 'erp.purchase_orders.create' },
  { label: 'Invoices', href: '/invoices', icon: FileText, permission: 'billing.repair_invoices.view' },
  { label: 'Payments', href: '/payments', icon: CreditCard, permission: 'billing.payments.record' },
  { label: 'Commissions', href: '/commissions', icon: TrendingUp, permission: 'hr.salary.view' },
  { label: 'HR', href: '/hr', icon: Users, permission: 'hr.employees.view' },
  { label: 'Finance', href: '/finance', icon: DollarSign, permission: 'erp.expenses.view' },
  { label: 'Reports', href: '/reports', icon: BarChart3, anyOf: ['reports.revenue.view', 'reports.repair.view'] },
  { label: 'Settings', href: '/settings', icon: Settings, permission: 'settings.shop.edit' },
];

const BOTTOM_TAB_ITEMS = [
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { label: 'Jobs', href: '/jobs', icon: Wrench },
  { label: 'POS', href: '/pos', icon: ShoppingCart },
];

function NavLink({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  const pathname = usePathname();
  const isActive = pathname === item.href || pathname.startsWith(item.href + '/');

  return (
    <Can permission={item.permission} anyOf={item.anyOf}>
      <Link
        href={item.href}
        className={cn(
          'flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors min-h-[44px]',
          isActive
            ? 'bg-[var(--accent)]/10 text-[var(--accent)]'
            : 'text-[var(--text-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]'
        )}
        title={collapsed ? item.label : undefined}
      >
        <item.icon className="h-5 w-5 shrink-0" />
        {!collapsed && <span>{item.label}</span>}
      </Link>
    </Can>
  );
}

function ShopSwitcher() {
  const { shops, activeShopId, isAllShops, setActiveShop, setAllShops } = useActiveShopStore();
  const { user } = useAuthStore();

  const activeShop = shops.find((s) => s.id === activeShopId);
  const label = isAllShops ? 'All shops' : (activeShop?.name ?? 'Select shop');

  function handleSelect(shopId: string | null) {
    if (shopId === null) {
      setAllShops();
      wsClient.subscribe(null);
    } else {
      setActiveShop(shopId);
      wsClient.subscribe(shopId);
    }
  }

  if (shops.length <= 1 && !user?.is_platform_admin) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-2 px-3 py-2 rounded-md text-sm text-[var(--text)] hover:bg-[var(--surface-2)] transition-colors min-h-[40px] max-w-[180px]">
          <Building className="h-4 w-4 text-[var(--text-muted)] shrink-0" />
          <span className="truncate font-medium">{label}</span>
          <ChevronDown className="h-3 w-3 text-[var(--text-muted)] shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        {user?.is_platform_admin && (
          <DropdownMenuItem onClick={() => handleSelect(null)}>All shops</DropdownMenuItem>
        )}
        {shops.map((shop) => (
          <DropdownMenuItem key={shop.id} onClick={() => handleSelect(shop.id)}>
            {shop.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuthStore();
  const { sidebarCollapsed, toggleSidebar } = useUiStore();
  const router = useRouter();

  async function handleLogout() {
    try { await authApi.logout(); } catch { /* ignore */ }
    logout();
    wsClient.disconnect();
    router.replace('/login');
  }

  const initials = user?.name
    ? user.name.split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase()
    : '?';

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--bg)]">
      {/* Sidebar — desktop */}
      <aside
        className={cn(
          'hidden md:flex flex-col border-r border-[var(--border)] bg-[var(--surface)] transition-all duration-200',
          sidebarCollapsed ? 'w-16' : 'w-60'
        )}
      >
        {/* Logo */}
        <div className="flex items-center h-14 px-3 border-b border-[var(--border)] shrink-0">
          {!sidebarCollapsed && (
            <span className="text-h2 font-semibold text-[var(--text)]">RepairOS</span>
          )}
          <button
            onClick={toggleSidebar}
            className="ml-auto p-1.5 rounded-md hover:bg-[var(--surface-2)] text-[var(--text-muted)] min-h-[auto] min-w-[auto]"
          >
            {sidebarCollapsed ? <Menu className="h-4 w-4" /> : <X className="h-4 w-4" />}
          </button>
        </div>

        {/* Nav */}
        <ScrollArea className="flex-1 py-2 px-2">
          <nav className="space-y-0.5">
            {NAV_ITEMS.map((item) => (
              <NavLink key={item.href} item={item} collapsed={sidebarCollapsed} />
            ))}
          </nav>
        </ScrollArea>

        {/* User */}
        <div className="border-t border-[var(--border)] p-2 shrink-0">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className={cn(
                'flex items-center gap-2 w-full rounded-md px-2 py-2 hover:bg-[var(--surface-2)] transition-colors min-h-[44px]',
                sidebarCollapsed && 'justify-center'
              )}>
                <Avatar className="h-8 w-8 shrink-0">
                  <AvatarFallback>{initials}</AvatarFallback>
                </Avatar>
                {!sidebarCollapsed && (
                  <div className="text-left overflow-hidden">
                    <p className="text-body-sm font-medium text-[var(--text)] truncate">{user?.name}</p>
                    <p className="text-xs text-[var(--text-muted)] truncate">{user?.email}</p>
                  </div>
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="start" className="w-48">
              <DropdownMenuItem asChild>
                <Link href="/settings/profile"><User className="h-4 w-4" /> Profile</Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleLogout} className="text-[var(--danger)]">
                <LogOut className="h-4 w-4" /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>

      {/* Main */}
      <div className="flex flex-col flex-1 overflow-hidden">
        {/* Topbar */}
        <header className="h-14 flex items-center gap-3 px-4 border-b border-[var(--border)] bg-[var(--surface)] shrink-0">
          <button className="md:hidden p-1.5 rounded-md hover:bg-[var(--surface-2)] text-[var(--text-muted)] min-h-[auto] min-w-[auto]">
            <Menu className="h-5 w-5" />
          </button>
          <ShopSwitcher />
          <div className="flex-1" />
          <button className="p-2 rounded-md hover:bg-[var(--surface-2)] text-[var(--text-muted)] min-h-[auto] min-w-[auto]">
            <Search className="h-5 w-5" />
          </button>
          <button className="p-2 rounded-md hover:bg-[var(--surface-2)] text-[var(--text-muted)] min-h-[auto] min-w-[auto]">
            <Bell className="h-5 w-5" />
          </button>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-auto pb-16 md:pb-0">
          {children}
        </main>
      </div>

      {/* Bottom tab bar — mobile */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 flex border-t border-[var(--border)] bg-[var(--surface)] z-40">
        {BOTTOM_TAB_ITEMS.map((item) => {
          const pathname = typeof window !== 'undefined' ? window.location.pathname : '';
          const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex-1 flex flex-col items-center justify-center gap-0.5 py-2 text-xs min-h-[56px]',
                isActive ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'
              )}
            >
              <item.icon className="h-5 w-5" />
              <span>{item.label}</span>
            </Link>
          );
        })}
        <button
          className="flex-1 flex flex-col items-center justify-center gap-0.5 py-2 text-xs text-[var(--text-muted)] min-h-[56px] min-w-[auto]"
          onClick={handleLogout}
        >
          <LogOut className="h-5 w-5" />
          <span>More</span>
        </button>
      </nav>
    </div>
  );
}
