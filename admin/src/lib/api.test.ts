import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchAdmin, ApiError } from './api';

describe('fetchAdmin', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  it('returns parsed JSON on 2xx', async () => {
    (globalThis.fetch as any).mockResolvedValue(
      new Response(JSON.stringify({ ok: true, value: 42 }), { status: 200 }),
    );
    const data = await fetchAdmin<{ value: number }>('/api/admin/x');
    expect(data.value).toBe(42);
  });

  it('throws ApiError with server message on 4xx', async () => {
    (globalThis.fetch as any).mockResolvedValue(
      new Response(JSON.stringify({ error: 'Invalid input' }), { status: 400 }),
    );
    await expect(fetchAdmin('/api/admin/x')).rejects.toMatchObject({
      status: 400,
      message: 'Invalid input',
    });
  });

  it('throws ApiError on 5xx', async () => {
    (globalThis.fetch as any).mockResolvedValue(
      new Response('boom', { status: 500 }),
    );
    await expect(fetchAdmin('/api/admin/x')).rejects.toMatchObject({ status: 500 });
  });

  it('triggers reload on 401', async () => {
    const reload = vi.fn();
    vi.stubGlobal('location', { reload, origin: 'http://localhost' });
    (globalThis.fetch as any).mockResolvedValue(new Response('', { status: 401 }));
    await expect(fetchAdmin('/api/admin/x')).rejects.toBeInstanceOf(ApiError);
    expect(reload).toHaveBeenCalled();
  });

  it('refuses non-GET requests when offline', async () => {
    let onlineValue = false;
    const desc = Object.getOwnPropertyDescriptor(Navigator.prototype, 'onLine')
      ?? Object.getOwnPropertyDescriptor(navigator, 'onLine');
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      get: () => onlineValue,
    });
    try {
      await expect(
        fetchAdmin('/api/admin/x', { method: 'POST', body: '{}' }),
      ).rejects.toMatchObject({ status: 0, message: "You're offline. Connect to save." });
    } finally {
      if (desc) {
        Object.defineProperty(navigator, 'onLine', desc);
      } else {
        Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
      }
    }
  });
});
