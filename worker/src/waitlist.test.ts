// worker/src/waitlist.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

function mockEnv() {
  return {
    SUPABASE_URL: 'x', SUPABASE_SERVICE_KEY: 'x',
    UPI_ID: 'x', APPS_SCRIPT_URL: '', APPS_SCRIPT_SECRET: '', BGC_SITE_URL: '',
    CF_ACCESS_TEAM_DOMAIN: 'x', CF_ACCESS_AUD: 'x', ADMIN_EMAILS: '', ENVIRONMENT: 'production',
  } as any;
}

vi.mock('./supabase', () => ({ getSupabase: vi.fn() }));
vi.mock('./email', () => ({ sendWaitlistEmail: vi.fn(async () => undefined) }));

import { getSupabase } from './supabase';
import { handleWaitlist, _resetWaitlistRateLimit } from './waitlist';

const EVENT_ID = '11111111-1111-1111-1111-111111111111';
const ctx = { waitUntil: (p: Promise<unknown>) => p } as any;

interface MockOpts {
  capacity?: number;
  registeredSeats?: number;
  eventExists?: boolean;
  externallyManaged?: boolean;
  existingLead?: { converted_at: string | null; waitlist_at: string | null } | null;
  capture: { upsertArg: any; upsertOnConflict: string | null };
}

function buildSupabaseMock(opts: MockOpts) {
  const capacity = opts.capacity ?? 10;
  const regsData = opts.registeredSeats !== undefined ? [{ seats: opts.registeredSeats }] : [];
  const eventExists = opts.eventExists ?? true;
  const existingLead = opts.existingLead ?? null;
  const capture = opts.capture;
  return {
    from: (table: string) => {
      if (table === 'events') {
        return {
          select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({
            data: eventExists
              ? {
                  id: 'E1',
                  name: 'Catan Night',
                  date: '2026-06-01',
                  venue_name: 'V',
                  venue_area: null,
                  capacity,
                  externally_managed: opts.externallyManaged ?? false,
                  external_registration_url: opts.externallyManaged ? 'https://ttrpgcon.example/register' : null,
                }
              : null,
            error: null,
          }) }) }) }),
        };
      }
      if (table === 'registrations') {
        return { select: () => ({ eq: () => ({ neq: async () => ({ data: regsData, error: null }) }) }) };
      }
      if (table === 'leads') {
        return {
          select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: existingLead, error: null }) }) }) }),
          upsert: (arg: any, o: any) => {
            capture.upsertArg = arg;
            capture.upsertOnConflict = o?.onConflict ?? null;
            return { error: null };
          },
        };
      }
      throw new Error('unexpected table ' + table);
    },
  };
}

function makeReq(body: Record<string, unknown>) {
  return new Request('http://localhost/api/waitlist', { method: 'POST', body: JSON.stringify(body) });
}

const validBody = {
  event_id: EVENT_ID, name: 'Asha', phone: '9876543210', email: 'a@b.com', seats: 2,
};

beforeEach(() => {
  _resetWaitlistRateLimit();
});

describe('handleWaitlist', () => {
  it('rejects invalid phone with 400', async () => {
    const capture = { upsertArg: null as any, upsertOnConflict: null as any };
    (getSupabase as any).mockReturnValue(buildSupabaseMock({ capture }));
    const res = await handleWaitlist(makeReq({ ...validBody, phone: '123' }), mockEnv(), ctx);
    expect(res.status).toBe(400);
    expect(capture.upsertArg).toBeNull();
  });

  it('rejects invalid email with 400', async () => {
    const capture = { upsertArg: null as any, upsertOnConflict: null as any };
    (getSupabase as any).mockReturnValue(buildSupabaseMock({ capture }));
    const res = await handleWaitlist(makeReq({ ...validBody, email: 'nope' }), mockEnv(), ctx);
    expect(res.status).toBe(400);
    expect(capture.upsertArg).toBeNull();
  });

  it('rejects invalid seats with 400', async () => {
    const capture = { upsertArg: null as any, upsertOnConflict: null as any };
    (getSupabase as any).mockReturnValue(buildSupabaseMock({ capture }));
    const res = await handleWaitlist(makeReq({ ...validBody, seats: 0 }), mockEnv(), ctx);
    expect(res.status).toBe(400);
    expect(capture.upsertArg).toBeNull();
  });

  it('returns 404 when event missing', async () => {
    const capture = { upsertArg: null as any, upsertOnConflict: null as any };
    (getSupabase as any).mockReturnValue(buildSupabaseMock({ eventExists: false, capture }));
    const res = await handleWaitlist(makeReq(validBody), mockEnv(), ctx);
    expect(res.status).toBe(404);
    expect(capture.upsertArg).toBeNull();
  });

  it('rejects waitlisting for an externally managed event', async () => {
    const capture = { upsertArg: null as any, upsertOnConflict: null as any };
    (getSupabase as any).mockReturnValue(buildSupabaseMock({ externallyManaged: true, capture }));
    const res = await handleWaitlist(makeReq(validBody), mockEnv(), ctx);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      code: 'external_registration',
      external_registration_url: 'https://ttrpgcon.example/register',
    });
    expect(capture.upsertArg).toBeNull();
  });

  it('returns available:true when the event is not full (no write)', async () => {
    const capture = { upsertArg: null as any, upsertOnConflict: null as any };
    (getSupabase as any).mockReturnValue(buildSupabaseMock({ capacity: 10, registeredSeats: 5, capture }));
    const res = await handleWaitlist(makeReq(validBody), mockEnv(), ctx);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({ available: true });
    expect(capture.upsertArg).toBeNull();
  });

  it('upserts a waitlist row when full', async () => {
    const capture = { upsertArg: null as any, upsertOnConflict: null as any };
    (getSupabase as any).mockReturnValue(buildSupabaseMock({ capacity: 10, registeredSeats: 10, capture }));
    const res = await handleWaitlist(makeReq(validBody), mockEnv(), ctx);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({ success: true });
    expect(capture.upsertOnConflict).toBe('phone,event_id');
    expect(capture.upsertArg.phone).toBe('9876543210');
    expect(capture.upsertArg.name).toBe('Asha');
    expect(capture.upsertArg.email).toBe('a@b.com');
    expect(capture.upsertArg.seats).toBe(2);
    expect(capture.upsertArg.event_id).toBe(EVENT_ID);
    expect(capture.upsertArg.last_step).toBe('details_entered');
    expect(capture.upsertArg.waitlist_at).toBeTruthy();
  });

  it('preserves existing waitlist_at on re-submit (keeps FIFO position)', async () => {
    const capture = { upsertArg: null as any, upsertOnConflict: null as any };
    (getSupabase as any).mockReturnValue(buildSupabaseMock({
      capacity: 10, registeredSeats: 10,
      existingLead: { converted_at: null, waitlist_at: '2026-05-01T00:00:00.000Z' },
      capture,
    }));
    const res = await handleWaitlist(makeReq(validBody), mockEnv(), ctx);
    expect(res.status).toBe(200);
    expect(capture.upsertArg.waitlist_at).toBe('2026-05-01T00:00:00.000Z');
  });

  it('skips writes when the existing lead is already converted', async () => {
    const capture = { upsertArg: null as any, upsertOnConflict: null as any };
    (getSupabase as any).mockReturnValue(buildSupabaseMock({
      capacity: 10, registeredSeats: 10,
      existingLead: { converted_at: '2026-05-15T00:00:00Z', waitlist_at: null },
      capture,
    }));
    const res = await handleWaitlist(makeReq(validBody), mockEnv(), ctx);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({ success: true });
    expect(capture.upsertArg).toBeNull();
  });
});
