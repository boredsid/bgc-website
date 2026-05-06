import { describe, expect, it, vi } from 'vitest';

function mockEnv() {
  return {
    SUPABASE_URL: 'x', SUPABASE_SERVICE_KEY: 'x',
    UPI_ID: 'x', APPS_SCRIPT_URL: '', APPS_SCRIPT_SECRET: '', BGC_SITE_URL: '',
    CF_ACCESS_TEAM_DOMAIN: 'x', CF_ACCESS_AUD: 'x', ADMIN_EMAILS: '', ENVIRONMENT: 'production',
  } as any;
}

vi.mock('./supabase', () => ({ getSupabase: vi.fn() }));

import { getSupabase } from './supabase';
import { handleCancelRegistration } from './cancel';

interface RegFixture {
  id: string;
  user_id: string | null;
  payment_status: 'pending' | 'confirmed' | 'cancelled';
  plus_ones_consumed: number;
  discount_applied: string | null;
  total_amount: number;
  credits_applied: number;
}

function buildSupabaseMock(reg: RegFixture, capture: { creditInsert: any }) {
  return {
    from: (table: string) => {
      if (table === 'registrations') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: reg, error: null }) }) }),
          update: () => ({ eq: async () => ({ error: null }) }),
        };
      }
      if (table === 'user_credits') {
        return {
          insert: async (row: any) => { capture.creditInsert = row; return { error: null }; },
        };
      }
      if (table === 'guild_path_members') {
        return {
          select: () => ({ eq: () => ({ eq: () => ({ order: () => ({ limit: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) }) }),
          update: () => ({ eq: async () => ({ error: null }) }),
        };
      }
      return null;
    },
  };
}

describe('handleCancelRegistration', () => {
  it('credits user with total_amount + credits_applied when cancelling a confirmed registration', async () => {
    const capture = { creditInsert: null as any };
    (getSupabase as any).mockReturnValue(buildSupabaseMock({
      id: 'r1', user_id: 'u1', payment_status: 'confirmed',
      plus_ones_consumed: 0, discount_applied: null,
      total_amount: 300, credits_applied: 500,
    }, capture));

    const req = new Request('http://localhost/api/admin/cancel-registration', {
      method: 'POST', body: JSON.stringify({ registration_id: 'r1' }),
    });
    const res = await handleCancelRegistration(req, mockEnv());
    expect(res.status).toBe(200);
    expect(capture.creditInsert).toMatchObject({
      user_id: 'u1', amount: 800, reason: 'cancellation', registration_id: 'r1',
    });
  });

  it('does not credit when cancelling a pending registration', async () => {
    const capture = { creditInsert: null as any };
    (getSupabase as any).mockReturnValue(buildSupabaseMock({
      id: 'r2', user_id: 'u1', payment_status: 'pending',
      plus_ones_consumed: 0, discount_applied: null,
      total_amount: 800, credits_applied: 0,
    }, capture));

    const req = new Request('http://localhost/api/admin/cancel-registration', {
      method: 'POST', body: JSON.stringify({ registration_id: 'r2' }),
    });
    const res = await handleCancelRegistration(req, mockEnv());
    expect(res.status).toBe(200);
    expect(capture.creditInsert).toBeNull();
  });

  it('is a no-op when already cancelled', async () => {
    const capture = { creditInsert: null as any };
    (getSupabase as any).mockReturnValue(buildSupabaseMock({
      id: 'r3', user_id: 'u1', payment_status: 'cancelled',
      plus_ones_consumed: 0, discount_applied: null,
      total_amount: 800, credits_applied: 0,
    }, capture));

    const req = new Request('http://localhost/api/admin/cancel-registration', {
      method: 'POST', body: JSON.stringify({ registration_id: 'r3' }),
    });
    const res = await handleCancelRegistration(req, mockEnv());
    const body = await res.json() as { success: boolean; already_cancelled?: boolean };
    expect(body.already_cancelled).toBe(true);
    expect(capture.creditInsert).toBeNull();
  });

  it('does not credit when user_id is null', async () => {
    const capture = { creditInsert: null as any };
    (getSupabase as any).mockReturnValue(buildSupabaseMock({
      id: 'r4', user_id: null, payment_status: 'confirmed',
      plus_ones_consumed: 0, discount_applied: null,
      total_amount: 300, credits_applied: 0,
    }, capture));

    const req = new Request('http://localhost/api/admin/cancel-registration', {
      method: 'POST', body: JSON.stringify({ registration_id: 'r4' }),
    });
    const res = await handleCancelRegistration(req, mockEnv());
    expect(res.status).toBe(200);
    expect(capture.creditInsert).toBeNull();
  });
});
