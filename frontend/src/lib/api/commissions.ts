import { apiGet, apiPost, apiPatch, type PageMeta } from './client';

export type PayoutStatus = 'draft' | 'approved' | 'paid';

export interface CommissionRule {
  id: string;
  name: string;
  rate: number;
  lead_tech_share: number;
  applies_to_job_type?: string | null;
  effective_from: string;
  effective_to?: string | null;
}

export interface TechnicianCommission {
  id: string;
  job_id: string;
  job_number: string;
  is_lead: boolean;
  sc_amount: number;
  rate: number;
  commission_amount: number;
  is_paid: boolean;
  payout_id?: string | null;
  job_closed_at: string;
}

export interface CommissionPayout {
  id: string;
  technician_id: string;
  technician_name?: string | null;
  period_start: string;
  period_end: string;
  total_commission: number;
  status: PayoutStatus;
  paid_at?: string | null;
  pdf_url?: string | null;
}

export interface TechnicianLedger {
  technician_id: string;
  technician_name: string;
  period_start: string;
  period_end: string;
  total_earned: number;
  total_paid: number;
  total_unpaid: number;
  commissions: TechnicianCommission[];
}

export const commissionsApi = {
  listRules: () =>
    apiGet<{ items: CommissionRule[] }>('/commissions/rules/'),

  createRule: (body: {
    name: string;
    rate: number;
    lead_tech_share?: number;
    applies_to_job_type?: string;
    effective_from: string;
    effective_to?: string;
  }) => apiPost<CommissionRule>('/commissions/rules/', body),

  getTechnicianLedger: (techId: string, filters?: {
    period_start?: string;
    period_end?: string;
  }) =>
    apiGet<TechnicianLedger>(
      `/commissions/technician/${techId}/`,
      filters as Record<string, string | undefined>,
    ),

  listPayouts: (filters?: { technician_id?: string; status?: PayoutStatus }) =>
    apiGet<{ items: CommissionPayout[]; meta: PageMeta }>(
      '/commissions/payouts/',
      filters as Record<string, string | undefined>,
    ),

  createPayout: (body: {
    technician_id: string;
    period_start: string;
    period_end: string;
  }) => apiPost<CommissionPayout>('/commissions/payouts/', body),

  // Advance payout status: draft → approved → paid
  advancePayout: (payoutId: string) =>
    apiPatch<CommissionPayout>(`/commissions/payouts/${payoutId}/`, {}),
};
