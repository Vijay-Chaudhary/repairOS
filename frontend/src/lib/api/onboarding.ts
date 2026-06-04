import { apiPost, apiPatch } from './client';

export interface OnboardingShop {
  id: string;
  name: string;
  code: string;
  city: string;
  state: string;
  gstin?: string | null;
  phone: string;
}

export const onboardingApi = {
  createShop: (body: {
    name: string;
    code: string;
    city: string;
    state: string;
    gstin?: string;
    phone: string;
  }) => apiPost<OnboardingShop>('/shops/', body),

  updateBranding: (body: {
    logo_url?: string;
    invoice_footer?: string;
    bank_account_number?: string;
    bank_ifsc?: string;
    bank_name?: string;
  }) => apiPatch<void>('/tenants/me/', body),

  inviteStaff: (body: { email: string; role_name: string }) =>
    apiPost<{ id: string }>('/users/invite/', body),

  connectWhatsApp: (body: { phone_number: string }) =>
    apiPost<{ status: string }>('/whatsapp/connect/', body),

  completeOnboarding: () =>
    apiPost<void>('/tenants/me/onboarding-complete/', {}),
};
