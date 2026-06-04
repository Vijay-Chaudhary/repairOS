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
        const { activeShopId } = get();
        if (!activeShopId && shops.length > 0) {
          set({ activeShopId: shops[0].id, isAllShops: false });
        }
      },

      getActiveShop: () => {
        const { shops, activeShopId } = get();
        return shops.find((s) => s.id === activeShopId) ?? null;
      },
    }),
    {
      name: 'repairos-active-shop',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ activeShopId: state.activeShopId, isAllShops: state.isAllShops }),
    }
  )
);
