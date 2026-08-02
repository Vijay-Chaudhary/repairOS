import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiFetchBlob, ApiError } from '../client';

const accessToken = 'test-access-token';
vi.mock('@/lib/stores/authStore', () => ({
  useAuthStore: {
    getState: () => ({
      accessToken,
      setAccessToken: vi.fn(),
      logout: vi.fn(),
    }),
  },
}));

describe('apiFetchBlob', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the blob and sends the bearer token', async () => {
    const blob = new Blob(['%PDF-1.7'], { type: 'application/pdf' });
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'Content-Type': 'application/pdf' }),
      blob: async () => blob,
    } as unknown as Response);

    const result = await apiFetchBlob('/billing/repair-invoices/abc/pdf/');

    expect(result).toBe(blob);
    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect((init?.headers as Record<string, string>)['Authorization']).toBe(`Bearer ${accessToken}`);
  });

  it('throws ApiError carrying the server message when the server returns the JSON envelope', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 500,
      headers: new Headers({ 'Content-Type': 'application/json' }),
      json: async () => ({
        success: false,
        error: { code: 'PDF_RENDER_FAILED', message: 'Could not generate the PDF. Please try again.' },
      }),
    } as unknown as Response);

    await expect(apiFetchBlob('/billing/repair-invoices/abc/pdf/')).rejects.toMatchObject({
      code: 'PDF_RENDER_FAILED',
      message: 'Could not generate the PDF. Please try again.',
      status: 500,
    });
  });

  it('throws ApiError on a non-JSON failure', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 502,
      headers: new Headers({ 'Content-Type': 'text/html' }),
      json: async () => {
        throw new Error('not json');
      },
    } as unknown as Response);

    await expect(apiFetchBlob('/x/')).rejects.toBeInstanceOf(ApiError);
  });
});
