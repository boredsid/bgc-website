import { describe, it, expect, vi, beforeEach } from 'vitest';

function mockEnv() {
  return {
    SUPABASE_URL: 'x', SUPABASE_SERVICE_KEY: 'x',
    UPI_ID: 'x', APPS_SCRIPT_URL: '', APPS_SCRIPT_SECRET: '', BGC_SITE_URL: '',
    CF_ACCESS_TEAM_DOMAIN: 'x', CF_ACCESS_AUD: 'x', ADMIN_EMAILS: '', ENVIRONMENT: 'production',
  } as any;
}

vi.mock('../supabase', () => ({ getSupabase: vi.fn() }));
vi.mock('../email', () => ({ sendEventRegistrationEmail: vi.fn(async () => undefined) }));

const getApplicablePromo = vi.fn(async () => null);
const consumePromoUses = vi.fn(async () => true);
vi.mock('../promos', () => ({
  getApplicablePromo: (...args: unknown[]) => getApplicablePromo(...(args as [])),
  consumePromoUses: (...args: unknown[]) => consumePromoUses(...(args as [])),
  restorePromoUses: vi.fn(async () => undefined),
}));

const fetchReplayPassStatus = vi.fn(async () => ({ has_pass: true, edition_name: 'REPLAY 3' }));
vi.mock('../replay-client', () => ({
  fetchReplayPassStatus: (...args: unknown[]) => fetchReplayPassStatus(...(args as [])),
}));

import { getSupabase } from '../supabase';
import { handleManualRegister } from './register-manual';

const ctx = { waitUntil: () => {} } as any;

interface MockOptions {
  event?: Record<string, unknown>;
  /** Whether the looked-up user carries the community host flag. */
  isHost?: boolean;
  /** Active paid membership rows for this user. */
  memberships?: Array<Record<string, unknown>>;
  /** Credit ledger rows for this user. */
  credits?: Array<{ amount: number }>;
}

const captured: { insert?: any; creditInsert?: any } = {};

function buildMock(opts: MockOptions = {}) {
  const event = {
    id: 'E1', name: 'Host Night', date: '2099-01-01', end_date: null, is_all_day: false,
    price: 500, capacity: 10, venue_name: 'Dice District', custom_questions: null,
    replay_pass_free: false, externally_managed: false, ...opts.event,
  };

  return {
    from: (table: string) => {
      if (table === 'events') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: event, error: null }) }) }) };
      }
      if (table === 'users') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { id: 'U1', name: 'Riya', email: 'riya@x.com', is_community_host: opts.isHost ?? true },
                error: null,
              }),
            }),
          }),
          update: () => ({ eq: async () => ({ error: null }) }),
        };
      }
      if (table === 'guild_path_members') {
        return {
          select: () => ({ eq: () => ({ eq: () => ({ gte: () => ({
            order: async () => ({ data: opts.memberships ?? [], error: null }),
          }) }) }) }),
          update: () => ({ eq: async () => ({ error: null }) }),
        };
      }
      if (table === 'user_credits') {
        return {
          select: () => ({ eq: async () => ({ data: opts.credits ?? [], error: null }) }),
          insert: async (row: any) => { captured.creditInsert = row; return { error: null }; },
        };
      }
      if (table === 'registrations') {
        return {
          select: () => ({ eq: () => ({ neq: async () => ({ data: [], error: null }) }) }),
          insert: (row: any) => {
            captured.insert = row;
            return { select: () => ({ single: async () => ({ data: { id: 'REG1' }, error: null }) }) };
          },
        };
      }
      if (table === 'leads') {
        const chain: any = { eq: () => chain, is: () => chain, then: (r: any) => r({ error: null }) };
        return { update: () => chain };
      }
      throw new Error('unexpected table ' + table);
    },
  };
}

function hostRequest(body: Record<string, unknown> = {}) {
  return new Request('https://api.test/api/admin/registrations/manual', {
    method: 'POST',
    body: JSON.stringify({
      event_id: 'E1',
      name: 'Riya',
      phone: '9876543210',
      email: 'riya@x.com',
      seats: 1,
      payment_status: 'confirmed',
      is_community_host: true,
      ...body,
    }),
  });
}

describe('handleManualRegister — community host seats', () => {
  beforeEach(() => {
    captured.insert = undefined;
    captured.creditInsert = undefined;
    getApplicablePromo.mockClear();
    fetchReplayPassStatus.mockClear();
  });

  it('creates a free confirmed registration with no payment details', async () => {
    (getSupabase as any).mockReturnValue(buildMock());

    const res = await handleManualRegister(hostRequest(), mockEnv(), ctx, 'admin@bgc.in');

    expect(res.status).toBe(200);
    expect(captured.insert).toMatchObject({
      event_id: 'E1',
      user_id: 'U1',
      total_amount: 0,
      discount_applied: 'community_host',
      is_community_host: true,
      payment_status: 'confirmed',
      source: 'community_host',
    });
    // A ₹0 registration never touches Finance, so these stay empty.
    expect(captured.insert.payment_account_id).toBeNull();
    expect(captured.insert.paid_at).toBeNull();
    expect(captured.insert.payment_method).toBeNull();
  });

  it('consumes event capacity like any other seat', async () => {
    (getSupabase as any).mockReturnValue(buildMock());

    await handleManualRegister(hostRequest({ seats: 3 }), mockEnv(), ctx, 'admin@bgc.in');

    expect(captured.insert.seats).toBe(3);
    expect(captured.insert.total_amount).toBe(0);
  });

  it('refuses someone who is not on the community host list', async () => {
    (getSupabase as any).mockReturnValue(buildMock({ isHost: false }));

    const res = await handleManualRegister(hostRequest(), mockEnv(), ctx, 'admin@bgc.in');
    const body = await res.json<any>();

    expect(res.status).toBe(400);
    expect(body.code).toBe('not_a_community_host');
    expect(captured.insert).toBeUndefined();
  });

  it('requires the event’s required custom questions to be answered', async () => {
    (getSupabase as any).mockReturnValue(buildMock({
      event: {
        custom_questions: [
          { id: 'game', label: 'Which game are you running?', type: 'text', required: true },
          { id: 'notes', label: 'Anything else?', type: 'text', required: false },
        ],
      },
    }));

    const res = await handleManualRegister(hostRequest(), mockEnv(), ctx, 'admin@bgc.in');
    const body = await res.json<any>();

    expect(res.status).toBe(400);
    expect(body.code).toBe('custom_answers_required');
    expect(body.missing).toEqual(['Which game are you running?']);
    expect(captured.insert).toBeUndefined();
  });

  it('goes through once the required questions are answered', async () => {
    (getSupabase as any).mockReturnValue(buildMock({
      event: {
        custom_questions: [{ id: 'game', label: 'Which game are you running?', type: 'text', required: true }],
      },
    }));

    const res = await handleManualRegister(
      hostRequest({ custom_answers: { game: 'Blood on the Clocktower' } }),
      mockEnv(), ctx, 'admin@bgc.in',
    );

    expect(res.status).toBe(200);
    expect(captured.insert.custom_answers).toEqual({ game: 'Blood on the Clocktower' });
  });

  it('ignores option pricing so a priced answer cannot make a host seat cost money', async () => {
    (getSupabase as any).mockReturnValue(buildMock({
      event: {
        custom_questions: [{
          id: 'table', label: 'Table', type: 'radio', required: true,
          options: [{ value: 'Premium', price: 1200 }],
        }],
      },
    }));

    const res = await handleManualRegister(
      hostRequest({ custom_answers: { table: 'Premium' } }),
      mockEnv(), ctx, 'admin@bgc.in',
    );

    expect(res.status).toBe(200);
    expect(captured.insert.total_amount).toBe(0);
  });

  it('banks the host’s Guild Path plus-ones instead of spending them', async () => {
    (getSupabase as any).mockReturnValue(buildMock({
      memberships: [{ id: 'M1', tier: 'adventurer', expires_at: '2099-12-31', plus_ones_used: 0 }],
    }));

    await handleManualRegister(hostRequest({ seats: 2 }), mockEnv(), ctx, 'admin@bgc.in');

    expect(captured.insert.plus_ones_consumed).toBe(0);
    expect(captured.insert.discount_applied).toBe('community_host');
  });

  it('leaves credits, promos, and the REPLAY pass untouched', async () => {
    (getSupabase as any).mockReturnValue(buildMock({
      credits: [{ amount: 800 }],
      event: { replay_pass_free: true },
    }));

    await handleManualRegister(hostRequest(), mockEnv(), ctx, 'admin@bgc.in');

    expect(captured.insert.credits_applied).toBe(0);
    expect(captured.creditInsert).toBeUndefined();
    expect(captured.insert.promo_id).toBeNull();
    expect(getApplicablePromo).not.toHaveBeenCalled();
    // No cross-worker call either: the seat is already free.
    expect(fetchReplayPassStatus).not.toHaveBeenCalled();
  });

  it('still refuses to overbook without an explicit confirmation', async () => {
    const mock = buildMock({ event: { capacity: 2 } });
    const original = mock.from;
    mock.from = (table: string) => {
      if (table === 'registrations') {
        return {
          select: () => ({ eq: () => ({ neq: async () => ({ data: [{ seats: 2 }], error: null }) }) }),
          insert: (row: any) => {
            captured.insert = row;
            return { select: () => ({ single: async () => ({ data: { id: 'REG1' }, error: null }) }) };
          },
        };
      }
      return original(table);
    };
    (getSupabase as any).mockReturnValue(mock);

    const res = await handleManualRegister(hostRequest(), mockEnv(), ctx, 'admin@bgc.in');
    const body = await res.json<any>();

    expect(res.status).toBe(409);
    expect(body.capacity_exceeded).toBe(true);
    expect(captured.insert).toBeUndefined();
  });
});
