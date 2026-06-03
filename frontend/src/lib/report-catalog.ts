import type { ReportMeta } from "@/types/reports";

export const REPORT_CATALOG: ReportMeta[] = [
  // Billing
  { slug: "revenue-summary",        label: "Revenue Summary",         category: "Billing",    filterType: "date_range",   description: "Total revenue collected by payment method over a date range" },
  { slug: "outstanding-dues",       label: "Outstanding Dues",        category: "Billing",    filterType: "overdue_days", description: "Unpaid repair invoices with overdue threshold filter" },
  { slug: "payment-collection-log", label: "Payment Collection Log",  category: "Billing",    filterType: "date_range",   description: "Detailed list of all payments received" },
  { slug: "pnl-summary",            label: "P&L Summary",             category: "Billing",    filterType: "month_year",   description: "Profit & loss summary for a month" },
  // ERP
  { slug: "outstanding-dues-wholesale", label: "Wholesale Outstanding", category: "ERP",      filterType: "none",         description: "Outstanding dues from wholesale / B2B POS sales" },
  { slug: "expense-by-category",    label: "Expense by Category",     category: "ERP",        filterType: "date_range",   description: "Petty cash & expenses grouped by category" },
  { slug: "budget-vs-actual",       label: "Budget vs Actual",        category: "ERP",        filterType: "month_year",   description: "Compare budgeted spend to actual for each cost head" },
  { slug: "inventory-valuation",    label: "Inventory Valuation",     category: "ERP",        filterType: "none",         description: "Current stock value at buying price per product variant" },
  { slug: "stock-movement-ledger",  label: "Stock Movement Ledger",   category: "ERP",        filterType: "date_range",   description: "All stock in / out / adjustment movements" },
  { slug: "supplier-payable-aged",  label: "Supplier Payable Aged",   category: "ERP",        filterType: "overdue_days", description: "Amounts owed to suppliers with ageing buckets" },
  { slug: "purchase-summary",       label: "Purchase Summary",        category: "ERP",        filterType: "date_range",   description: "Purchase order spend by supplier" },
  // Repair
  { slug: "job-status-summary",     label: "Job Status Summary",      category: "Repair",     filterType: "date_range",   description: "Count of jobs by status in a date range" },
  { slug: "job-turnaround-time",    label: "Job Turnaround Time",     category: "Repair",     filterType: "date_range",   description: "Average days from intake to delivery" },
  { slug: "warranty-claims",        label: "Warranty Claims",         category: "Repair",     filterType: "date_range",   description: "Jobs reopened under warranty" },
  { slug: "fault-template-usage",   label: "Fault Template Usage",    category: "Repair",     filterType: "date_range",   description: "Most-used fault templates" },
  { slug: "technician-performance", label: "Technician Performance",  category: "Repair",     filterType: "month_year",   description: "Jobs completed, revenue generated per technician" },
  // HR
  { slug: "commission-ledger",      label: "Commission Ledger",       category: "HR",         filterType: "month_year",   description: "Commissions earned by technician for a month" },
  { slug: "hr-attendance-summary",  label: "Attendance Summary",      category: "HR",         filterType: "month_year",   description: "Present / absent / leave days per employee" },
  { slug: "salary-register",        label: "Salary Register",         category: "HR",         filterType: "month_year",   description: "Monthly salary register with deductions and net pay" },
  { slug: "petty-cash-summary",     label: "Petty Cash Summary",      category: "HR",         filterType: "month_year",   description: "Petty cash account balance and transactions" },
  // CRM
  { slug: "lead-conversion",        label: "Lead Conversion",         category: "CRM",        filterType: "date_range",   description: "Lead funnel and conversion rate" },
  { slug: "customer-acquisition",   label: "Customer Acquisition",    category: "CRM",        filterType: "date_range",   description: "New customers by source" },
  { slug: "customer-lifetime-value",label: "Customer Lifetime Value", category: "CRM",        filterType: "none",         description: "Top customers by total revenue" },
  // AMC
  { slug: "amc-contract-summary",   label: "AMC Contract Summary",    category: "AMC",        filterType: "none",         description: "Active / expiring AMC contracts by status" },
  { slug: "amc-visit-compliance",   label: "AMC Visit Compliance",    category: "AMC",        filterType: "date_range",   description: "Scheduled vs completed AMC visits" },
  { slug: "amc-revenue",            label: "AMC Revenue",             category: "AMC",        filterType: "date_range",   description: "Revenue collected from AMC contracts" },
];

export const REPORT_BY_SLUG = Object.fromEntries(
  REPORT_CATALOG.map((r) => [r.slug, r])
);

export const REPORT_CATEGORIES = Array.from(
  new Set(REPORT_CATALOG.map((r) => r.category))
);
