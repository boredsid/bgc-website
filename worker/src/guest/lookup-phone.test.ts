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
import { handleGuestLookupPhone } from './lookup-phone';

function mockSupabase(user: { id: string; name: string; email: string } | null, seats: { seats: number }[]) {
  return {
    from: (table: string) => {
      if (table === 'users') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: user, error: null }) }) }) };
      }
      if (table === 'registrations') {
        return { select: () => ({ eq: () => ({ eq: () => ({ neq: async () => ({ data: seats, error: null }) }) }) }) };
      }
      return null;
    },
  };
}

function req(body: unknown) {
  return new Request('http://localhost/api/admin/lookup-phone', { method: 'POST', body: JSON.stringify(body) });
}

describe('handleGuestLookupPhone', () => {
  it('returns only name/email + seats, never membership/credit/promo', async () => {
    (getSupabase as any).mockReturnValue(mockSupabase({ id: 'u1', name: 'Asha', email: 'a@x.com' }, [{ seats: 2 }]));
    const res = await handleGuestLookupPhone(req({ phone: '9876543210', event_id: 'e1' }), mockEnv(), new Set(['e1']));
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toEqual({
      user: { found: true, name: 'Asha', email: 'a@x.com' },
      existing_seats_for_event: 2,
    });
    expect(body).not.toHaveProperty('membership');
    expect(body).not.toHaveProperty('credit_balance');
    expect(body).not.toHaveProperty('active_promo');
  });

  it('403s when event_id is outside the guest scope', async () => {
    (getSupabase as any).mockReturnValue(mockSupabase(null, []));
    const res = await handleGuestLookupPhone(req({ phone: '9876543210', event_id: 'other' }), mockEnv(), new Set(['e1']));
    expect(res.status).toBe(403);
  });

  it('400s on an invalid phone', async () => {
    (getSupabase as any).mockReturnValue(mockSupabase(null, []));
    const res = await handleGuestLookupPhone(req({ phone: 'abc' }), mockEnv(), new Set(['e1']));
    expect(res.status).toBe(400);
  });
});
