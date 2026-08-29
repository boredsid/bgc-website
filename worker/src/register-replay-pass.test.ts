import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('./supabase', () => ({ getSupabase: vi.fn() }));
vi.mock('./email', () => ({ sendEventRegistrationEmail: vi.fn(async () => undefined) }));
vi.mock('./credits', () => ({
  applyCreditsToTotal: vi.fn(async (_s: any, _u: string, total: number) => ({ creditsApplied: 0, finalAmount: total })),
  recordCreditEvent: vi.fn(async () => undefined),
}));
vi.mock('./promos', () => ({
  getApplicablePromo: vi.fn(async () => null),
  consumePromoUses: vi.fn(async () => true),
  restorePromoUses: vi.fn(async () => undefined),
}));
vi.mock('./replay-client', () => ({ fetchReplayPassStatus: vi.fn() }));

import { getSupabase } from './supabase';
import { fetchReplayPassStatus } from './replay-client';
import { handleRegister } from './register';

function mockEnv() {
  return {
    SUPABASE_URL: 'x', SUPABASE_SERVICE_KEY: 'x', UPI_ID: 'x',
    APPS_SCRIPT_URL: '', APPS_SCRIPT_SECRET: '', BGC_SITE_URL: '',
    REPLAY_WORKER_URL: 'https://api.replaycon.in', REPLAY_TO_BGC_SECRET: 's',
    ENVIRONMENT: 'production',
  } as any;
}

interface Options {
  replayPassFree?: boolean;
  priorSeats?: number;
  member?: { id: string; tier: string; expires_at: string; plus_ones_used: number } | null;
}

const inserted: { row: any } = { row: null };

function buildSupabase(opts: Options) {
  const priorRegs = opts.priorSeats ? [{ seats: opts.priorSeats }] : [];
  // Both the capacity sweep (.eq().neq()) and the per-user sweep
  // (.eq().eq().neq()) land on the same terminal, which is faithful enough:
  // the user's own prior seats also count against capacity.
  const regChain: any = {
    eq: () => regChain,
    neq: async () => ({ data: priorRegs, error: null }),
  };

  return {
    from: (table: string) => {
      if (table === 'events') {
        return {
          select: () => ({ eq: () => ({ eq: () => ({ single: async () => ({ data: {
            id: 'E1', name: 'Test', date: '2026-06-01', venue_name: 'V', venue_area: null,
            price: 500, capacity: 20, custom_questions: [], price_includes: null,
            is_published: true, guild_path_exclusive: false,
            replay_pass_free: opts.replayPassFree ?? false,
          }, error: null }) }) }) }),
        };
      }
      if (table === 'registrations') {
        return {
          select: () => regChain,
          insert: (row: any) => {
            inserted.row = row;
            return { select: () => ({ single: async () => ({ data: { id: 'R1' }, error: null }) }) };
          },
        };
      }
      if (table === 'users') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'U1' }, error: null }) }) }),
          update: () => ({ eq: async () => ({ error: null }) }),
        };
      }
      if (table === 'guild_path_members') {
        return {
          select: () => ({ eq: () => ({ eq: () => ({ gte: () => ({
            order: async () => ({ data: opts.member ? [opts.member] : [], error: null }),
          }) }) }) }),
          update: () => ({ eq: async () => ({ error: null }) }),
        };
      }
      if (table === 'leads') {
        const chain: any = { eq: () => chain, is: () => chain, then: (r: any) => r({ error: null }) };
        return { update: () => chain };
      }
      return null;
    },
  };
}

function register(seats = 1) {
  return handleRegister(
    new Request('https://api.boardgamecompany.in/api/register', {
      method: 'POST',
      body: JSON.stringify({
        event_id: 'E1', name: 'Ana', phone: '9876543210', email: 'a@b.com',
        seats, custom_answers: {}, payment_status: 'pending',
      }),
    }),
    mockEnv(),
    { waitUntil: () => {} } as any,
  );
}

function setup(opts: Options) {
  inserted.row = null;
  (getSupabase as any).mockReturnValue(buildSupabase(opts));
}

beforeEach(() => {
  vi.clearAllMocks();
  (fetchReplayPassStatus as any).mockResolvedValue({
    has_pass: true, edition_slug: 'replay-3', edition_name: 'REPLAY 3', pass_type: 'campaign', days: ['day1'],
  });
});

describe('handleRegister with the REPLAY pass perk', () => {
  it('never asks REPLAY when the event does not offer the perk', async () => {
    setup({ replayPassFree: false });
    await register(1);
    expect(fetchReplayPassStatus).not.toHaveBeenCalled();
    expect(inserted.row).toMatchObject({ total_amount: 500, discount_applied: null });
  });

  it('makes the pass holder free and confirms the registration', async () => {
    setup({ replayPassFree: true });
    const res = await register(1);

    expect(fetchReplayPassStatus).toHaveBeenCalledWith(expect.anything(), '9876543210');
    expect(await res.json()).toMatchObject({ success: true });
    expect(inserted.row).toMatchObject({
      total_amount: 0,
      discount_applied: 'replay_pass',
      payment_status: 'confirmed',
    });
  });

  it('covers only the holder’s seat, leaving companions to pay', async () => {
    setup({ replayPassFree: true });
    await register(3);
    expect(inserted.row).toMatchObject({ total_amount: 1000, discount_applied: 'replay_pass' });
  });

  it('charges full price when the phone holds no pass', async () => {
    (fetchReplayPassStatus as any).mockResolvedValue({ has_pass: false, edition_name: 'REPLAY 3' });
    setup({ replayPassFree: true });
    await register(2);
    expect(inserted.row).toMatchObject({ total_amount: 1000, discount_applied: null });
  });

  it('does not hand out a second free seat to someone already registered', async () => {
    setup({ replayPassFree: true, priorSeats: 1 });
    await register(1);
    expect(inserted.row).toMatchObject({ total_amount: 500, discount_applied: null });
  });

  it('discounts an Initiate’s seat then covers what is left with the pass', async () => {
    setup({
      replayPassFree: true,
      member: { id: 'M1', tier: 'initiate', expires_at: '2030-01-01', plus_ones_used: 0 },
    });
    await register(1);
    // 20% off leaves ₹400 on the seat; the pass then covers it.
    expect(inserted.row).toMatchObject({ total_amount: 0, discount_applied: 'initiate' });
  });

  it('does not stack on an Adventurer whose own seat is already free', async () => {
    setup({
      replayPassFree: true,
      member: { id: 'M1', tier: 'adventurer', expires_at: '2030-01-01', plus_ones_used: 1 },
    });
    await register(2);
    // Self seat free, plus-ones spent, so the companion seat stays at ₹500.
    expect(inserted.row).toMatchObject({ total_amount: 500, discount_applied: 'adventurer' });
  });
});
