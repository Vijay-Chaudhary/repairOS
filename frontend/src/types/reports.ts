export interface DashboardData {
  jobs_today_by_status: Record<string, number>;
  revenue_today: string;
  outstanding_dues: string;
  amc_visits_this_week: number;
  low_stock_alerts: number;
  contracts_expiring_this_month: number;
  budget_heads_over_limit: number;
}

// ── Report filter types ───────────────────────────────────────────────────────

export type FilterType = "date_range" | "month_year" | "overdue_days" | "none";

export interface ReportMeta {
  slug: string;
  label: string;
  category: string;
  filterType: FilterType;
  description: string;
}

// ── Report data shapes (loose — columns vary per report) ─────────────────────

export type ReportRow = Record<string, string | number | null>;

export interface ReportData {
  [key: string]: ReportRow[] | string | number | null | Record<string, unknown>;
}
