export type ContractStatus = "active" | "expired" | "cancelled" | "pending_renewal";
export type PaymentTerms  = "upfront" | "quarterly" | "monthly";
export type VisitStatus   = "scheduled" | "completed" | "missed" | "rescheduled" | "cancelled";

export interface AMCContractSummary {
  id: string;
  contract_number: string;
  title: string;
  status: ContractStatus;
  customer_name: string;
  start_date: string;
  end_date: string;
  value: string;
  visits_per_year: number;
}

export interface AMCRenewalInvoice {
  id: string;
  invoice_id: string;
  renewal_period_start: string;
  renewal_period_end: string;
  sent_at: string | null;
}

export interface AMCContract extends AMCContractSummary {
  shop_id: string;
  customer_id: string;
  description: string;
  payment_terms: PaymentTerms;
  visit_interval_days: number;
  auto_renew: boolean;
  renewal_reminder_days: number;
  location_address: string;
  location_lat: string | null;
  location_lng: string | null;
  assigned_technician: string | null;
  notes: string;
  visits_count: number;
  renewal_invoices: AMCRenewalInvoice[];
  created_at: string;
  updated_at: string;
}

export interface AMCVisit {
  id: string;
  visit_number: number;
  scheduled_date: string;
  actual_date: string | null;
  status: VisitStatus;
  technician: string | null;
  technician_name: string;
  work_done: string;
  issues_found: string;
  next_visit_date: string | null;
  customer_signature_url: string;
  photos: string[];
  job_id: string | null;
  created_at: string;
}
