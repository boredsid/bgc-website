import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('./supabase', () => ({ getSupabase: vi.fn() }));
vi.mock('./event-clash', () => ({
  findEventClash: vi.fn(async () => null),
  clashMessage: vi.fn(() => ''),
}));

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
  // Numbers whose pass has already been spent on this event by another booking.
  claimedPhones?: string[];
}

const inserted: { row: any } = { row: null };
// Every claim the Worker managed to stake in the current test, in order.
const claims: { staked: { phone: string; is_purchaser: boolean }[]; attachedTo: string | null } = {
  staked: [], attachedTo: null,
};

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
      if (table === 'replay_pass_claims') {
        return {
          // The unique index on (event_id, phone) is the real arbiter, so the
          // mock enforces it: a number already claimed comes back as an error.
          insert: (row: any) => ({
            select: () => ({
              single: async () => {
                const taken = new Set([...(opts.claimedPhones || []), ...claims.staked.map((c) => c.phone)]);
                if (taken.has(row.phone)) return { data: null, error: { code: '23505' } };
                claims.staked.push({ phone: row.phone, is_purchaser: row.is_purchaser });
                return { data: { id: `C${claims.staked.length}` }, error: null };
              },
            }),
          }),
          update: () => ({ in: async (_col: string, ids: string[]) => { claims.attachedTo = ids.join(','); return { error: null }; } }),
          delete: () => ({ in: async () => ({ error: null }), eq: async () => ({ error: null }) }),
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

function register(seats = 1, companionPhones?: string[]) {
  return handleRegister(
    new Request('https://api.boardgamecompany.in/api/register', {
      method: 'POST',
      body: JSON.stringify({
        event_id: 'E1', name: 'Ana', phone: '9876543210', email: 'a@b.com',
        seats, custom_answers: {}, payment_status: 'pending',
        companion_phones: companionPhones,
      }),
    }),
    mockEnv(),
    { waitUntil: () => {} } as any,
  );
}

function setup(opts: Options) {
  inserted.row = null;
  claims.staked = [];
  claims.attachedTo = null;
  (getSupabase as any).mockReturnValue(buildSupabase(opts));
}

/** Every number this test's REPLAY stub should treat as holding a pass. */
function passHolders(...phones: string[]) {
  (fetchReplayPassStatus as any).mockImplementation(async (_env: any, phone: string) => ({
    has_pass: phones.includes(phone),
    edition_slug: 'replay-3',
    edition_name: 'REPLAY 3',
    pass_type: 'campaign',
    days: ['day1'],
  }));
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

  it('covers only the holder’s seat when no companion numbers are given', async () => {
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

  it('covers a companion’s seat when their number holds a pass too', async () => {
    passHolders('9876543210', '9000000001');
    setup({ replayPassFree: true });
    await register(3, ['9000000001']);
    // Purchaser and companion both free; the third seat pays.
    expect(inserted.row).toMatchObject({ total_amount: 500, discount_applied: 'replay_pass' });
  });

  it('covers a companion even when the purchaser holds no pass', async () => {
    passHolders('9000000001');
    setup({ replayPassFree: true });
    await register(2, ['9000000001']);
    expect(inserted.row).toMatchObject({ total_amount: 500, discount_applied: 'replay_pass' });
  });

  it('charges for companions whose numbers hold no pass', async () => {
    passHolders('9876543210');
    setup({ replayPassFree: true });
    await register(3, ['9000000001', '9000000002']);
    expect(inserted.row).toMatchObject({ total_amount: 1000, discount_applied: 'replay_pass' });
  });

  it('ignores a companion number whose pass is already spent on this event', async () => {
    passHolders('9876543210', '9000000001');
    setup({ replayPassFree: true, claimedPhones: ['9000000001'] });
    await register(2, ['9000000001']);
    expect(inserted.row).toMatchObject({ total_amount: 500, discount_applied: 'replay_pass' });
  });

  it('counts a repeated companion number once', async () => {
    passHolders('9000000001');
    setup({ replayPassFree: true });
    await register(3, ['9000000001', '9000000001', '900-000-0001']);
    // One pass, one free seat, however many times it is typed in.
    expect(inserted.row).toMatchObject({ total_amount: 1000 });
    expect(claims.staked).toEqual([{ phone: '9000000001', is_purchaser: false }]);
  });

  it('ignores the purchaser’s own number pasted in as a companion', async () => {
    passHolders('9876543210');
    setup({ replayPassFree: true });
    await register(2, ['9876543210']);
    expect(inserted.row).toMatchObject({ total_amount: 500 });
    expect(claims.staked).toEqual([{ phone: '9876543210', is_purchaser: true }]);
  });

  it('ignores companion numbers beyond the seats actually booked', async () => {
    passHolders('9000000001', '9000000002');
    setup({ replayPassFree: true });
    await register(2, ['9000000001', '9000000002']);
    // Two seats: the purchaser holds no pass, so only one companion fits.
    expect(claims.staked).toEqual([{ phone: '9000000001', is_purchaser: false }]);
    expect(inserted.row).toMatchObject({ total_amount: 500 });
  });

  it('never claims more passes than there are seats left to pay for', async () => {
    passHolders('9876543210', '9000000001');
    setup({
      replayPassFree: true,
      member: { id: 'M1', tier: 'guildmaster', expires_at: '2030-01-01', plus_ones_used: 0 },
    });
    await register(2, ['9000000001']);
    // Guildmaster covers both seats, so neither pass is spent — they stay
    // available for another event booking.
    expect(inserted.row).toMatchObject({ total_amount: 0, discount_applied: 'guildmaster' });
    expect(claims.staked).toEqual([]);
  });

  it('attaches the claims it won to the registration', async () => {
    passHolders('9876543210', '9000000001');
    setup({ replayPassFree: true });
    await register(2, ['9000000001']);
    expect(claims.staked).toEqual([
      { phone: '9876543210', is_purchaser: true },
      { phone: '9000000001', is_purchaser: false },
    ]);
    expect(claims.attachedTo).toBe('C1,C2');
  });

  it('does not ask REPLAY about companions on an event without the perk', async () => {
    setup({ replayPassFree: false });
    await register(2, ['9000000001']);
    expect(fetchReplayPassStatus).not.toHaveBeenCalled();
    expect(inserted.row).toMatchObject({ total_amount: 1000, discount_applied: null });
  });
});
