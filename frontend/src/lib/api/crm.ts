import { apiGet, apiPost, apiPatch, apiDelete, type PageMeta } from './client';

// ── Types ────────────────────────────────────────────────────────────────────

export type LeadStatus = 'new' | 'contacted' | 'interested' | 'quoted' | 'converted' | 'lost';
export type LeadSource = 'walk_in' | 'whatsapp' | 'referral' | 'google' | 'facebook' | 'other';
export type CommType = 'call' | 'whatsapp' | 'visit' | 'email' | 'sms' | 'note';
export type CommDirection = 'inbound' | 'outbound';
export type TaskStatus = 'pending' | 'completed' | 'cancelled' | 'overdue';
export type TaskPriority = 'low' | 'normal' | 'high';
export type CustomerType = 'individual' | 'business';

export interface Lead {
  id: string;
  shop_id: string;
  name: string;
  phone: string;
  email?: string | null;
  source: LeadSource;
  status: LeadStatus;
  lost_reason?: string | null;
  status_before_lost?: string | null;
  device_type?: string | null;
  notes?: string | null;
  assigned_to?: string | null;
  assigned_to_name?: string | null;
  converted_customer_id?: string | null;
  converted_at?: string | null;
  created_at: string;
}

export interface Customer {
  id: string;
  shop_id: string;
  name: string;
  phone: string;
  alternate_phone?: string | null;
  email?: string | null;
  address?: string | null;
  city?: string | null;
  gstin?: string | null;
  customer_type: CustomerType;
  credit_limit: number;
  tags: string[];
  total_jobs: number;
  total_billed: number;
  total_outstanding: number;
  last_visit?: string | null;
  whatsapp_optout: boolean;
  source_lead_id?: string | null;
  created_at: string;
}

export interface CommunicationLog {
  id: string;
  customer_id?: string | null;
  lead_id?: string | null;
  type: CommType;
  direction?: CommDirection | null;
  summary: string;
  duration_minutes?: number | null;
  logged_by: string;
  logged_by_name?: string;
  logged_at: string;
}

export interface Task {
  id: string;
  customer_id?: string | null;
  customer_name?: string | null;
  lead_id?: string | null;
  job_id?: string | null;
  title: string;
  description?: string | null;
  due_date: string;
  due_time?: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  assigned_to: string;
  assigned_to_name?: string | null;
  completed_at?: string | null;
  completed_by?: string | null;
}

export interface QuoteItem {
  description: string;
  amount: string;
}

export interface LeadQuote {
  id: string;
  quote_number: string;
  items: QuoteItem[];
  total_amount: string;
  valid_until: string;
  notes: string;
  sent_via_whatsapp: boolean;
  sent_by: string;
  sent_by_name?: string;
  created_at: string;
}

export interface Segment {
  id: string;
  name: string;
  description?: string | null;
  filter_rules: Record<string, unknown>;
  is_dynamic: boolean;
  member_count?: number | null;
}

export interface SegmentMember {
  customer_id: string;
  customer_name: string;
  customer_phone: string;
  added_at: string;
}

export interface CrmOverview {
  kpis: {
    new_leads: number;
    tasks_due_today: number;
    tasks_overdue: number;
    conversions_30d: number;
    new_customers_30d: number;
  };
  pipeline: Array<{ status: LeadStatus; count: number }>;
  overdue_tasks: Array<{
    id: string;
    title: string;
    due_date: string;
    assigned_to_name: string | null;
    customer_name: string | null;
  }>;
  unassigned_leads: Array<{
    id: string;
    name: string;
    phone: string;
    source: LeadSource;
    created_at: string;
  }>;
}

// ── Filters ──────────────────────────────────────────────────────────────────

export interface LeadFilters {
  shop_id?: string;
  status?: LeadStatus;
  assigned_to?: string;
  source?: LeadSource;
  search?: string;
  date_from?: string;
  date_to?: string;
  page?: number;
}

export interface CustomerFilters {
  shop_id?: string;
  customer_type?: CustomerType;
  search?: string;
  tag?: string;
  page?: number;
}

export interface TaskFilters {
  status?: TaskStatus;
  priority?: TaskPriority;
  assigned_to?: string;
  customer_id?: string;
  lead_id?: string;
  due_date?: string;
  due_from?: string;
  due_to?: string;
  page?: number;
  page_size?: number;
}

// ── API ───────────────────────────────────────────────────────────────────────

export const crmApi = {
  getOverview: (shopId?: string) =>
    apiGet<CrmOverview>('/crm/overview/', shopId ? { shop_id: shopId } : {}),

  // Leads
  listLeads: (filters: LeadFilters = {}) =>
    apiGet<{ items: Lead[]; meta: PageMeta }>('/crm/leads/', filters as Record<string, string | undefined>),

  getLead: (id: string) =>
    apiGet<Lead>(`/crm/leads/${id}/`),

  createLead: (body: {
    shop_id: string;
    name: string;
    phone: string;
    email?: string;
    source: LeadSource;
    device_type?: string;
    notes?: string;
    assigned_to?: string;
  }) => apiPost<Lead>('/crm/leads/', body),

  updateLead: (id: string, body: Partial<{
    name: string;
    phone: string;
    email: string;
    source: LeadSource;
    status: LeadStatus;
    lost_reason: string;
    device_type: string;
    notes: string;
    assigned_to: string;
  }>) => apiPatch<Lead>(`/crm/leads/${id}/`, body),

  deleteLead: (id: string) =>
    apiDelete<void>(`/crm/leads/${id}/`),

  convertLead: (id: string) =>
    apiPost<Customer>(`/crm/leads/${id}/convert/`, {}),

  // Customers
  listCustomers: (filters: CustomerFilters = {}) =>
    apiGet<{ items: Customer[]; meta: PageMeta }>('/crm/customers/', filters as Record<string, string | undefined>),

  getCustomer: (id: string) =>
    apiGet<Customer>(`/crm/customers/${id}/`),

  createCustomer: (body: {
    shop_id: string;
    name: string;
    phone: string;
    alternate_phone?: string;
    email?: string;
    address?: string;
    city?: string;
    gstin?: string;
    customer_type?: CustomerType;
    credit_limit?: number;
    tags?: string[];
  }) => apiPost<Customer>('/crm/customers/', body),

  updateCustomer: (id: string, body: Partial<{
    name: string;
    phone: string;
    alternate_phone: string;
    email: string;
    address: string;
    city: string;
    gstin: string;
    customer_type: CustomerType;
    credit_limit: number;
    tags: string[];
    whatsapp_optout: boolean;
  }>) => apiPatch<Customer>(`/crm/customers/${id}/`, body),

  mergeCustomers: (body: { source_id: string; target_id: string }) =>
    apiPost<Customer>('/crm/customers/merge/', body),

  getCustomerTimeline: (id: string, type?: CommType, cursor?: string) =>
    apiGet<{ items: Array<{ id: string; type: string; summary: string; description: string; logged_by_name?: string; actor?: string; created_at: string }>; meta: PageMeta }>(
      `/crm/customers/${id}/timeline/`,
      { ...(type ? { type } : {}), ...(cursor ? { cursor } : {}) },
    ),

  // Communications
  logCommunication: (body: {
    customer_id?: string;
    lead_id?: string;
    type: CommType;
    direction?: CommDirection;
    summary: string;
    duration_minutes?: number;
    logged_at?: string;
  }) => apiPost<CommunicationLog>('/crm/communications/', body),

  // Tasks
  listTasks: (filters: TaskFilters = {}) =>
    apiGet<{ items: Task[]; meta: PageMeta }>('/crm/tasks/', filters as Record<string, string | undefined>),

  createTask: (body: {
    title: string;
    description?: string;
    due_date: string;
    due_time?: string;
    priority?: TaskPriority;
    assigned_to: string;
    customer_id?: string;
    lead_id?: string;
    job_id?: string;
  }) => apiPost<Task>('/crm/tasks/', body),

  updateTask: (id: string, body: Partial<{
    title: string;
    description: string;
    due_date: string;
    due_time: string;
    status: TaskStatus;
    priority: TaskPriority;
    assigned_to: string;
  }>) => apiPatch<Task>(`/crm/tasks/${id}/`, body),

  completeTask: (id: string) =>
    apiPost<Task>(`/crm/tasks/${id}/complete/`, {}),

  getTask: (id: string) =>
    apiGet<Task>(`/crm/tasks/${id}/`),

  // Communications
  listCommunications: (filters: { customer_id?: string; lead_id?: string; cursor?: string } = {}) =>
    apiGet<{ items: CommunicationLog[]; meta: PageMeta }>('/crm/communications/', filters as Record<string, string | undefined>),

  // Segments
  listSegments: () =>
    apiGet<{ items: Segment[] }>('/crm/segments/'),

  createSegment: (body: {
    name: string;
    description?: string;
    filter_rules: Record<string, unknown>;
    is_dynamic?: boolean;
  }) => apiPost<Segment>('/crm/segments/', body),

  updateSegment: (id: string, body: Partial<{
    name: string;
    description: string;
    filter_rules: Record<string, unknown>;
    is_dynamic: boolean;
  }>) => apiPatch<Segment>(`/crm/segments/${id}/`, body),

  getSegmentMembers: (id: string, cursor?: string) =>
    apiGet<{ items: SegmentMember[]; meta: PageMeta }>(
      `/crm/segments/${id}/members/`,
      cursor ? { cursor } : {},
    ),

  getSegment: (id: string) =>
    apiGet<Segment>(`/crm/segments/${id}/`),

  bulkWhatsapp: (id: string, body: { template_name: string; variables?: Record<string, string> }) =>
    apiPost<{ queued: number; excluded_optout: number }>(`/crm/segments/${id}/bulk-whatsapp/`, body),

  getSegmentRecipientCount: (id: string) =>
    apiGet<{ total: number; recipients: number; excluded_optout: number }>(
      `/crm/segments/${id}/recipient-count/`,
    ),

  // Lead status
  changeLeadStatus: (id: string, toStatus: LeadStatus, reason?: string) =>
    apiPost<Lead>(`/crm/leads/${id}/status/`, { to_status: toStatus, ...(reason ? { reason } : {}) }),

  // Lead quotes
  sendQuote: (id: string, body: { items: QuoteItem[]; valid_until: string; notes?: string }) =>
    apiPost<LeadQuote>(`/crm/leads/${id}/quote/`, body),

  listLeadQuotes: (id: string) =>
    apiGet<LeadQuote[]>(`/crm/leads/${id}/quotes/`),
};

// ── Constants ─────────────────────────────────────────────────────────────────

export const LEAD_PIPELINE_COLS: Array<{ status: LeadStatus; label: string }> = [
  { status: 'new',        label: 'New' },
  { status: 'contacted',  label: 'Contacted' },
  { status: 'interested', label: 'Interested' },
  { status: 'quoted',     label: 'Quoted' },
  { status: 'converted',  label: 'Converted' },
  { status: 'lost',       label: 'Lost' },
];

export const LEAD_TRANSITIONS: Record<LeadStatus, Array<{ to: LeadStatus; label: string; requiresReason?: boolean; requiresQuote?: boolean }>> = {
  new:       [{ to: 'contacted', label: 'Mark contacted' }, { to: 'lost', label: 'Mark lost', requiresReason: true }],
  contacted: [{ to: 'interested', label: 'Mark interested' }, { to: 'lost', label: 'Mark lost', requiresReason: true }],
  interested:[{ to: 'quoted', label: 'Send quote', requiresQuote: true }, { to: 'lost', label: 'Mark lost', requiresReason: true }],
  quoted:    [{ to: 'converted', label: 'Convert' }, { to: 'lost', label: 'Mark lost', requiresReason: true }],
  converted: [],
  lost:      [],  // re-open target is dynamic (lead.status_before_lost); handled in UI
};

export const SOURCE_LABELS: Record<LeadSource, string> = {
  walk_in: 'Walk-in', whatsapp: 'WhatsApp', referral: 'Referral',
  google: 'Google', facebook: 'Facebook', other: 'Other',
};

export const COMM_TYPE_LABELS: Record<CommType, string> = {
  call: 'Call', whatsapp: 'WhatsApp', visit: 'Visit',
  email: 'Email', sms: 'SMS', note: 'Note',
};

export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = {
  low: 'Low', normal: 'Normal', high: 'High',
};
