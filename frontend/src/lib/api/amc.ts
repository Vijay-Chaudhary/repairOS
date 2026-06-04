import { apiGet, apiPost, apiPatch, type PageMeta } from './client';

export type ContractStatus = 'active' | 'expired' | 'cancelled' | 'pending_renewal';
export type VisitStatus = 'scheduled' | 'completed' | 'missed' | 'rescheduled' | 'cancelled';
export type PaymentTerms = 'upfront' | 'quarterly' | 'monthly';

export interface AmcContract {
  id: string;
  shop_id: string;
  customer_id: string;
  customer_name: string;
  customer_phone?: string | null;
  contract_number: string;
  title: string;
  description?: string | null;
  status: ContractStatus;
  start_date: string;
  end_date: string;
  value: number;
  payment_terms: PaymentTerms;
  visits_per_year: number;
  visit_interval_days: number;
  auto_renew: boolean;
  renewal_reminder_days: number;
  location_address?: string | null;
  assigned_technician_id?: string | null;
  assigned_technician_name?: string | null;
  notes?: string | null;
  next_visit_date?: string | null;
  created_at: string;
}

export interface AmcVisit {
  id: string;
  contract_id: string;
  visit_number: number;
  scheduled_date: string;
  actual_date?: string | null;
  status: VisitStatus;
  technician_id?: string | null;
  technician_name?: string | null;
  work_done?: string | null;
  issues_found?: string | null;
  next_visit_date?: string | null;
  customer_signature_url?: string | null;
  photos: string[];
  job_id?: string | null;
}

export const amcApi = {
  listContracts: (filters: {
    shop_id?: string;
    status?: ContractStatus;
    customer_id?: string;
    expiring_days?: number;
    cursor?: string;
  } = {}) =>
    apiGet<{ items: AmcContract[]; meta: PageMeta }>(
      '/amc/contracts/',
      filters as Record<string, string | number | undefined>,
    ),

  getContract: (id: string) =>
    apiGet<AmcContract>(`/amc/contracts/${id}/`),

  createContract: (body: {
    shop_id: string;
    customer_id: string;
    title: string;
    description?: string;
    value: number;
    start_date: string;
    end_date: string;
    visits_per_year: number;
    payment_terms: PaymentTerms;
    auto_renew?: boolean;
    renewal_reminder_days?: number;
    location_address?: string;
    assigned_technician_id?: string;
    notes?: string;
  }) => apiPost<AmcContract>('/amc/contracts/', body),

  updateContract: (id: string, body: Partial<{
    title: string;
    description: string;
    value: number;
    end_date: string;
    auto_renew: boolean;
    renewal_reminder_days: number;
    assigned_technician_id: string;
    notes: string;
  }>) => apiPatch<AmcContract>(`/amc/contracts/${id}/`, body),

  getVisits: (contractId: string) =>
    apiGet<{ items: AmcVisit[] }>(`/amc/contracts/${contractId}/visits/`),

  completeVisit: (visitId: string, body: {
    work_done: string;
    issues_found?: string;
    customer_signature_url?: string | null;
    photos?: string[];
    job_id?: string;
    next_visit_date?: string;
  }) => apiPost<AmcVisit>(`/amc/visits/${visitId}/complete/`, body),

  renewContract: (contractId: string, body: {
    new_end_date: string;
    new_value?: number;
  }) => apiPost<AmcContract>(`/amc/contracts/${contractId}/renew/`, body),
};

export const PAYMENT_TERMS_LABELS: Record<PaymentTerms, string> = {
  upfront: 'Upfront', quarterly: 'Quarterly', monthly: 'Monthly',
};

export const VISIT_STATUS_COLORS: Record<VisitStatus, string> = {
  scheduled:   'bg-[var(--info)]/15 text-[var(--info)]',
  completed:   'bg-[var(--success)]/15 text-[var(--success)]',
  missed:      'bg-[var(--danger)]/15 text-[var(--danger)]',
  rescheduled: 'bg-[var(--warning)]/15 text-[var(--warning)]',
  cancelled:   'bg-[var(--text-muted)]/15 text-[var(--text-muted)]',
};
