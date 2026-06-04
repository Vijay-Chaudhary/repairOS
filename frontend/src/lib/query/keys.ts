export const qk = {
  // Auth
  me: () => ['me'] as const,

  // Repair
  jobs: (filters?: Record<string, unknown>) => ['jobs', filters] as const,
  job: (id: string) => ['job', id] as const,
  jobTimeline: (id: string) => ['job', id, 'timeline'] as const,
  jobEstimates: (id: string) => ['job', id, 'estimates'] as const,
  jobStages: (id: string) => ['job', id, 'stages'] as const,
  repairTemplates: () => ['repair-templates'] as const,

  // CRM
  customers: (filters?: Record<string, unknown>) => ['customers', filters] as const,
  customer: (id: string) => ['customer', id] as const,
  customerTimeline: (id: string) => ['customer', id, 'timeline'] as const,
  leads: (filters?: Record<string, unknown>) => ['leads', filters] as const,
  lead: (id: string) => ['lead', id] as const,
  tasks: (filters?: Record<string, unknown>) => ['tasks', filters] as const,
  segments: () => ['segments'] as const,

  // POS
  posSales: (filters?: Record<string, unknown>) => ['pos-sales', filters] as const,
  posSale: (id: string) => ['pos-sale', id] as const,

  // AMC
  amcContracts: (filters?: Record<string, unknown>) => ['amc-contracts', filters] as const,
  amcContract: (id: string) => ['amc-contract', id] as const,
  amcVisits: (contractId: string) => ['amc-visits', contractId] as const,

  // Inventory
  products: (filters?: Record<string, unknown>) => ['products', filters] as const,
  product: (id: string) => ['product', id] as const,
  stock: (shopId: string | null) => ['stock', shopId] as const,
  stockMovements: (filters?: Record<string, unknown>) => ['stock-movements', filters] as const,
  stockAlerts: (shopId: string | null) => ['stock-alerts', shopId] as const,

  // Procurement
  purchaseOrders: (filters?: Record<string, unknown>) => ['purchase-orders', filters] as const,
  purchaseOrder: (id: string) => ['purchase-order', id] as const,
  suppliers: (filters?: Record<string, unknown>) => ['suppliers', filters] as const,
  supplier: (id: string) => ['supplier', id] as const,

  // Billing
  invoices: (filters?: Record<string, unknown>) => ['invoices', filters] as const,
  invoice: (id: string) => ['invoice', id] as const,
  payments: (filters?: Record<string, unknown>) => ['payments', filters] as const,

  // Commissions
  commissions: (filters?: Record<string, unknown>) => ['commissions', filters] as const,
  commissionRules: () => ['commission-rules'] as const,

  // HR
  employees: (filters?: Record<string, unknown>) => ['employees', filters] as const,
  employee: (id: string) => ['employee', id] as const,
  attendance: (filters?: Record<string, unknown>) => ['attendance', filters] as const,
  leaves: (filters?: Record<string, unknown>) => ['leaves', filters] as const,
  salarySlips: (filters?: Record<string, unknown>) => ['salary-slips', filters] as const,
  pettyCash: (filters?: Record<string, unknown>) => ['petty-cash', filters] as const,

  // Finance
  expenses: (filters?: Record<string, unknown>) => ['expenses', filters] as const,
  budgets: (shopId: string | null) => ['budgets', shopId] as const,
  assets: (filters?: Record<string, unknown>) => ['assets', filters] as const,

  // Reports
  dashboard: (shopId: string | null) => ['dashboard', shopId] as const,
  revenueReport: (filters?: Record<string, unknown>) => ['report-revenue', filters] as const,
  hrReport: (filters?: Record<string, unknown>) => ['report-hr', filters] as const,
  gstReport: (filters?: Record<string, unknown>) => ['report-gst', filters] as const,
  repairReport: (filters?: Record<string, unknown>) => ['report-repair', filters] as const,
  inventoryReport: (filters?: Record<string, unknown>) => ['report-inventory', filters] as const,

  // Settings
  shops: () => ['shops'] as const,
  shop: (id: string) => ['shop', id] as const,
  roles: () => ['roles'] as const,
  role: (id: string) => ['role', id] as const,
  users: (filters?: Record<string, unknown>) => ['users', filters] as const,
  permissions: () => ['permissions'] as const,
  notifTemplates: () => ['notif-templates'] as const,

  // Platform Admin
  tenants: (filters?: Record<string, unknown>) => ['tenants', filters] as const,
  tenant: (id: string) => ['tenant', id] as const,
  plans: () => ['plans'] as const,
} as const;
