import { create } from 'zustand';

export interface PlatformAdminUser {
  id: string;
  email: string;
  full_name: string;
}

interface PlatformAuthState {
  accessToken: string | null;
  admin: PlatformAdminUser | null;
  isBootstrapping: boolean;

  setAccessToken: (token: string) => void;
  setAdmin: (admin: PlatformAdminUser) => void;
  logout: () => void;
  setBootstrapping: (v: boolean) => void;
}

export const usePlatformAuthStore = create<PlatformAuthState>((set) => ({
  accessToken: null,
  admin: null,
  isBootstrapping: true,

  setAccessToken: (token) => set({ accessToken: token }),
  setAdmin: (admin) => set({ admin }),
  logout: () => set({ accessToken: null, admin: null }),
  setBootstrapping: (v) => set({ isBootstrapping: v }),
}));
