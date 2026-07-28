import { describe, expect, it, vi } from 'vitest';

vi.mock('../supabase', () => ({ getSupabase: vi.fn() }));

import { getSupabase } from '../supabase';
import { handleUpdateGuildMember } from './guild-members';

function mockEnv() {
  return {
    SUPABASE_URL: 'x',
    SUPABASE_SERVICE_KEY: 'x',
  } as any;
}

function patch(body: Record<string, unknown>) {
  return new Request('http://localhost/api/admin/guild-members/member-1', {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

function buildMock(prior: Record<string, unknown>, capture: { update: Record<string, unknown> | null }) {
  return {
    from: (table: string) => {
      if (table !== 'guild_path_members') return null;
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: prior, error: null }),
          }),
        }),
        update: (row: Record<string, unknown>) => {
          capture.update = row;
          return {
            eq: () => ({
              select: () => ({
                maybeSingle: async () => ({ data: { ...prior, ...row }, error: null }),
              }),
            }),
          };
        },
      };
    },
  };
}

describe('handleUpdateGuildMember payment transitions', () => {
  it('requires payment details when marking a positive membership paid', async () => {
    const capture = { update: null };
    (getSupabase as any).mockReturnValue(buildMock({
      id: 'member-1',
      status: 'pending',
      amount: 1000,
      payment_account_id: null,
      paid_at: null,
      payment_method: null,
    }, capture));

    const response = await handleUpdateGuildMember('member-1', patch({ status: 'paid' }), mockEnv());

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'payment_details_required' });
    expect(capture.update).toBeNull();
  });

  it('records the admin when a paid membership receives complete payment details', async () => {
    const capture = { update: null as Record<string, unknown> | null };
    (getSupabase as any).mockReturnValue(buildMock({
      id: 'member-1',
      status: 'pending',
      amount: 1000,
      payment_account_id: null,
      paid_at: null,
      payment_method: null,
    }, capture));

    const response = await handleUpdateGuildMember('member-1', patch({
      status: 'paid',
      payment_account_id: 'account-1',
      paid_at: '2026-07-28',
      payment_method: 'upi',
    }), mockEnv(), 'admin@boardgamecompany.in');

    expect(response.status).toBe(200);
    expect(capture.update).toMatchObject({
      status: 'paid',
      payment_account_id: 'account-1',
      payment_recorded_by: 'admin@boardgamecompany.in',
    });
  });

  it('allows non-payment edits on a legacy paid membership', async () => {
    const capture = { update: null as Record<string, unknown> | null };
    (getSupabase as any).mockReturnValue(buildMock({
      id: 'member-1',
      status: 'paid',
      amount: 1000,
      payment_account_id: null,
      paid_at: null,
      payment_method: null,
    }, capture));

    const response = await handleUpdateGuildMember(
      'member-1',
      patch({ plus_ones_used: 1 }),
      mockEnv(),
    );

    expect(response.status).toBe(200);
    expect(capture.update).toEqual({ plus_ones_used: 1 });
  });
});
