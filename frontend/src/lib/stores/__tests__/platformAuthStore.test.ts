import { describe, it, expect, beforeEach } from 'vitest';
import { usePlatformAuthStore } from '@/lib/stores/platformAuthStore';

describe('usePlatformAuthStore', () => {
  beforeEach(() => {
    usePlatformAuthStore.setState({ accessToken: null, admin: null, isBootstrapping: true });
  });

  it('starts with no admin and no token', () => {
    const state = usePlatformAuthStore.getState();
    expect(state.accessToken).toBeNull();
    expect(state.admin).toBeNull();
  });

  it('setAccessToken stores the token', () => {
    usePlatformAuthStore.getState().setAccessToken('abc123');
    expect(usePlatformAuthStore.getState().accessToken).toBe('abc123');
  });

  it('setAdmin stores the admin profile', () => {
    const admin = { id: '1', email: 'platform@repaiross.app', full_name: 'Platform Admin' };
    usePlatformAuthStore.getState().setAdmin(admin);
    expect(usePlatformAuthStore.getState().admin).toEqual(admin);
  });

  it('logout clears token and admin', () => {
    usePlatformAuthStore.getState().setAccessToken('abc123');
    usePlatformAuthStore.getState().setAdmin({ id: '1', email: 'x@x.com', full_name: 'X' });
    usePlatformAuthStore.getState().logout();
    const state = usePlatformAuthStore.getState();
    expect(state.accessToken).toBeNull();
    expect(state.admin).toBeNull();
  });

  it('setBootstrapping toggles the flag', () => {
    usePlatformAuthStore.getState().setBootstrapping(false);
    expect(usePlatformAuthStore.getState().isBootstrapping).toBe(false);
  });
});
