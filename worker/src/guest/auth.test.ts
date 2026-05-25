import { describe, expect, it, vi } from 'vitest';

function mockEnv(adminEmails = 'admin@bgc.in') {
  return {
    SUPABASE_URL: 'x', SUPABASE_SERVICE_KEY: 'x',
    UPI_ID: 'x', APPS_SCRIPT_URL: '', APPS_SCRIPT_SECRET: '', BGC_SITE_URL: '',
    CF_ACCESS_TEAM_DOMAIN: 'x', CF_ACCESS_AUD: 'x', ADMIN_EMAILS: adminEmails, ENVIRONMENT: 'production',
  } as any;
}

vi.mock('../supabase', () => ({ getSupabase: vi.fn() }));
import { getSupabase } from '../supabase';
import { resolveRole } from './auth';

// guestRows: rows in event_guest_admins for the queried email.
// activeEvents: rows returned by the events query (already filtered by the mock to satisfy in/eq/gte).
function mockSupabase(guestRows: { event_id: string }[], activeEvents: { id: string }[]) {
  return {
    from: (table: string) => {
      if (table === 'event_guest_admins') {
        return { select: () => ({ eq: async () => ({ data: guestRows, error: null }) }) };
      }
      if (table === 'events') {
        return {
          select: () => ({
            in: () => ({
              eq: () => ({ gte: async () => ({ data: activeEvents, error: null }) }),
            }),
          }),
        };
      }
      return null;
    },
  };
}

describe('resolveRole', () => {
  it('returns admin for an allowlisted email without touching the DB', async () => {
    (getSupabase as any).mockReturnValue(mockSupabase([], []));
    const ctx = await resolveRole('admin@bgc.in', mockEnv());
    expect(ctx).toEqual({ email: 'admin@bgc.in', role: 'admin' });
  });

  it('returns guest with active event ids', async () => {
    (getSupabase as any).mockReturnValue(mockSupabase([{ event_id: 'e1' }, { event_id: 'e2' }], [{ id: 'e1' }]));
    const ctx = await resolveRole('guest@partner.in', mockEnv());
    expect(ctx).toEqual({ email: 'guest@partner.in', role: 'guest', eventIds: ['e1'] });
  });

  it('returns none when the email has no guest rows', async () => {
    (getSupabase as any).mockReturnValue(mockSupabase([], []));
    const ctx = await resolveRole('stranger@x.com', mockEnv());
    expect(ctx).toEqual({ email: 'stranger@x.com', role: 'none' });
  });

  it('returns none when guest rows exist but no event is active (expired / not collaboration)', async () => {
    (getSupabase as any).mockReturnValue(mockSupabase([{ event_id: 'eOld' }], []));
    const ctx = await resolveRole('guest@partner.in', mockEnv());
    expect(ctx).toEqual({ email: 'guest@partner.in', role: 'none' });
  });
});
