// worker/src/lead.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

function mockEnv() {
  return {
    SUPABASE_URL: 'x', SUPABASE_SERVICE_KEY: 'x',
    UPI_ID: 'x', APPS_SCRIPT_URL: '', APPS_SCRIPT_SECRET: '', BGC_SITE_URL: '',
    CF_ACCESS_TEAM_DOMAIN: 'x', CF_ACCESS_AUD: 'x', ADMIN_EMAILS: '', ENVIRONMENT: 'production',
  } as any;
}

vi.mock('./supabase', () => ({ getSupabase: vi.fn() }));

import { getSupabase } from './supabase';
import { handleLead, _resetLeadRateLimit } from './lead';

interface LeadRow {
  id: string;
  phone: string;
  name: string | null;
  event_id: string;
  last_step: string;
  converted_at: string | null;
  junk_at: string | null;
}

function buildSupabaseMock(initialRow: LeadRow | null, capture: { upsertArg: any; upsertOnConflict: string | null }) {
  let row = initialRow;
  return {
    from: (table: string) => {
      if (table !== 'leads') throw new Error('unexpected table ' + table);
      return {
        select: () => ({
          eq: (_c1: string, _v1: string) => ({
            eq: (_c2: string, _v2: string) => ({
              maybeSingle: async () => ({ data: row, error: null }),
            }),
          }),
        }),
        upsert: (arg: any, opts: any) => {
          capture.upsertArg = arg;
          capture.upsertOnConflict = opts?.onConflict ?? null;
          row = { ...(row || ({} as LeadRow)), ...arg, id: row?.id ?? 'new-id' };
          return { error: null };
        },
      };
    },
  };
}

beforeEach(() => {
  _resetLeadRateLimit();
});

describe('handleLead', () => {
  it('rejects invalid phone with 400', async () => {
    (getSupabase as any).mockReturnValue(buildSupabaseMock(null, { upsertArg: null, upsertOnConflict: null }));
    const req = new Request('http://localhost/api/lead', {
      method: 'POST',
      body: JSON.stringify({ phone: '123', event_id: 'e1', last_step: 'phone_entered' }),
    });
    const res = await handleLead(req, mockEnv());
    expect(res.status).toBe(400);
  });

  it('rejects missing event_id with 400', async () => {
    (getSupabase as any).mockReturnValue(buildSupabaseMock(null, { upsertArg: null, upsertOnConflict: null }));
    const req = new Request('http://localhost/api/lead', {
      method: 'POST',
      body: JSON.stringify({ phone: '9876543210', last_step: 'phone_entered' }),
    });
    const res = await handleLead(req, mockEnv());
    expect(res.status).toBe(400);
  });

  it('rejects bad last_step with 400', async () => {
    (getSupabase as any).mockReturnValue(buildSupabaseMock(null, { upsertArg: null, upsertOnConflict: null }));
    const req = new Request('http://localhost/api/lead', {
      method: 'POST',
      body: JSON.stringify({ phone: '9876543210', event_id: 'e1', last_step: 'bogus' }),
    });
    const res = await handleLead(req, mockEnv());
    expect(res.status).toBe(400);
  });

  it('upserts a new lead with onConflict on (phone,event_id)', async () => {
    const capture = { upsertArg: null as any, upsertOnConflict: null as any };
    (getSupabase as any).mockReturnValue(buildSupabaseMock(null, capture));
    const req = new Request('http://localhost/api/lead', {
      method: 'POST',
      body: JSON.stringify({
        phone: '9876543210',
        name: 'Asha',
        event_id: '11111111-1111-1111-1111-111111111111',
        last_step: 'name_entered',
        source: { utm_source: 'ig' },
        user_agent: 'jest',
      }),
    });
    const res = await handleLead(req, mockEnv());
    expect(res.status).toBe(200);
    expect(capture.upsertOnConflict).toBe('phone,event_id');
    expect(capture.upsertArg.phone).toBe('9876543210');
    expect(capture.upsertArg.name).toBe('Asha');
    expect(capture.upsertArg.event_id).toBe('11111111-1111-1111-1111-111111111111');
    expect(capture.upsertArg.last_step).toBe('name_entered');
    expect(capture.upsertArg.source).toEqual({ utm_source: 'ig' });
  });

  it('skips writes when existing row is converted', async () => {
    const capture = { upsertArg: null as any, upsertOnConflict: null as any };
    (getSupabase as any).mockReturnValue(buildSupabaseMock(
      {
        id: 'L1', phone: '9876543210', name: 'Asha',
        event_id: '11111111-1111-1111-1111-111111111111',
        last_step: 'details_entered',
        converted_at: '2026-05-15T00:00:00Z',
        junk_at: null,
      },
      capture,
    ));
    const req = new Request('http://localhost/api/lead', {
      method: 'POST',
      body: JSON.stringify({
        phone: '9876543210',
        event_id: '11111111-1111-1111-1111-111111111111',
        last_step: 'phone_entered',
      }),
    });
    const res = await handleLead(req, mockEnv());
    expect(res.status).toBe(200);
    expect(capture.upsertArg).toBeNull();
  });

  it('rate-limit: drops second call within 2s without writing', async () => {
    const capture = { upsertArg: null as any, upsertOnConflict: null as any };
    (getSupabase as any).mockReturnValue(buildSupabaseMock(null, capture));
    const body = JSON.stringify({
      phone: '9876543210',
      event_id: '11111111-1111-1111-1111-111111111111',
      last_step: 'phone_entered',
    });
    await handleLead(new Request('http://localhost/api/lead', { method: 'POST', body }), mockEnv());
    expect(capture.upsertArg).not.toBeNull();
    capture.upsertArg = null;
    const res2 = await handleLead(new Request('http://localhost/api/lead', { method: 'POST', body }), mockEnv());
    expect(res2.status).toBe(200);
    expect(capture.upsertArg).toBeNull();
  });
});
