// Each list-query factory returns [base] when called with no args (correct prefix
// for invalidateQueries) and [base, filters] when called with filters (specific key
// for useQuery). This ensures invalidateQueries({ queryKey: qk.foo() }) always busts
// every cached variant of that resource, regardless of which filters were passed.
function listKey<B extends string>(base: B) {
  function key(): readonly [B];
  function key(filters: Record<string, unknown>): readonly [B, Record<string, unknown>];
  function key(filters?: Record<string, unknown>): readonly [B] | readonly [B, Record<string, unknown>] {
    return filters !== undefined ? [base, filters] as const : [base] as const;
  }
  return key;
}

export const qk = {
  // Auth
  me: () => ['me'] as const,

  // Repair
  jobs:           listKey('jobs'),
  job:            (id: string) => ['job', id] as const,
  jobTimeline:    (id: string) => ['job', id, 'timeline'] as const,
  jobEstimates:   (id: string) => ['job', id, 'estimates'] as const,
  jobStages:      (id: string) => ['job', id, 'stages'] as const,
  repairTemplates: () => ['repair-templates'] as const,
  repairOverview: (shopId: string | null) => ['repair-overview', shopId] as const,

  // CRM
  customers:       listKey('customers'),
  customer:        (id: string) => ['customer', id] as const,
  customerTimeline:(id: string) => ['customer', id, 'timeline'] as const,
  leads:           listKey('leads'),
  lead:            (id: string) => ['lead', id] as const,
  leadComms:       (id: string) => ['lead', id, 'comms'] as const,
  leadQuotes:      (id: string) => ['lead', id, 'quotes'] as const,
  tasks:           listKey('tasks'),
  segments:        () => ['segments'] as const,
  segmentMembers:  (id: string) => ['segment-members', id] as const,

  // POS
  posSales: listKey('pos-sales'),
  posSale:  (id: string) => ['pos-sale', id] as const,

  // AMC
  amcContracts: listKey('amc-contracts'),
  amcContract:  (id: string) => ['amc-contract', id] as const,
  amcVisits:    (contractId: string) => ['amc-visits', contractId] as const,

  // Inventory
  products:      listKey('products'),
  product:       (id: string) => ['product', id] as const,
  stock:         listKey('stock'),
  stockMovements:listKey('stock-movements'),
  stockAlerts:   (shopId: string | null) => ['stock-alerts', shopId] as const,
  categories:    () => ['categories'] as const,

  // Procurement
  purchaseOrders:  listKey('purchase-orders'),
  purchaseOrder:   (id: string) => ['purchase-order', id] as const,
  suppliers:       listKey('suppliers'),
  supplier:        (id: string) => ['supplier', id] as const,
  purchaseReturns: (invoiceId: string) => ['purchase-returns', invoiceId] as const,

  // Billing
  invoices: listKey('invoices'),
  invoice:  (id: string) => ['invoice', id] as const,
  payments: listKey('payments'),

  // Commissions
  commissions:    listKey('commissions'),
  commissionRules:() => ['commission-rules'] as const,

  // HR
  employees:   listKey('employees'),
  employee:    (id: string) => ['employee', id] as const,
  attendance:  listKey('attendance'),
  leaves:      listKey('leaves'),
  salarySlips: listKey('salary-slips'),
  pettyCash:   listKey('petty-cash'),

  // Finance
  expenses: listKey('expenses'),
  budgets:  (shopId: string | null) => ['budgets', shopId] as const,
  assets:   listKey('assets'),

  // Reports
  dashboard: (shopId: string | null) => ['dashboard', shopId] as const,
  report:    (type: string, filters: Record<string, unknown>) => ['report', type, filters] as const,

  // Settings
  shops:          () => ['shops'] as const,
  shop:           (id: string) => ['shop', id] as const,
  tenantBranding: () => ['tenant-branding'] as const,
  roles:          () => ['roles'] as const,
  role:           (id: string) => ['role', id] as const,
  users:          listKey('users'),
  permissions:    () => ['permissions'] as const,
  notifTemplates: () => ['notif-templates'] as const,
  whatsAppConnection: () => ['whatsapp-connection'] as const,

  // Platform Admin
  tenants: listKey('tenants'),
  tenant:  (id: string) => ['tenant', id] as const,
  plans:   () => ['plans'] as const,
} as const;
