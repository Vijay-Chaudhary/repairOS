import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export interface Shop {
  id: string;
  name: string;
  address?: string;
  logo_url?: string | null;
}

interface ActiveShopState {
  activeShopId: string | null;
  isAllShops: boolean;
  shops: Shop[];

  setActiveShop: (shopId: string | null) => void;
  setAllShops: () => void;
  setShops: (shops: Shop[]) => void;
  getActiveShop: () => Shop | null;
  reset: () => void;
}

export const useActiveShopStore = create<ActiveShopState>()(
  persist(
    (set, get) => ({
      activeShopId: null,
      isAllShops: false,
      shops: [],

      setActiveShop: (shopId: string | null) => set({ activeShopId: shopId, isAllShops: false }),

      setAllShops: () => set({ activeShopId: null, isAllShops: true }),

      setShops: (shops: Shop[]) => {
        set({ shops });
        const { activeShopId, isAllShops } = get();
        if (isAllShops) return;
        // activeShopId may be a stale id persisted from a previous tenant/account
        // on the same origin — if it no longer resolves in the fresh shop list,
        // fall back instead of sending an unresolvable id to the API.
        const stillExists = shops.some((s) => s.id === activeShopId);
        if (!stillExists) {
          set({ activeShopId: shops.length > 0 ? shops[0].id : null, isAllShops: false });
        }
      },

      getActiveShop: () => {
        const { shops, activeShopId } = get();
        return shops.find((s) => s.id === activeShopId) ?? null;
      },

      reset: () => set({ activeShopId: null, isAllShops: false, shops: [] }),
    }),
    {
      name: 'repairos-active-shop',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ activeShopId: state.activeShopId, isAllShops: state.isAllShops }),
    }
  )
);
