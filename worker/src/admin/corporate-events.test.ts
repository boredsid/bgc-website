// worker/src/admin/corporate-events.test.ts
import { describe, expect, it, vi } from 'vitest';

function mockEnv() {
  return {
    SUPABASE_URL: 'x', SUPABASE_SERVICE_KEY: 'x',
    UPI_ID: 'x', APPS_SCRIPT_URL: '', APPS_SCRIPT_SECRET: '', BGC_SITE_URL: '',
    CF_ACCESS_TEAM_DOMAIN: 'x', CF_ACCESS_AUD: 'x', ADMIN_EMAILS: '', ENVIRONMENT: 'production',
  } as any;
}

vi.mock('../supabase', () => ({ getSupabase: vi.fn() }));

import { getSupabase } from '../supabase';
import {
  handleListCorporateEvents,
  handleCreateCorporateEvent,
  handleUpdateCorporateEvent,
  handleDeleteCorporateEvent,
  handleUploadCorporateLogo,
} from './corporate-events';

function postJson(body: unknown): Request {
  return new Request('http://localhost/api/admin/corporate-events', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

function buildInsertMock(capture: { row?: any }, result: any = { id: 'CE1' }) {
  return {
    from: () => ({
      insert: (row: any) => {
        capture.row = row;
        return { select: () => ({ single: async () => ({ data: result, error: null }) }) };
      },
    }),
  };
}

describe('handleCreateCorporateEvent', () => {
  it('rejects a missing company name', async () => {
    const res = await handleCreateCorporateEvent(postJson({ event_date: '2026-08-01' }), mockEnv());
    expect(res.status).toBe(400);
  });

  it('rejects a malformed event date', async () => {
    const res = await handleCreateCorporateEvent(
      postJson({ company_name: 'Acme', event_date: '01/08/2026' }),
      mockEnv(),
    );
    expect(res.status).toBe(400);
  });

  it('rejects a non-integer headcount', async () => {
    const res = await handleCreateCorporateEvent(
      postJson({ company_name: 'Acme', event_date: '2026-08-01', headcount: 2.5 }),
      mockEnv(),
    );
    expect(res.status).toBe(400);
  });

  it('trims strings and nulls empty optionals on insert', async () => {
    const capture: { row?: any } = {};
    (getSupabase as any).mockReturnValue(buildInsertMock(capture));
    const res = await handleCreateCorporateEvent(
      postJson({ company_name: '  Acme Corp ', title: '  ', event_date: '2026-08-01', description: ' Offsite ' }),
      mockEnv(),
    );
    expect(res.status).toBe(200);
    expect(capture.row).toEqual({
      company_name: 'Acme Corp',
      title: null,
      event_date: '2026-08-01',
      description: 'Offsite',
    });
  });
});

describe('handleUpdateCorporateEvent', () => {
  function buildUpdateMock(capture: { row?: any }, result: any) {
    return {
      from: () => ({
        update: (row: any) => {
          capture.row = row;
          return {
            eq: () => ({ select: () => ({ maybeSingle: async () => ({ data: result, error: null }) }) }),
          };
        },
      }),
    };
  }

  it('404s when the row does not exist', async () => {
    (getSupabase as any).mockReturnValue(buildUpdateMock({}, null));
    const res = await handleUpdateCorporateEvent('missing', postJson({ company_name: 'Acme' }), mockEnv());
    expect(res.status).toBe(404);
  });

  it('rejects an empty update', async () => {
    const res = await handleUpdateCorporateEvent('CE1', postJson({}), mockEnv());
    expect(res.status).toBe(400);
  });

  it('applies partial updates and stamps updated_at', async () => {
    const capture: { row?: any } = {};
    (getSupabase as any).mockReturnValue(buildUpdateMock(capture, { id: 'CE1' }));
    const res = await handleUpdateCorporateEvent('CE1', postJson({ is_published: false }), mockEnv());
    expect(res.status).toBe(200);
    expect(capture.row.is_published).toBe(false);
    expect(typeof capture.row.updated_at).toBe('string');
  });
});

describe('handleListCorporateEvents / handleDeleteCorporateEvent', () => {
  it('lists rows newest event first', async () => {
    const order = vi.fn(async () => ({ data: [{ id: 'CE1' }], error: null }));
    (getSupabase as any).mockReturnValue({ from: () => ({ select: () => ({ order }) }) });
    const res = await handleListCorporateEvents(mockEnv());
    expect(res.status).toBe(200);
    expect(order).toHaveBeenCalledWith('event_date', { ascending: false });
    expect(await res.json()).toEqual({ corporate_events: [{ id: 'CE1' }] });
  });

  it('deletes by id', async () => {
    const eq = vi.fn(async () => ({ error: null }));
    (getSupabase as any).mockReturnValue({ from: () => ({ delete: () => ({ eq }) }) });
    const res = await handleDeleteCorporateEvent('CE1', mockEnv());
    expect(res.status).toBe(200);
    expect(eq).toHaveBeenCalledWith('id', 'CE1');
  });
});

describe('handleUploadCorporateLogo', () => {
  const PNG_B64 = btoa('fake-png-bytes');

  function buildStorageMock(capture: { path?: string; contentType?: string }) {
    return {
      storage: {
        from: () => ({
          upload: async (path: string, _bytes: Uint8Array, opts: { contentType: string }) => {
            capture.path = path;
            capture.contentType = opts.contentType;
            return { error: null };
          },
          getPublicUrl: (path: string) => ({ data: { publicUrl: `https://x.supabase.co/storage/v1/object/public/corporate-logos/${path}` } }),
        }),
      },
    };
  }

  it('rejects non-image content types', async () => {
    const res = await handleUploadCorporateLogo(
      postJson({ content_type: 'application/pdf', data_base64: PNG_B64 }),
      mockEnv(),
    );
    expect(res.status).toBe(400);
  });

  it('rejects invalid base64', async () => {
    const res = await handleUploadCorporateLogo(
      postJson({ content_type: 'image/png', data_base64: '!!not-base64!!' }),
      mockEnv(),
    );
    expect(res.status).toBe(400);
  });

  it('rejects images over 2 MB', async () => {
    const big = btoa('x'.repeat(2 * 1024 * 1024 + 1));
    const res = await handleUploadCorporateLogo(
      postJson({ content_type: 'image/png', data_base64: big }),
      mockEnv(),
    );
    expect(res.status).toBe(400);
  });

  it('uploads and returns the public URL', async () => {
    const capture: { path?: string; contentType?: string } = {};
    (getSupabase as any).mockReturnValue(buildStorageMock(capture));
    const res = await handleUploadCorporateLogo(
      postJson({ content_type: 'image/png', data_base64: PNG_B64 }),
      mockEnv(),
    );
    expect(res.status).toBe(200);
    expect(capture.contentType).toBe('image/png');
    expect(capture.path).toMatch(/\.png$/);
    const body = (await res.json()) as { url: string };
    expect(body.url).toContain(`corporate-logos/${capture.path}`);
  });
});
