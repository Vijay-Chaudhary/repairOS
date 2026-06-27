'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, Wrench, Users, ShoppingCart, FileText,
  Package, ShoppingBag, CreditCard, TrendingUp, Settings,
  Building, BarChart3, DollarSign, Menu, X, ChevronDown,
  Bell, Search, LogOut, User, UserCheck, Boxes, Receipt, ClipboardList, ListChecks, Filter, Activity,
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
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useRouter } from 'next/navigation';

// ── Types ─────────────────────────────────────────────────────────────

interface NavLeaf {
  type: 'leaf';
  label: string;
  href: string;
  icon: React.ElementType;
  permission?: string;
  anyOf?: string[];
}

interface NavGroup {
  type: 'group';
  label: string;
  icon: React.ElementType;
  children: NavLeaf[];
}

interface NavSection {
  type: 'section';
  label: string;
}

export type NavEntry = NavLeaf | NavGroup | NavSection;

// ── Data ──────────────────────────────────────────────────────────────

export const NAV_ITEMS: NavEntry[] = [
  { type: 'section', label: 'Operations' },
  { type: 'leaf', label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { type: 'group', label: 'Repair', icon: Wrench, children: [
    { type: 'leaf', label: 'Overview', href: '/repair', icon: LayoutDashboard, permission: 'repair.jobs.view' },
    { type: 'leaf', label: 'Jobs', href: '/jobs', icon: Wrench, permission: 'repair.jobs.view' },
    { type: 'leaf', label: 'Spare Parts', href: '/repair/spare-parts', icon: Package, permission: 'repair.spare_parts.request' },
    { type: 'leaf', label: 'Fault Templates', href: '/repair/fault-templates', icon: ClipboardList, permission: 'repair.templates.manage' },
  ]},
  { type: 'group', label: 'CRM', icon: UserCheck, children: [
    { type: 'leaf', label: 'Overview',  href: '/crm',               icon: LayoutDashboard, permission: 'crm.customers.view' },
    { type: 'leaf', label: 'Customers', href: '/customers',         icon: Users,           permission: 'crm.customers.view' },
    { type: 'leaf', label: 'Leads',     href: '/leads',             icon: Users,           permission: 'crm.leads.view' },
    { type: 'leaf', label: 'Quotes',    href: '/crm/quotes',        icon: FileText,        permission: 'crm.leads.view' },
    { type: 'leaf', label: 'Tasks',     href: '/tasks',             icon: ListChecks,      permission: 'crm.tasks.manage' },
    { type: 'leaf', label: 'Activity',  href: '/crm/activity',      icon: Activity,        permission: 'crm.communications.log' },
    { type: 'leaf', label: 'Segments',  href: '/crm/segments',      icon: Filter,          permission: 'crm.segments.manage' },
  ]},
  { type: 'leaf', label: 'POS',  href: '/pos', icon: ShoppingCart, permission: 'pos.counter_sale.create' },
  { type: 'leaf', label: 'AMC',  href: '/amc', icon: Building,     permission: 'amc.contracts.view' },

  { type: 'section', label: 'Finance' },
  { type: 'group', label: 'Inventory & Purchases', icon: Boxes, children: [
    { type: 'leaf', label: 'Inventory', href: '/inventory', icon: Package,     permission: 'erp.inventory.view' },
    { type: 'leaf', label: 'Purchases', href: '/purchases', icon: ShoppingBag, permission: 'erp.purchase_orders.create' },
  ]},
  { type: 'group', label: 'Billing', icon: Receipt, children: [
    { type: 'leaf', label: 'Invoices', href: '/invoices', icon: FileText,   permission: 'billing.repair_invoices.view' },
    { type: 'leaf', label: 'Payments', href: '/payments', icon: CreditCard, permission: 'billing.payments.record' },
  ]},

  { type: 'section', label: 'Management' },
  { type: 'leaf', label: 'Commissions', href: '/commissions', icon: TrendingUp, permission: 'hr.salary.view' },
  { type: 'leaf', label: 'HR',          href: '/hr',          icon: Users,       permission: 'hr.employees.view' },
  { type: 'leaf', label: 'Finance',     href: '/finance',     icon: DollarSign,  permission: 'erp.expenses.view' },
  { type: 'leaf', label: 'Reports',     href: '/reports',     icon: BarChart3,   anyOf: ['reports.revenue.view', 'reports.repair.view'] },

  { type: 'section', label: 'Config' },
  { type: 'leaf', label: 'Settings', href: '/settings', icon: Settings, permission: 'settings.shop.edit' },
];

const BOTTOM_TAB_ITEMS = [
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { label: 'Jobs',      href: '/jobs',      icon: Wrench },
  { label: 'POS',       href: '/pos',       icon: ShoppingCart },
];

function BottomTabLink({ item }: { item: typeof BOTTOM_TAB_ITEMS[number] }) {
  const pathname = usePathname();
  const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
  return (
    <Link
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
}

// ── Nav components ────────────────────────────────────────────────────

function NavSectionLabel({ label, collapsed }: { label: string; collapsed: boolean }) {
  if (collapsed) {
    return <div className="my-1 mx-2 border-t border-[var(--border)]" />;
  }
  return (
    <div className="mt-4 mb-1 px-3">
      <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] opacity-60">
        {label}
      </span>
    </div>
  );
}

function NavLink({ item, collapsed }: { item: NavLeaf; collapsed: boolean }) {
  const pathname = usePathname();
  const isActive = pathname === item.href || pathname.startsWith(item.href + '/');

  const linkEl = (
    <Can permission={item.permission} anyOf={item.anyOf}>
      <Link
        href={item.href}
        className={cn(
          'flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors min-h-[44px]',
          collapsed && 'justify-center',
          isActive
            ? 'bg-[var(--accent)]/10 text-[var(--accent)]'
            : 'text-[var(--text-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]'
        )}
      >
        <item.icon className="h-5 w-5 shrink-0" />
        {!collapsed && <span>{item.label}</span>}
      </Link>
    </Can>
  );

  if (!collapsed) return linkEl;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{linkEl}</TooltipTrigger>
      <TooltipContent side="right">{item.label}</TooltipContent>
    </Tooltip>
  );
}

function NavGroupItem({ group, collapsed }: { group: NavGroup; collapsed: boolean }) {
  const pathname = usePathname();
  const { navGroupsOpen, toggleNavGroup } = useUiStore();
  const { hasPermission, hasAnyPermission } = useAuthStore();

  const hasAccess = group.children.some((child) =>
    child.anyOf
      ? hasAnyPermission(child.anyOf)
      : child.permission
        ? hasPermission(child.permission)
        : true
  );
  if (!hasAccess) return null;

  const isChildActive = group.children.some(
    (c) => pathname === c.href || pathname.startsWith(c.href + '/')
  );
  const isOpen = isChildActive || (navGroupsOpen[group.label] ?? false);

  if (collapsed) {
    const trigger = (
      <DropdownMenuTrigger asChild>
        <button
          className={cn(
            'flex items-center justify-center w-full px-3 py-2.5 rounded-md text-sm font-medium transition-colors min-h-[44px]',
            isChildActive
              ? 'bg-[var(--accent)]/10 text-[var(--accent)]'
              : 'text-[var(--text-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]'
          )}
        >
          <group.icon className="h-5 w-5 shrink-0" />
        </button>
      </DropdownMenuTrigger>
    );

    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div>
            <DropdownMenu>
              {trigger}
              <DropdownMenuContent side="right" className="w-48">
                <div className="px-2 py-1.5 text-xs font-semibold text-[var(--text-muted)]">{group.label}</div>
                {group.children.map((child) => (
                  <Can key={child.href} permission={child.permission} anyOf={child.anyOf}>
                    <DropdownMenuItem asChild>
                      <Link href={child.href} className="flex items-center gap-2">
                        <child.icon className="h-4 w-4" />
                        {child.label}
                      </Link>
                    </DropdownMenuItem>
                  </Can>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </TooltipTrigger>
        <TooltipContent side="right">{group.label}</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <div>
      <button
        onClick={() => toggleNavGroup(group.label)}
        aria-expanded={isOpen}
        className={cn(
          'flex items-center gap-3 w-full px-3 py-2.5 rounded-md text-sm font-medium transition-colors min-h-[44px]',
          isChildActive
            ? 'bg-[var(--accent)]/5 text-[var(--accent)]'
            : 'text-[var(--text-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]'
        )}
      >
        <group.icon className="h-5 w-5 shrink-0" />
        <span className="flex-1 text-left">{group.label}</span>
        <ChevronDown
          className={cn('h-4 w-4 shrink-0 transition-transform duration-200', isOpen && 'rotate-180')}
        />
      </button>
      {isOpen && (
        <div className="ml-4 pl-2 border-l border-[var(--border)] space-y-0.5 mt-0.5">
          {group.children.map((child) => (
            <NavLink key={child.href} item={child} collapsed={false} />
          ))}
        </div>
      )}
    </div>
  );
}

function NavItems({ collapsed }: { collapsed: boolean }) {
  return (
    <nav className="space-y-0.5">
      {NAV_ITEMS.map((entry, i) => {
        if (entry.type === 'section') {
          return <NavSectionLabel key={`section-${i}`} label={entry.label} collapsed={collapsed} />;
        }
        if (entry.type === 'group') {
          return <NavGroupItem key={entry.label} group={entry} collapsed={collapsed} />;
        }
        return <NavLink key={entry.href} item={entry} collapsed={collapsed} />;
      })}
    </nav>
  );
}

// ── ShopSwitcher ──────────────────────────────────────────────────────

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

// ── AppShell ──────────────────────────────────────────────────────────

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuthStore();
  const { sidebarCollapsed, toggleSidebar, mobileNavOpen, toggleMobileNav, setMobileNavOpen } = useUiStore();
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

  const userMenu = (
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
  );

  return (
    <TooltipProvider delayDuration={300}>
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
              <div className="flex items-center gap-2">
                <Wrench className="h-5 w-5 text-[var(--accent)] shrink-0" />
                <span className="text-h2 font-semibold text-[var(--text)]">RepairOS</span>
              </div>
            )}
            <button
              onClick={toggleSidebar}
              className="ml-auto p-1.5 rounded-md hover:bg-[var(--surface-2)] text-[var(--text-muted)] min-h-[auto] min-w-[auto]"
              aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {sidebarCollapsed ? <Menu className="h-4 w-4" /> : <X className="h-4 w-4" />}
            </button>
          </div>

          {/* Nav */}
          <ScrollArea className="flex-1 py-2 px-2">
            <NavItems collapsed={sidebarCollapsed} />
          </ScrollArea>

          {/* User */}
          <div className="border-t border-[var(--border)] p-2 shrink-0">
            {userMenu}
          </div>
        </aside>

        {/* Mobile drawer */}
        <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
          <SheetContent side="left" className="w-72 p-0 flex flex-col">
            <SheetHeader className="flex flex-row items-center gap-2 h-14 px-4 border-b border-[var(--border)] shrink-0 space-y-0">
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              <Wrench className="h-5 w-5 text-[var(--accent)] shrink-0" />
              <span className="text-h2 font-semibold text-[var(--text)]" aria-hidden>RepairOS</span>
            </SheetHeader>
            <ScrollArea className="flex-1 py-2 px-2">
              <NavItems collapsed={false} />
            </ScrollArea>
            <div className="border-t border-[var(--border)] p-2 shrink-0">
              <button
                onClick={handleLogout}
                className="flex items-center gap-2 w-full rounded-md px-3 py-2.5 text-sm font-medium text-[var(--danger)] hover:bg-[var(--danger)]/10 transition-colors min-h-[44px]"
              >
                <LogOut className="h-5 w-5 shrink-0" />
                Sign out
              </button>
            </div>
          </SheetContent>
        </Sheet>

        {/* Main */}
        <div className="flex flex-col flex-1 overflow-hidden">
          {/* Topbar */}
          <header className="h-14 flex items-center gap-3 px-4 border-b border-[var(--border)] bg-[var(--surface)] shrink-0">
            <button
              className="md:hidden p-1.5 rounded-md hover:bg-[var(--surface-2)] text-[var(--text-muted)] min-h-[auto] min-w-[auto]"
              onClick={toggleMobileNav}
              aria-label="Open navigation"
            >
              <Menu className="h-5 w-5" />
            </button>
            <ShopSwitcher />
            <div className="flex-1" />
            <button className="p-2 rounded-md hover:bg-[var(--surface-2)] text-[var(--text-muted)] min-h-[auto] min-w-[auto]" aria-label="Search">
              <Search className="h-5 w-5" />
            </button>
            <button className="p-2 rounded-md hover:bg-[var(--surface-2)] text-[var(--text-muted)] min-h-[auto] min-w-[auto]" aria-label="Notifications">
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
          {BOTTOM_TAB_ITEMS.map((item) => (
            <BottomTabLink key={item.href} item={item} />
          ))}
          <button
            className="flex-1 flex flex-col items-center justify-center gap-0.5 py-2 text-xs text-[var(--text-muted)] min-h-[56px] min-w-[auto]"
            onClick={toggleMobileNav}
            aria-label="More navigation"
          >
            <Menu className="h-5 w-5" />
            <span>More</span>
          </button>
        </nav>
      </div>
    </TooltipProvider>
  );
}
