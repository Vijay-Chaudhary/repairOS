import { beforeEach, describe, expect, it } from 'vitest';

import { useActiveShopStore, type Shop } from '../activeShopStore';
import { useAuthStore } from '../authStore';

const shopA: Shop = { id: 'shop-a', name: 'Shop A' };
const shopB: Shop = { id: 'shop-b', name: 'Shop B' };

describe('activeShopStore', () => {
  beforeEach(() => {
    localStorage.clear();
    useActiveShopStore.setState({ activeShopId: null, isAllShops: false, shops: [] });
  });

  describe('setShops', () => {
    it('selects the first shop when nothing is active yet', () => {
      useActiveShopStore.getState().setShops([shopA, shopB]);
      expect(useActiveShopStore.getState().activeShopId).toBe('shop-a');
      expect(useActiveShopStore.getState().isAllShops).toBe(false);
    });

    it('keeps a persisted activeShopId that still exists in the fresh list', () => {
      useActiveShopStore.setState({ activeShopId: 'shop-b' });
      useActiveShopStore.getState().setShops([shopA, shopB]);
      expect(useActiveShopStore.getState().activeShopId).toBe('shop-b');
    });

    it('falls back to the first shop when the persisted id is stale', () => {
      useActiveShopStore.setState({ activeShopId: 'deleted-tenant-shop' });
      useActiveShopStore.getState().setShops([shopA, shopB]);
      expect(useActiveShopStore.getState().activeShopId).toBe('shop-a');
    });

    it('clears a stale id when the fresh list is empty', () => {
      useActiveShopStore.setState({ activeShopId: 'deleted-tenant-shop' });
      useActiveShopStore.getState().setShops([]);
      expect(useActiveShopStore.getState().activeShopId).toBeNull();
    });

    it('leaves the all-shops view untouched', () => {
      useActiveShopStore.getState().setAllShops();
      useActiveShopStore.getState().setShops([shopA, shopB]);
      expect(useActiveShopStore.getState().isAllShops).toBe(true);
      expect(useActiveShopStore.getState().activeShopId).toBeNull();
    });
  });

  describe('reset', () => {
    it('clears the selection and shop list', () => {
      useActiveShopStore.getState().setShops([shopA]);
      useActiveShopStore.getState().reset();
      const state = useActiveShopStore.getState();
      expect(state.activeShopId).toBeNull();
      expect(state.isAllShops).toBe(false);
      expect(state.shops).toEqual([]);
    });
  });

  describe('authStore.logout integration', () => {
    it('resets the active shop selection on logout', () => {
      useActiveShopStore.getState().setShops([shopA, shopB]);
      useActiveShopStore.getState().setActiveShop('shop-b');

      useAuthStore.getState().logout();

      const state = useActiveShopStore.getState();
      expect(state.activeShopId).toBeNull();
      expect(state.shops).toEqual([]);
    });
  });
});
