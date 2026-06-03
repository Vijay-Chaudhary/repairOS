export interface Customer {
  id: string;
  shop_id: string;
  name: string;
  phone: string;
  alternate_phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  gstin: string | null;
  customer_type: "individual" | "business";
  credit_limit: string;
  tags: string[];
  total_jobs: number;
  total_billed: string;
  total_outstanding: string;
  whatsapp_optout: boolean;
  source_lead: string | null;
  created_at: string;
  updated_at: string;
}

export interface CustomerCreate {
  shop_id: string;
  name: string;
  phone: string;
  alternate_phone?: string;
  email?: string;
  address?: string;
  city?: string;
  gstin?: string;
  customer_type?: "individual" | "business";
  credit_limit?: string;
  tags?: string[];
  whatsapp_optout?: boolean;
}

export interface Lead {
  id: string;
  shop_id: string;
  name: string;
  phone: string;
  email: string | null;
  source: string;
  status: "new" | "contacted" | "interested" | "quoted" | "converted" | "lost";
  lost_reason: string | null;
  device_type: string | null;
  notes: string | null;
  assigned_to: string | null;
  assigned_to_name: string | null;
  converted_customer_id: string | null;
  converted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CommunicationLog {
  id: string;
  customer: string | null;
  lead: string | null;
  type: "call" | "whatsapp" | "email" | "visit" | "sms";
  direction: "inbound" | "outbound";
  summary: string;
  duration_minutes: number | null;
  logged_by: string;
  logged_by_name: string;
  logged_at: string;
  created_at: string;
}

export interface PaginatedResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}
