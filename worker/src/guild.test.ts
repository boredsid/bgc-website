import { describe, it, expect } from 'vitest';
import {
  NEVER_EXPIRES_DATE,
  COMMUNITY_HOST_SOURCE,
  pickBestMembership,
  grantCommunityHostMembership,
  revokeCommunityHostMembership,
} from './guild';

describe('pickBestMembership', () => {
  const hostRow = {
    id: 'host', tier: 'initiate', expires_at: NEVER_EXPIRES_DATE,
    plus_ones_used: 0, never_expires: true, source: COMMUNITY_HOST_SOURCE,
  };

  it('returns null when nothing is active', () => {
    expect(pickBestMembership([])).toBeNull();
    expect(pickBestMembership(null)).toBeNull();
    expect(pickBestMembership(undefined)).toBeNull();
  });

  it('returns the only membership when there is one', () => {
    expect(pickBestMembership([hostRow])?.id).toBe('host');
  });

  it('prefers the higher tier over the later expiry', () => {
    // The community host case: a paid Adventurer must beat the free Initiate,
    // even though the Initiate carries a year-2999 sentinel expiry.
    const upgrade = {
      id: 'paid', tier: 'adventurer', expires_at: '2026-12-31',
      plus_ones_used: 0, never_expires: false, source: null,
    };
    expect(pickBestMembership([hostRow, upgrade])?.id).toBe('paid');
    expect(pickBestMembership([upgrade, hostRow])?.id).toBe('paid');
  });

  it('falls back to the host membership once an upgrade is gone', () => {
    // Expired rows never reach here, so a lapsed upgrade simply isn't in the list.
    expect(pickBestMembership([hostRow])?.tier).toBe('initiate');
  });

  it('breaks ties on the same tier by latest expiry', () => {
    const older = { id: 'a', tier: 'initiate', expires_at: '2026-09-01', plus_ones_used: 0 };
    const newer = { id: 'b', tier: 'initiate', expires_at: '2026-11-01', plus_ones_used: 0 };
    expect(pickBestMembership([older, newer])?.id).toBe('b');
    expect(pickBestMembership([newer, older])?.id).toBe('b');
  });

  it('ranks guildmaster above adventurer above initiate', () => {
    const rows = [
      { id: 'i', tier: 'initiate', expires_at: '2099-01-01', plus_ones_used: 0 },
      { id: 'g', tier: 'guildmaster', expires_at: '2026-01-01', plus_ones_used: 0 },
      { id: 'a', tier: 'adventurer', expires_at: '2030-01-01', plus_ones_used: 0 },
    ];
    expect(pickBestMembership(rows)?.id).toBe('g');
  });
});

function membershipTableMock(existing: unknown, captured: { insert?: any; update?: any }) {
  return {
    from: (table: string) => {
      if (table !== 'guild_path_members') throw new Error('unexpected table ' + table);
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              order: () => ({
                limit: () => ({ maybeSingle: async () => ({ data: existing, error: null }) }),
              }),
            }),
          }),
        }),
        insert: (row: any) => {
          captured.insert = row;
          return { select: () => ({ single: async () => ({ data: { id: 'new-membership' }, error: null }) }) };
        },
        update: (patch: any) => {
          captured.update = patch;
          const chain: any = {
            eq: () => chain,
            neq: () => chain,
            select: async () => ({ data: [{ id: 'cancelled-1' }], error: null }),
            then: (resolve: any) => resolve({ error: null }),
          };
          return chain;
        },
      };
    },
  } as any;
}

describe('grantCommunityHostMembership', () => {
  it('creates a free never-expiring Initiate membership', async () => {
    const captured: { insert?: any } = {};
    const result = await grantCommunityHostMembership(membershipTableMock(null, captured), 'user-1');

    expect(result).toEqual({ membership_id: 'new-membership', created: true });
    expect(captured.insert).toMatchObject({
      user_id: 'user-1',
      tier: 'initiate',
      amount: 0,
      status: 'paid',
      expires_at: NEVER_EXPIRES_DATE,
      never_expires: true,
      source: COMMUNITY_HOST_SOURCE,
    });
  });

  it('leaves an existing paid host membership alone', async () => {
    const captured: { insert?: any; update?: any } = {};
    const result = await grantCommunityHostMembership(
      membershipTableMock({ id: 'existing', status: 'paid' }, captured),
      'user-1',
    );

    expect(result).toEqual({ membership_id: 'existing', created: false });
    expect(captured.insert).toBeUndefined();
    expect(captured.update).toBeUndefined();
  });

  it('revives a previously cancelled host membership instead of stacking another', async () => {
    const captured: { insert?: any; update?: any } = {};
    const result = await grantCommunityHostMembership(
      membershipTableMock({ id: 'old', status: 'cancelled' }, captured),
      'user-1',
    );

    expect(result).toEqual({ membership_id: 'old', created: false });
    expect(captured.insert).toBeUndefined();
    expect(captured.update).toMatchObject({
      status: 'paid',
      tier: 'initiate',
      amount: 0,
      expires_at: NEVER_EXPIRES_DATE,
      never_expires: true,
    });
  });

  it('throws when the insert fails so the caller can report it', async () => {
    const supabase = {
      from: () => ({
        select: () => ({ eq: () => ({ eq: () => ({ order: () => ({ limit: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) }) }),
        insert: () => ({ select: () => ({ single: async () => ({ data: null, error: { message: 'boom' } }) }) }),
      }),
    } as any;
    await expect(grantCommunityHostMembership(supabase, 'user-1')).rejects.toThrow();
  });
});

describe('revokeCommunityHostMembership', () => {
  it('cancels only memberships sourced from hosting', async () => {
    const filters: Array<[string, unknown]> = [];
    let patch: any = null;
    const supabase = {
      from: () => ({
        update: (p: any) => {
          patch = p;
          const chain: any = {
            eq: (col: string, val: unknown) => { filters.push([col, val]); return chain; },
            neq: (col: string, val: unknown) => { filters.push([col, val]); return chain; },
            select: async () => ({ data: [{ id: 'm1' }], error: null }),
          };
          return chain;
        },
      }),
    } as any;

    const count = await revokeCommunityHostMembership(supabase, 'user-1');

    expect(count).toBe(1);
    expect(patch).toEqual({ status: 'cancelled' });
    expect(filters).toContainEqual(['source', COMMUNITY_HOST_SOURCE]);
    expect(filters).toContainEqual(['user_id', 'user-1']);
    expect(filters).toContainEqual(['status', 'cancelled']);
  });
});

describe('NEVER_EXPIRES_DATE', () => {
  it('sorts after any realistic membership expiry', () => {
    // Every "is this active?" query filters on expires_at >= today, so the
    // sentinel must stay comfortably in the future for the flag to work.
    expect(NEVER_EXPIRES_DATE > new Date().toISOString().slice(0, 10)).toBe(true);
  });
});
