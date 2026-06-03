export interface TokenPayload {
  user_id: string;
  tenant_slug: string;
  shop_ids: string[];
  role_ids: string[];
  permissions: string[];
  is_platform_admin: boolean;
  exp: number;
}

export interface User {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  tenant_slug: string;
  shop_ids: string[];
  role_ids: string[];
  permissions: string[];
  is_platform_admin: boolean;
}

export interface AuthState {
  user: User | null;
  accessToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}

export interface SendOtpRequest {
  phone: string;
  tenant_slug: string;
}

export interface VerifyOtpRequest {
  phone: string;
  otp: string;
  tenant_slug: string;
}

export interface AuthResponse {
  access: string;
  user: User;
}
