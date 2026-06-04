import { apiGet } from './client';

export type ExportFormat = 'pdf' | 'csv';
export type ExportStatus = 'queued' | 'processing' | 'ready' | 'failed';

export interface DashboardData {
  open_jobs: number;
  jobs_completed_today: number;
  revenue_today: number;
  revenue_month: number;
  new_customers_month: number;
  outstanding_amount: number;
  tasks_due_today?: number;
  amc_visits_this_week?: number;
  low_stock_alerts?: number;
  contracts_expiring_this_month?: number;
  over_budget_heads?: number;
  revenue_trend?: { date: string; revenue: number }[];
}

export interface ExportJob {
  id: string;
  report_type: string;
  format: ExportFormat;
  status: ExportStatus;
  file_url?: string | null;
  created_at: string;
  completed_at?: string | null;
}

export type FilterKey =
  | 'date_range'
  | 'month_year'
  | 'shop'
  | 'overdue_days'
  | 'technician_id'
  | 'employee_id'
  | 'category'
  | 'status';

export interface ReportDef {
  type: string;
  label: string;
  module: string;
  permission: string;
  filters: FilterKey[];
  exports: ExportFormat[];
}

export const REPORT_CATALOGUE: ReportDef[] = [
  // Billing
  { type: 'revenue-summary',           label: 'Revenue Summary',              module: 'Billing', permission: 'reports.billing.view', filters: ['date_range', 'shop'],                  exports: ['pdf', 'csv'] },
  { type: 'outstanding-dues-repair',   label: 'Outstanding Dues (Repair)',    module: 'Billing', permission: 'reports.billing.view', filters: ['overdue_days', 'shop'],               exports: ['pdf', 'csv'] },
  { type: 'outstanding-dues-wholesale',label: 'Outstanding Dues (Wholesale)', module: 'Billing', permission: 'reports.billing.view', filters: ['overdue_days', 'shop'],               exports: ['pdf', 'csv'] },
  { type: 'payment-collection-log',    label: 'Payment Collection Log',       module: 'Billing', permission: 'reports.billing.view', filters: ['date_range', 'shop'],                  exports: ['csv'] },
  { type: 'pl-summary',                label: 'P&L Summary',                  module: 'Billing', permission: 'reports.billing.view', filters: ['month_year', 'shop'],                  exports: ['pdf'] },
  { type: 'gstr-1',                    label: 'GSTR-1 (Outward Supplies)',    module: 'Billing', permission: 'reports.billing.view', filters: ['month_year', 'shop'],                  exports: ['csv'] },
  { type: 'gstr-2',                    label: 'GSTR-2 Proxy (Inward)',        module: 'Billing', permission: 'reports.billing.view', filters: ['month_year', 'shop'],                  exports: ['csv'] },
  // Repair
  { type: 'job-status-summary',        label: 'Job Status Summary',           module: 'Repair',  permission: 'reports.repair.view',  filters: ['date_range', 'shop', 'status', 'technician_id'], exports: ['pdf', 'csv'] },
  { type: 'job-turnaround-time',       label: 'Job Turnaround Time',          module: 'Repair',  permission: 'reports.repair.view',  filters: ['date_range', 'shop'],                  exports: ['csv'] },
  { type: 'warranty-claims',           label: 'Warranty Claims',              module: 'Repair',  permission: 'reports.repair.view',  filters: ['date_range', 'shop'],                  exports: ['csv'] },
  { type: 'fault-template-usage',      label: 'Fault Template Usage',         module: 'Repair',  permission: 'reports.repair.view',  filters: ['date_range'],                          exports: ['csv'] },
  { type: 'technician-performance',    label: 'Technician Performance',       module: 'Repair',  permission: 'reports.repair.view',  filters: ['month_year', 'shop', 'technician_id'], exports: ['pdf', 'csv'] },
  { type: 'commission-ledger',         label: 'Commission Ledger',            module: 'Repair',  permission: 'reports.repair.view',  filters: ['month_year', 'technician_id'],          exports: ['pdf'] },
  // CRM
  { type: 'lead-conversion',           label: 'Lead Conversion',              module: 'CRM',     permission: 'reports.crm.view',     filters: ['date_range', 'shop'],                  exports: ['csv'] },
  { type: 'customer-acquisition',      label: 'Customer Acquisition',         module: 'CRM',     permission: 'reports.crm.view',     filters: ['date_range', 'shop'],                  exports: ['csv'] },
  { type: 'customer-lifetime-value',   label: 'Customer Lifetime Value',      module: 'CRM',     permission: 'reports.crm.view',     filters: ['date_range'],                          exports: ['csv'] },
  // AMC
  { type: 'amc-contract-summary',      label: 'AMC Contract Summary',         module: 'AMC',     permission: 'reports.amc.view',     filters: ['shop', 'status'],                      exports: ['pdf', 'csv'] },
  { type: 'amc-visit-compliance',      label: 'AMC Visit Compliance',         module: 'AMC',     permission: 'reports.amc.view',     filters: ['date_range', 'shop'],                  exports: ['csv'] },
  { type: 'amc-revenue',               label: 'AMC Revenue',                  module: 'AMC',     permission: 'reports.amc.view',     filters: ['date_range', 'shop'],                  exports: ['pdf', 'csv'] },
  // ERP
  { type: 'inventory-valuation',       label: 'Inventory Valuation',          module: 'ERP',     permission: 'reports.erp.view',     filters: ['date_range', 'shop', 'category'],      exports: ['csv'] },
  { type: 'stock-movement-ledger',     label: 'Stock Movement Ledger',        module: 'ERP',     permission: 'reports.erp.view',     filters: ['date_range', 'shop'],                  exports: ['csv'] },
  { type: 'supplier-payable',          label: 'Supplier Payable (Aged)',       module: 'ERP',     permission: 'reports.erp.view',     filters: ['overdue_days', 'shop'],               exports: ['pdf', 'csv'] },
  { type: 'purchase-summary',          label: 'Purchase Summary',             module: 'ERP',     permission: 'reports.erp.view',     filters: ['date_range', 'shop'],                  exports: ['pdf', 'csv'] },
  { type: 'expense-by-category',       label: 'Expense by Category',          module: 'ERP',     permission: 'reports.erp.view',     filters: ['date_range', 'shop', 'category'],      exports: ['pdf', 'csv'] },
  { type: 'budget-vs-actual',          label: 'Budget vs Actual',             module: 'ERP',     permission: 'reports.erp.view',     filters: ['month_year', 'shop'],                  exports: ['pdf', 'csv'] },
  // HR
  { type: 'hr-attendance-summary',     label: 'HR Attendance Summary',        module: 'HR',      permission: 'reports.hr.view',      filters: ['month_year', 'shop', 'employee_id'],   exports: ['pdf', 'csv'] },
  { type: 'salary-register',           label: 'Salary Register',              module: 'HR',      permission: 'reports.hr.view',      filters: ['month_year', 'shop'],                  exports: ['pdf', 'csv'] },
  { type: 'petty-cash-summary',        label: 'Petty Cash Summary',           module: 'HR',      permission: 'reports.hr.view',      filters: ['month_year', 'shop'],                  exports: ['pdf', 'csv'] },
];

export const REPORT_MODULES = ['Billing', 'Repair', 'CRM', 'AMC', 'ERP', 'HR'] as const;
export type ReportModule = typeof REPORT_MODULES[number];

export const reportApi = {
  getDashboard: (shopId?: string | null) =>
    apiGet<DashboardData>(
      '/reports/dashboard/',
      shopId ? { shop_id: shopId } : {},
    ),

  getReport: (type: string, filters: Record<string, string | number | undefined>) =>
    apiGet<Record<string, unknown>>(`/reports/${type}/`, filters),

  requestExport: (
    type: string,
    filters: Record<string, string | number | undefined>,
    format: ExportFormat,
  ) =>
    apiGet<{ export_job_id: string; status: ExportStatus }>(
      `/reports/${type}/export/`,
      { ...filters, format } as Record<string, string>,
    ),

  pollExportJob: (jobId: string) =>
    apiGet<ExportJob>(`/reports/export-jobs/${jobId}/`),
};
