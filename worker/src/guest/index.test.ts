import { describe, expect, it, vi } from 'vitest';

function mockEnv() {
  return {
    SUPABASE_URL: 'x', SUPABASE_SERVICE_KEY: 'x',
    UPI_ID: 'x', APPS_SCRIPT_URL: '', APPS_SCRIPT_SECRET: '', BGC_SITE_URL: '',
    CF_ACCESS_TEAM_DOMAIN: 'x', CF_ACCESS_AUD: 'x', ADMIN_EMAILS: '', ENVIRONMENT: 'production',
  } as any;
}
const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as any;

// Mock every downstream handler so we test ONLY routing + scope enforcement.
vi.mock('../admin/registrations', () => ({
  handleListRegistrations: vi.fn(async (url: URL) => new Response(JSON.stringify({ event_id: url.searchParams.get('event_id') }), { status: 200 })),
  handleGetRegistration: vi.fn(async () => new Response('{}', { status: 200 })),
  handleUpdateRegistration: vi.fn(async () => new Response('{}', { status: 200 })),
}));
vi.mock('../admin/register-manual', () => ({ handleManualRegister: vi.fn(async () => new Response('{}', { status: 200 })) }));
vi.mock('../cancel', () => ({ handleCancelRegistration: vi.fn(async () => new Response('{}', { status: 200 })) }));
vi.mock('../admin/events', () => ({ handleGetEvent: vi.fn(async () => new Response('{}', { status: 200 })) }));
vi.mock('../admin/log', () => ({ handleLog: vi.fn(async () => new Response('{}', { status: 200 })) }));
vi.mock('../admin/leads', () => ({
  handleListLeads: vi.fn(async (_req: Request, _env: unknown, scope?: string[]) => new Response(JSON.stringify({ scope }), { status: 200 })),
  handleUpdateLead: vi.fn(async () => new Response('{}', { status: 200 })),
}));
vi.mock('./summary', () => ({ handleGuestSummary: vi.fn(async (_env: unknown, ids: string[]) => new Response(JSON.stringify({ ids }), { status: 200 })) }));
vi.mock('./lookup-phone', () => ({ handleGuestLookupPhone: vi.fn(async () => new Response('{}', { status: 200 })) }));
vi.mock('../supabase', () => ({ getSupabase: vi.fn() }));

import { getSupabase } from '../supabase';
import { handleGuestRequest } from './index';

const guest = { email: 'g@partner.in', eventIds: ['e1'] };

function mockRegLookup(eventId: string | null) {
  (getSupabase as any).mockReturnValue({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: eventId ? { event_id: eventId } : null, error: null }) }) }) }),
  });
}
function mockWhoamiEvents(events: { id: string; name: string; date: string }[]) {
  (getSupabase as any).mockReturnValue({
    from: () => ({ select: () => ({ in: async () => ({ data: events, error: null }) }) }),
  });
}
function r(method: string, path: string, body?: unknown) {
  return new Request(`http://localhost${path}`, { method, body: body ? JSON.stringify(body) : undefined });
}

describe('handleGuestRequest', () => {
  it('whoami returns role guest + scoped events', async () => {
    mockWhoamiEvents([{ id: 'e1', name: 'Collab', date: '2026-06-01T10:00:00Z' }]);
    const res = await handleGuestRequest(new URL('http://localhost/api/admin/whoami'), r('GET', '/api/admin/whoami'), mockEnv(), ctx, guest);
    const body = await res.json() as any;
    expect(body).toEqual({ email: 'g@partner.in', role: 'guest', events: [{ id: 'e1', name: 'Collab', date: '2026-06-01T10:00:00Z' }] });
  });

  it('registrations list with no event_id and one allowed event injects that event_id', async () => {
    const url = new URL('http://localhost/api/admin/registrations');
    const res = await handleGuestRequest(url, r('GET', '/api/admin/registrations'), mockEnv(), ctx, guest);
    const body = await res.json() as any;
    expect(body.event_id).toBe('e1');
  });

  it('registrations list with a foreign event_id is 403', async () => {
    const url = new URL('http://localhost/api/admin/registrations?event_id=other');
    const res = await handleGuestRequest(url, r('GET', '/api/admin/registrations?event_id=other'), mockEnv(), ctx, guest);
    expect(res.status).toBe(403);
  });

  it('GET registration belonging to a foreign event is 403', async () => {
    mockRegLookup('other');
    const url = new URL('http://localhost/api/admin/registrations/reg1');
    const res = await handleGuestRequest(url, r('GET', '/api/admin/registrations/reg1'), mockEnv(), ctx, guest);
    expect(res.status).toBe(403);
  });

  it('PATCH registration belonging to an allowed event passes through', async () => {
    mockRegLookup('e1');
    const url = new URL('http://localhost/api/admin/registrations/reg1');
    const res = await handleGuestRequest(url, r('PATCH', '/api/admin/registrations/reg1', { payment_status: 'confirmed' }), mockEnv(), ctx, guest);
    expect(res.status).toBe(200);
  });

  it('manual register with a foreign event_id is 403', async () => {
    const url = new URL('http://localhost/api/admin/registrations/manual');
    const res = await handleGuestRequest(url, r('POST', '/api/admin/registrations/manual', { event_id: 'other' }), mockEnv(), ctx, guest);
    expect(res.status).toBe(403);
  });

  it('cancel for a foreign registration is 403', async () => {
    mockRegLookup('other');
    const url = new URL('http://localhost/api/admin/cancel-registration');
    const res = await handleGuestRequest(url, r('POST', '/api/admin/cancel-registration', { registration_id: 'reg1' }), mockEnv(), ctx, guest);
    expect(res.status).toBe(403);
  });

  it('summary is scoped to the guest event ids', async () => {
    const url = new URL('http://localhost/api/admin/summary');
    const res = await handleGuestRequest(url, r('GET', '/api/admin/summary'), mockEnv(), ctx, guest);
    const body = await res.json() as any;
    expect(body.ids).toEqual(['e1']);
  });

  it('leads list passes the guest event scope through', async () => {
    const url = new URL('http://localhost/api/admin/leads');
    const res = await handleGuestRequest(url, r('GET', '/api/admin/leads'), mockEnv(), ctx, guest);
    const body = await res.json() as any;
    expect(body.scope).toEqual(['e1']);
  });

  it('leads list with a foreign event_id is 403', async () => {
    const url = new URL('http://localhost/api/admin/leads?event_id=other');
    const res = await handleGuestRequest(url, r('GET', '/api/admin/leads?event_id=other'), mockEnv(), ctx, guest);
    expect(res.status).toBe(403);
  });

  it('PATCH lead belonging to an allowed event passes through', async () => {
    mockRegLookup('e1');
    const url = new URL('http://localhost/api/admin/leads/lead1');
    const res = await handleGuestRequest(url, r('PATCH', '/api/admin/leads/lead1', { junk: true }), mockEnv(), ctx, guest);
    expect(res.status).toBe(200);
  });

  it('PATCH lead belonging to a foreign event is 403', async () => {
    mockRegLookup('other');
    const url = new URL('http://localhost/api/admin/leads/lead1');
    const res = await handleGuestRequest(url, r('PATCH', '/api/admin/leads/lead1', { junk: true }), mockEnv(), ctx, guest);
    expect(res.status).toBe(403);
  });

  it('leads export is not exposed to guests (403)', async () => {
    const url = new URL('http://localhost/api/admin/leads/export');
    const res = await handleGuestRequest(url, r('GET', '/api/admin/leads/export'), mockEnv(), ctx, guest);
    expect(res.status).toBe(403);
  });

  it('blocks an admin-only path with 403', async () => {
    const url = new URL('http://localhost/api/admin/users');
    const res = await handleGuestRequest(url, r('GET', '/api/admin/users'), mockEnv(), ctx, guest);
    expect(res.status).toBe(403);
  });
});
