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
import { handleUpdateRegistration } from './registrations';

interface Prior {
  id: string;
  user_id: string | null;
  payment_status: 'pending' | 'confirmed' | 'cancelled';
  total_amount: number;
  credits_applied: number;
}

interface Capture {
  creditInsert: any;
  updatedRow: any;
}

function buildSupabaseMock(prior: Prior, balanceRows: { amount: number }[], capture: Capture) {
  return {
    from: (table: string) => {
      if (table === 'registrations') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: prior, error: null }),
            }),
          }),
          update: (row: any) => {
            capture.updatedRow = row;
            return {
              eq: () => ({
                select: () => ({
                  maybeSingle: async () => ({ data: { ...prior, ...row }, error: null }),
                }),
              }),
            };
          },
        };
      }
      if (table === 'user_credits') {
        return {
          select: () => ({ eq: async () => ({ data: balanceRows, error: null }) }),
          insert: async (row: any) => { capture.creditInsert = row; return { error: null }; },
        };
      }
      return null;
    },
  };
}

function patchReg(id: string, body: any) {
  return new Request(`http://localhost/api/admin/registrations/${id}`, {
    method: 'PATCH', body: JSON.stringify(body),
  });
}

describe('handleUpdateRegistration credit transitions', () => {
  it('confirmed → cancelled inserts +refund cancellation row', async () => {
    const cap: Capture = { creditInsert: null, updatedRow: null };
    (getSupabase as any).mockReturnValue(buildSupabaseMock(
      { id: 'r1', user_id: 'u1', payment_status: 'confirmed', total_amount: 300, credits_applied: 500 },
      [], cap,
    ));
    const res = await handleUpdateRegistration('r1', patchReg('r1', { payment_status: 'cancelled' }), mockEnv());
    expect(res.status).toBe(200);
    expect(cap.creditInsert).toMatchObject({
      user_id: 'u1', amount: 800, reason: 'cancellation', registration_id: 'r1',
    });
  });

  it('cancelled → confirmed with sufficient balance inserts -refund reversal row', async () => {
    const cap: Capture = { creditInsert: null, updatedRow: null };
    (getSupabase as any).mockReturnValue(buildSupabaseMock(
      { id: 'r2', user_id: 'u1', payment_status: 'cancelled', total_amount: 300, credits_applied: 500 },
      [{ amount: 800 }], cap,
    ));
    const res = await handleUpdateRegistration('r2', patchReg('r2', { payment_status: 'confirmed' }), mockEnv());
    expect(res.status).toBe(200);
    expect(cap.creditInsert).toMatchObject({
      user_id: 'u1', amount: -800, reason: 'cancellation_reversal', registration_id: 'r2',
    });
  });

  it('cancelled → confirmed with insufficient balance returns 400 and inserts no row', async () => {
    const cap: Capture = { creditInsert: null, updatedRow: null };
    (getSupabase as any).mockReturnValue(buildSupabaseMock(
      { id: 'r3', user_id: 'u1', payment_status: 'cancelled', total_amount: 300, credits_applied: 500 },
      [{ amount: 200 }], cap,
    ));
    const res = await handleUpdateRegistration('r3', patchReg('r3', { payment_status: 'confirmed' }), mockEnv());
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('already spent');
    expect(cap.creditInsert).toBeNull();
    expect(cap.updatedRow).toBeNull();
  });

  it('pending → cancelled inserts no credit row', async () => {
    const cap: Capture = { creditInsert: null, updatedRow: null };
    (getSupabase as any).mockReturnValue(buildSupabaseMock(
      { id: 'r4', user_id: 'u1', payment_status: 'pending', total_amount: 800, credits_applied: 0 },
      [], cap,
    ));
    const res = await handleUpdateRegistration('r4', patchReg('r4', { payment_status: 'cancelled' }), mockEnv());
    expect(res.status).toBe(200);
    expect(cap.creditInsert).toBeNull();
  });

  it('non-status update does not touch credits', async () => {
    const cap: Capture = { creditInsert: null, updatedRow: null };
    (getSupabase as any).mockReturnValue(buildSupabaseMock(
      { id: 'r5', user_id: 'u1', payment_status: 'confirmed', total_amount: 300, credits_applied: 500 },
      [], cap,
    ));
    const res = await handleUpdateRegistration('r5', patchReg('r5', { name: 'Renamed' }), mockEnv());
    expect(res.status).toBe(200);
    expect(cap.creditInsert).toBeNull();
  });
});
