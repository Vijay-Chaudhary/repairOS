export interface CommissionRule {
  id: string;
  name: string;
  rate: string;               // % of service charge
  lead_tech_share: string;    // % of pool given to lead tech
  applies_to_job_type: string | null;
  effective_from: string;
  effective_to: string | null;
}

export interface TechnicianCommission {
  id: string;
  job_number: string;
  sc_amount: string;
  rate: string;
  commission_amount: string;
  is_lead: boolean;
  is_paid: boolean;
  payout_id: string | null;
}

export interface TechnicianLedger {
  technician_id: string;
  total_unpaid: string;
  commissions: TechnicianCommission[];
}

export type PayoutStatus = "draft" | "approved" | "paid";

export interface CommissionPayout {
  id: string;
  technician: string;
  technician_name: string;
  period_start: string;
  period_end: string;
  total_commission: string;
  status: PayoutStatus;
  paid_at: string | null;
  pdf_url: string;
}
