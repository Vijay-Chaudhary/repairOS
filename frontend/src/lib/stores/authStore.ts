import { create } from 'zustand';
import { useActiveShopStore } from './activeShopStore';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  phone: string;
  avatar_url?: string | null;
  permissions: string[];
  shop_ids: string[];
  is_platform_admin: boolean;
  role_ids: string[];
}

interface AuthState {
  accessToken: string | null;
  user: AuthUser | null;
  isBootstrapping: boolean;

  setAccessToken: (token: string) => void;
  setUser: (user: AuthUser) => void;
  logout: () => void;
  setBootstrapping: (v: boolean) => void;
  hasPermission: (code: string) => boolean;
  hasAnyPermission: (codes: string[]) => boolean;
  hasShopAccess: (shopId: string) => boolean;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  accessToken: null,
  user: null,
  isBootstrapping: true,

  setAccessToken: (token) => set({ accessToken: token }),

  setUser: (user) => set({ user }),

  logout: () => {
    set({ accessToken: null, user: null });
    // Clear the persisted shop selection too — it's keyed globally in
    // localStorage, so a stale id can otherwise leak into the next
    // tenant/account that logs in on this origin.
    useActiveShopStore.getState().reset();
  },

  setBootstrapping: (v) => set({ isBootstrapping: v }),

  hasPermission: (code) => {
    const { user } = get();
    if (!user) return false;
    if (user.is_platform_admin) return true;
    return user.permissions.includes(code);
  },

  hasAnyPermission: (codes) => {
    const { user } = get();
    if (!user) return false;
    if (user.is_platform_admin) return true;
    return codes.some((code) => user.permissions.includes(code));
  },

  hasShopAccess: (shopId) => {
    const { user } = get();
    if (!user) return false;
    if (user.is_platform_admin) return true;
    return user.shop_ids.includes(shopId);
  },
}));
