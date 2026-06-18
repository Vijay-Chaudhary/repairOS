import { apiGet, apiPost, apiPatch, apiDelete, type PageMeta } from './client';

// ── Types ────────────────────────────────────────────────────────────────────

export type JobStatus =
  | 'draft' | 'open' | 'in_progress' | 'estimated' | 'estimate_sent'
  | 'estimate_approved' | 'estimate_rejected' | 'on_hold' | 'ready_for_qc'
  | 'qc_failed' | 'ready_for_pickup' | 'delivered' | 'closed' | 'cancelled';

export type JobPriority = 'normal' | 'urgent' | 'vip';
export type StageType = 'diagnosis' | 'repair' | 'parts_install' | 'testing' | 'qc' | 'packing';
export type StageStatus = 'pending' | 'in_progress' | 'completed' | 'skipped';
export type SparePartStatus = 'requested' | 'approved' | 'rejected' | 'ordered' | 'received';
export type EstimateStatus = 'draft' | 'sent' | 'approved' | 'rejected' | 'expired';
export type PhysicalCondition = 'excellent' | 'good' | 'fair' | 'damaged';

export interface JobListItem {
  id: string;
  job_number: string;
  customer_id: string;
  customer_name: string;
  customer_phone?: string;
  device_type: string;
  device_brand?: string | null;
  device_model?: string | null;
  status: JobStatus;
  priority: JobPriority;
  service_charge: number;
  advance_paid: number;
  intake_date: string;
  expected_delivery_date?: string | null;
  assigned_technician_name?: string | null;
  shop_id: string;
}

export interface JobCheckin {
  id: string;
  physical_condition: PhysicalCondition;
  has_scratches: boolean;
  has_cracks: boolean;
  has_liquid_damage: boolean;
  has_missing_parts: boolean;
  accessory_received: string[];
  customer_description?: string | null;
  technician_notes?: string | null;
  photos: string[];
  customer_signature_url?: string | null;
  acknowledged_at?: string | null;
}

export interface JobEstimate {
  id: string;
  job_id: string;
  estimate_number: string;
  labor_charge: number;
  parts_cost: number;
  total_estimate: number;
  valid_until?: string | null;
  notes?: string | null;
  status: EstimateStatus;
  sent_at?: string | null;
  customer_response_at?: string | null;
  customer_response_method?: string | null;
  approval_link?: string | null;
}

export interface JobStage {
  id: string;
  job_id: string;
  stage_order: number;
  stage_type: StageType;
  assigned_technician_id: string;
  assigned_technician_name?: string;
  status: StageStatus;
  started_at?: string | null;
  completed_at?: string | null;
  notes?: string | null;
}

export interface SparePartRequest {
  id: string;
  job_id: string;
  requested_by: string;
  requested_by_name?: string;
  variant_id?: string | null;
  variant_name?: string | null;
  custom_part_name?: string | null;
  quantity: number;
  is_urgent: boolean;
  status: SparePartStatus;
  reviewed_by?: string | null;
  po_id?: string | null;
  created_at: string;
}

export interface JobDetail extends JobListItem {
  serial_number?: string | null;
  imei?: string | null;
  problem_description: string;
  is_field_job: boolean;
  location_lat?: number | null;
  location_lng?: number | null;
  location_address?: string | null;
  notes?: string | null;
  warranty_of_job_id?: string | null;
  warranty_days?: number | null;
  warranty_expires_at?: string | null;
  template_id?: string | null;
  created_by: string;
  created_at: string;
  checkin?: JobCheckin | null;
  estimates: JobEstimate[];
  stages: JobStage[];
  spare_part_requests: SparePartRequest[];
}

export interface FaultTemplatePart {
  id: string;
  variant_id?: string | null;
  custom_part_name: string;
  quantity: number;
}

export interface FaultTemplate {
  id: string;
  shop_id: string;
  name: string;
  device_type: string;
  device_brand?: string | null;
  problem_description: string;
  default_sc: number;
  estimated_duration_hours?: number | null;
  is_active: boolean;
  parts: FaultTemplatePart[];
}

// ── API functions ─────────────────────────────────────────────────────────────

export interface RepairOverview {
  kpis: {
    open_jobs: number;
    overdue: number;
    awaiting_parts: number;
    ready_for_pickup: number;
  };
  by_status: Array<{ status: JobStatus; count: number }>;
  needs_attention: Array<{
    id: string;
    job_number: string;
    customer_name: string;
    device_type: string;
    status: JobStatus;
    expected_delivery_date: string | null;
    // DRF DecimalField serializes to a string (COERCE_DECIMAL_TO_STRING defaults True).
    service_charge: string;
    advance_paid: string;
  }>;
}

export interface JobFilters {
  shop_id?: string;
  status?: JobStatus;
  technician_id?: string;
  customer_id?: string;
  priority?: JobPriority;
  date_from?: string;
  date_to?: string;
  search?: string;
  page?: number;
}

export interface JobListResponse {
  items: JobListItem[];
  meta: PageMeta;
}

export const repairApi = {
  listJobs: (filters: JobFilters = {}) =>
    apiGet<JobListResponse>('/repair/jobs/', filters as Record<string, string | number | boolean | undefined>),

  getOverview: (shopId?: string) =>
    apiGet<RepairOverview>('/repair/overview/', shopId ? { shop_id: shopId } : {}),

  getJob: (id: string) =>
    apiGet<JobDetail>(`/repair/jobs/${id}/`),

  createJob: (body: {
    shop_id: string;
    customer_id: string;
    device_type: string;
    device_brand?: string;
    device_model?: string;
    serial_number?: string;
    imei?: string;
    problem_description: string;
    priority?: JobPriority;
    is_field_job?: boolean;
    location_lat?: number;
    location_lng?: number;
    location_address?: string;
    expected_delivery_date?: string;
    service_charge?: number;
    advance_paid?: number;
    notes?: string;
    template_id?: string;
  }) => apiPost<JobDetail>('/repair/jobs/', body),

  updateJob: (id: string, body: Partial<{
    device_type: string;
    device_brand: string;
    device_model: string;
    serial_number: string;
    imei: string;
    problem_description: string;
    priority: JobPriority;
    expected_delivery_date: string;
    service_charge: number;
    notes: string;
  }>) => apiPatch<JobDetail>(`/repair/jobs/${id}/`, body),

  submitCheckin: (jobId: string, body: {
    physical_condition: PhysicalCondition;
    has_scratches: boolean;
    has_cracks: boolean;
    has_liquid_damage: boolean;
    has_missing_parts: boolean;
    accessory_received: string[];
    customer_description?: string;
    technician_notes?: string;
    photos?: string[];
    customer_signature_url?: string | null;
  }) => apiPost<JobCheckin>(`/repair/jobs/${jobId}/checkin/`, body),

  changeStatus: (jobId: string, body: { to_status: JobStatus; reason?: string }) =>
    apiPost<JobDetail>(`/repair/jobs/${jobId}/status/`, body),

  setStages: (jobId: string, body: {
    stages?: Array<{ stage_order: number; stage_type: StageType; assigned_technician_id: string }>;
    stage_id?: string;
    action?: 'complete' | 'start' | 'skip';
    notes?: string;
  }) => apiPost<{ message: string } | JobStage>(`/repair/jobs/${jobId}/stages/`, body),

  createEstimate: (jobId: string, body: {
    labor_charge: number;
    parts_cost: number;
    valid_until?: string;
    notes?: string;
    send_via?: 'whatsapp' | 'email' | 'in_person';
  }) => apiPost<JobEstimate>(`/repair/jobs/${jobId}/estimate/`, body),

  respondEstimate: (jobId: string, body: { response: 'approved' | 'rejected'; method: string }) =>
    apiPost<JobDetail>(`/repair/jobs/${jobId}/estimate/respond/`, body),

  requestSparePart: (jobId: string, body: {
    variant_id?: string;
    custom_part_name?: string;
    quantity: number;
    is_urgent?: boolean;
  }) => apiPost<SparePartRequest>(`/repair/jobs/${jobId}/spare-parts/`, body),

  reviewSparePart: (partId: string, body: { status: SparePartStatus; po_id?: string }) =>
    apiPatch<SparePartRequest>(`/repair/spare-parts/${partId}/`, body),

  warrantyClaim: (jobId: string) =>
    apiPost<JobDetail>(`/repair/jobs/${jobId}/warranty-claim/`, {}),

  listTemplates: (shopId: string) =>
    apiGet<{ items: FaultTemplate[] }>('/repair/fault-templates/', { shop_id: shopId }),

  createTemplate: (body: {
    shop_id: string;
    name: string;
    device_type: string;
    device_brand?: string;
    problem_description: string;
    default_sc: number;
    estimated_duration_hours?: number;
    parts?: Array<{ custom_part_name: string; quantity: number }>;
  }) => apiPost<FaultTemplate>('/repair/fault-templates/', body),

  updateTemplate: (id: string, body: Partial<{
    name: string;
    device_type: string;
    device_brand: string;
    problem_description: string;
    default_sc: number;
    estimated_duration_hours: number;
    is_active: boolean;
    parts: Array<{ custom_part_name: string; quantity: number }>;
  }>) => apiPatch<FaultTemplate>(`/repair/fault-templates/${id}/`, body),

  deleteTemplate: (id: string) =>
    apiDelete(`/repair/fault-templates/${id}/`),

  getTimeline: (jobId: string, cursor?: string) =>
    apiGet<{ items: Array<{ id: string; type: string; actor?: string; description: string; created_at: string }>; meta: PageMeta }>(
      `/repair/jobs/${jobId}/timeline/`,
      cursor ? { cursor } : {},
    ),
};

// ── Status machine helpers ────────────────────────────────────────────────────

export const STATUS_TRANSITIONS: Record<JobStatus, Array<{ to: JobStatus; label: string; requiresReason?: boolean }>> = {
  draft:              [{ to: 'open', label: 'Open job' }],
  open:               [{ to: 'in_progress', label: 'Start work' }, { to: 'estimated', label: 'Create estimate' }, { to: 'cancelled', label: 'Cancel', requiresReason: true }],
  estimated:          [{ to: 'estimate_sent', label: 'Send estimate' }, { to: 'open', label: 'Revert to open' }],
  estimate_sent:      [{ to: 'estimate_approved', label: 'Mark approved' }, { to: 'estimate_rejected', label: 'Mark rejected' }, { to: 'in_progress', label: 'Start work' }],
  estimate_approved:  [{ to: 'in_progress', label: 'Start work' }],
  estimate_rejected:  [{ to: 'estimated', label: 'Revise estimate' }, { to: 'cancelled', label: 'Cancel', requiresReason: true }],
  in_progress:        [{ to: 'on_hold', label: 'Put on hold', requiresReason: true }, { to: 'ready_for_qc', label: 'Ready for QC' }, { to: 'ready_for_pickup', label: 'Ready for pickup' }, { to: 'cancelled', label: 'Cancel', requiresReason: true }],
  on_hold:            [{ to: 'in_progress', label: 'Resume' }, { to: 'cancelled', label: 'Cancel', requiresReason: true }],
  ready_for_qc:       [{ to: 'ready_for_pickup', label: 'QC passed' }, { to: 'qc_failed', label: 'QC failed' }],
  qc_failed:          [{ to: 'in_progress', label: 'Back to repair' }],
  ready_for_pickup:   [{ to: 'delivered', label: 'Mark delivered' }, { to: 'in_progress', label: 'Back to repair' }],
  delivered:          [{ to: 'closed', label: 'Close job' }],
  closed:             [],
  cancelled:          [{ to: 'open', label: 'Re-open' }],
};

export const KANBAN_COLUMNS: Array<{ status: JobStatus; label: string }> = [
  { status: 'open',            label: 'Open' },
  { status: 'in_progress',     label: 'In Progress' },
  { status: 'on_hold',         label: 'On Hold' },
  { status: 'ready_for_qc',    label: 'QC' },
  { status: 'ready_for_pickup',label: 'Ready for Pickup' },
  { status: 'delivered',       label: 'Delivered' },
];

export const PRIORITY_LABELS: Record<JobPriority, string> = {
  normal: 'Normal',
  urgent: 'Urgent',
  vip: 'VIP',
};

export const STAGE_LABELS: Record<StageType, string> = {
  diagnosis: 'Diagnosis',
  repair: 'Repair',
  parts_install: 'Parts Install',
  testing: 'Testing',
  qc: 'QC',
  packing: 'Packing',
};
