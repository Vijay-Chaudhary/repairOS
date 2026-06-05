import { apiGet, apiPost, apiPatch, apiDelete, type PageMeta } from './client';

// ── Shop ────────────────────────────────────────────────────────────────────

export interface Shop {
  id: string;
  name: string;
  code: string;
  address: string;
  city: string;
  state: string;
  state_code: string;
  phone: string;
  email?: string | null;
  gstin?: string | null;
  is_active: boolean;
  working_hours?: Record<string, { open: string; close: string }> | null;
}

export interface TenantBranding {
  logo_url?: string | null;
  invoice_footer?: string | null;
  bank_name?: string | null;
  bank_account_number?: string | null;
  bank_ifsc?: string | null;
}

// ── Users ────────────────────────────────────────────────────────────────────

export interface TenantUser {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  is_active: boolean;
  avatar_url?: string | null;
  role_names: string[];
  last_login?: string | null;
  created_at: string;
}

// ── Roles ────────────────────────────────────────────────────────────────────

export interface Permission {
  id: string;
  codename: string;
  module: string;
  label: string;
  description?: string | null;
}

export interface Role {
  id: string;
  name: string;
  description?: string | null;
  is_system_role: boolean;
  permission_ids: string[];
  permission_codenames: string[];
  user_count?: number;
}

// ── Notification templates ───────────────────────────────────────────────────

export interface NotifTemplate {
  id: string;
  template_name: string;
  module: string;
  trigger: string;
  recipient: string;
  variables: string[];
  is_active: boolean;
  custom_body?: string | null;
}

export interface WhatsAppConnection {
  phone_number: string | null;
  is_connected: boolean;
  connected_at?: string | null;
}

// ── API client ───────────────────────────────────────────────────────────────

export const settingsApi = {
  // Shop
  listShops: () =>
    apiGet<Pick<Shop, 'id' | 'name' | 'code' | 'address' | 'city'>[]>('/shops/'),

  getShop: (id: string) =>
    apiGet<Shop>(`/shops/${id}/`),

  updateShop: (id: string, body: Partial<Pick<Shop, 'name' | 'address' | 'city' | 'state' | 'state_code' | 'phone' | 'email' | 'gstin' | 'working_hours'>>) =>
    apiPatch<Shop>(`/shops/${id}/`, body),

  getTenantBranding: () =>
    apiGet<TenantBranding>('/tenants/me/'),

  updateTenantBranding: (body: TenantBranding) =>
    apiPatch<TenantBranding>('/tenants/me/', body),

  // Users
  listUsers: (filters: { search?: string; is_active?: boolean; cursor?: string } = {}) =>
    apiGet<{ items: TenantUser[]; meta: PageMeta }>(
      '/users/',
      filters as Record<string, string | boolean | undefined>,
    ),

  inviteUser: (body: { email: string; full_name: string; phone: string; role_ids: string[] }) =>
    apiPost<TenantUser>('/users/', body),

  updateUser: (id: string, body: Partial<{ full_name: string; is_active: boolean; role_ids: string[] }>) =>
    apiPatch<TenantUser>(`/users/${id}/`, body),

  forceLogout: (id: string) =>
    apiPost<void>(`/users/${id}/force-logout/`, {}),

  // Roles
  listRoles: () =>
    apiGet<{ items: Role[] }>('/roles/'),

  listPermissions: () =>
    apiGet<{ items: Permission[] }>('/permissions/'),

  createRole: (body: { name: string; description?: string; permission_ids: string[] }) =>
    apiPost<Role>('/roles/', body),

  updateRole: (id: string, body: { name?: string; description?: string; permission_ids?: string[] }) =>
    apiPatch<Role>(`/roles/${id}/`, body),

  deleteRole: (id: string) =>
    apiDelete<void>(`/roles/${id}/`),

  // WhatsApp / notifications
  getWhatsAppConnection: () =>
    apiGet<WhatsAppConnection>('/whatsapp/connection/'),

  connectWhatsApp: (phone_number: string) =>
    apiPost<WhatsAppConnection>('/whatsapp/connect/', { phone_number }),

  disconnectWhatsApp: () =>
    apiPost<void>('/whatsapp/disconnect/', {}),

  listTemplates: () =>
    apiGet<{ items: NotifTemplate[] }>('/notifications/templates/'),

  updateTemplate: (id: string, body: { is_active?: boolean; custom_body?: string }) =>
    apiPatch<NotifTemplate>(`/notifications/templates/${id}/`, body),
};

export const PERMISSION_MODULE_LABELS: Record<string, string> = {
  crm:      'CRM',
  repair:   'Repair',
  pos:      'POS',
  erp:      'ERP / Inventory',
  amc:      'AMC',
  hr:       'HR & Payroll',
  billing:  'Billing',
  reports:  'Reports',
  settings: 'Settings',
};
