import { apiGet, type PageMeta } from './client';

export type AuditAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'login'
  | 'logout'
  | 'permission_denied';

export interface AuditLogEntry {
  id: string;
  user_id: string | null;
  user_name: string | null;
  action: AuditAction;
  model_name: string;
  object_id: string | null;
  old_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
  ip_address: string | null;
  user_agent: string;
  created_at: string;
}

export interface AuditFacets {
  actions: AuditAction[];
  model_names: string[];
  users: { id: string; full_name: string }[];
}

export type AuditFilters = {
  user_id?: string;
  action?: string;
  model_name?: string;
  date_from?: string;
  date_to?: string;
  page?: number;
};

export const auditApi = {
  list: (filters: AuditFilters = {}) =>
    apiGet<{ items: AuditLogEntry[]; meta: PageMeta }>('/audit/', filters),
  facets: () => apiGet<AuditFacets>('/audit/facets/'),
};
