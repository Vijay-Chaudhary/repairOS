import { platformApiGet as apiGet, platformApiPost as apiPost, platformApiPatch as apiPatch, type PageMeta } from './platformClient';

export type DbStatus = 'provisioning' | 'active' | 'suspended' | 'deleted';
export type SubStatus = 'active' | 'trialing' | 'past_due' | 'cancelled' | 'paused';

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  db_status: DbStatus;
  plan_id: string;
  plan_name: string;
  subscription_status: SubStatus;
  is_active: boolean;
  trial_ends_at?: string | null;
  created_at: string;
}

export interface SubscriptionPlan {
  id: string;
  name: string;
  max_shops: number | null;
  max_users: number | null;
  max_products: number | null;
  max_jobs_per_month: number | null;
  features: Record<string, boolean>;
  price_monthly_inr: string;
}

export interface TenantDetail {
  id: string;
  name: string;
  slug: string;
  status: string;
  plan: string;
  owner_email: string;
  owner_phone: string;
  created_at: string;
  updated_at: string;
  db_status: DbStatus;
  subscription: {
    id: string;
    plan: SubscriptionPlan;
    status: SubStatus;
    current_period_start: string;
    current_period_end: string;
  } | null;
}

export const platformApi = {
  listTenants: (filters: { search?: string; db_status?: DbStatus; cursor?: string } = {}) =>
    apiGet<{ items: Tenant[]; meta: PageMeta }>(
      '/platform/tenants/',
      filters as Record<string, string | undefined>,
    ),

  getTenant: (id: string) =>
    apiGet<TenantDetail>(`/platform/tenants/${id}/`),

  suspendTenant: (id: string) =>
    apiPost<Tenant>(`/platform/tenants/${id}/suspend/`, {}),

  listPlans: () =>
    apiGet<{ items: SubscriptionPlan[] }>('/platform/plans/'),

  createPlan: (body: Omit<SubscriptionPlan, 'id'>) =>
    apiPost<SubscriptionPlan>('/platform/plans/', body),
};

export const DB_STATUS_LABELS: Record<DbStatus, string> = {
  provisioning: 'Provisioning',
  active:       'Active',
  suspended:    'Suspended',
  deleted:      'Deleted',
};

export const DB_STATUS_COLORS: Record<DbStatus, string> = {
  provisioning: 'text-[var(--warning)]',
  active:       'text-[var(--success)]',
  suspended:    'text-[var(--danger)]',
  deleted:      'text-[var(--text-muted)]',
};

export const SUB_STATUS_LABELS: Record<SubStatus, string> = {
  active:    'Active',
  trialing:  'Trial',
  past_due:  'Past due',
  cancelled: 'Cancelled',
  paused:    'Paused',
};
