import { describe, it, expect, vi } from 'vitest';
import { platformAuthApi } from '@/lib/api/platformAuth';
import * as platformClientModule from '@/lib/api/platformClient';

vi.mock('@/lib/api/platformClient', () => ({
  platformApiFetch: vi.fn().mockResolvedValue({
    access: 'token',
    admin: { id: '1', email: 'a@a.com', full_name: 'A' },
  }),
  platformApiPost: vi.fn().mockResolvedValue(undefined),
}));

describe('platformAuthApi', () => {
  it('login posts credentials to /platform/auth/login/ without auth', async () => {
    await platformAuthApi.login({ email: 'a@a.com', password: 'pw' });
    expect(platformClientModule.platformApiFetch).toHaveBeenCalledWith(
      '/platform/auth/login/',
      expect.objectContaining({ method: 'POST', skipAuth: true }),
    );
  });

  it('me fetches /platform/auth/me/', async () => {
    await platformAuthApi.me();
    expect(platformClientModule.platformApiFetch).toHaveBeenCalledWith('/platform/auth/me/');
  });

  it('logout posts to /platform/auth/logout/', async () => {
    await platformAuthApi.logout();
    expect(platformClientModule.platformApiPost).toHaveBeenCalledWith('/platform/auth/logout/', {});
  });
});
