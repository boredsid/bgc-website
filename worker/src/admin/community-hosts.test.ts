import { describe, it, expect, vi, beforeEach } from 'vitest';

function mockEnv() {
  return {
    SUPABASE_URL: 'x', SUPABASE_SERVICE_KEY: 'x',
    UPI_ID: 'x', APPS_SCRIPT_URL: '', APPS_SCRIPT_SECRET: '', BGC_SITE_URL: '',
    CF_ACCESS_TEAM_DOMAIN: 'x', CF_ACCESS_AUD: 'x', ADMIN_EMAILS: '', ENVIRONMENT: 'production',
  } as any;
}

vi.mock('../supabase', () => ({ getSupabase: vi.fn() }));

import { getSupabase } from '../supabase';
import {
  handleListCommunityHosts,
  handleCreateCommunityHost,
  handleSetCommunityHost,
  assertCommunityHost,
} from './community-hosts';

const captured: { userUpdate?: any; membershipInsert?: any; membershipUpdate?: any; userInsert?: any } = {};

interface MockOptions {
  users?: Array<Record<string, unknown>>;
  hostSeats?: Array<{ user_id: string }>;
  memberships?: Array<Record<string, unknown>>;
  /** The single user returned by an id/phone lookup. */
  user?: Record<string, unknown> | null;
  /** The existing community-host membership row, if any. */
  hostMembership?: Record<string, unknown> | null;
}

function buildMock(opts: MockOptions = {}) {
  return {
    from: (table: string) => {
      if (table === 'users') {
        const listChain: any = {
          eq: () => listChain,
          order: async () => ({ data: opts.users ?? [], error: null }),
          maybeSingle: async () => ({ data: opts.user ?? null, error: null }),
        };
        return {
          select: () => listChain,
          update: (patch: any) => {
            captured.userUpdate = patch;
            return { eq: async () => ({ error: null }) };
          },
          insert: (row: any) => {
            captured.userInsert = row;
            return { select: () => ({ single: async () => ({ data: { id: 'NEWUSER' }, error: null }) }) };
          },
        };
      }
      if (table === 'guild_path_members') {
        const rows = { data: opts.memberships ?? [], error: null };
        // Three shapes read this table: the roster join ends at .gte(), the
        // active-membership lookup carries on to .order(), and the host-row
        // lookup ends at .limit().maybeSingle(). One chain serves all three.
        const afterGte: any = {
          order: async () => rows,
          then: (resolve: any) => resolve(rows),
        };
        const chain: any = {
          eq: () => chain,
          in: () => chain,
          gte: () => afterGte,
          order: () => ({ limit: () => ({ maybeSingle: async () => ({ data: opts.hostMembership ?? null, error: null }) }) }),
        };
        return {
          select: () => chain,
          insert: (row: any) => {
            captured.membershipInsert = row;
            return { select: () => ({ single: async () => ({ data: { id: 'M-NEW' }, error: null }) }) };
          },
          update: (patch: any) => {
            captured.membershipUpdate = patch;
            const u: any = {
              eq: () => u,
              neq: () => u,
              select: async () => ({ data: [{ id: 'M1' }], error: null }),
              then: (r: any) => r({ error: null }),
            };
            return u;
          },
        };
      }
      if (table === 'registrations') {
        const chain: any = {
          in: () => chain,
          eq: () => chain,
          neq: async () => ({ data: opts.hostSeats ?? [], error: null }),
        };
        return { select: () => chain };
      }
      throw new Error('unexpected table ' + table);
    },
  };
}

function post(body: unknown) {
  return new Request('https://api.test/api/admin/community-hosts', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  captured.userUpdate = undefined;
  captured.userInsert = undefined;
  captured.membershipInsert = undefined;
  captured.membershipUpdate = undefined;
});

describe('handleListCommunityHosts', () => {
  it('returns an empty roster without extra queries', async () => {
    (getSupabase as any).mockReturnValue(buildMock({ users: [] }));

    const res = await handleListCommunityHosts(mockEnv());
    const body = await res.json<any>();

    expect(res.status).toBe(200);
    expect(body.hosts).toEqual([]);
  });

  it('counts hosted sessions and reports the membership in force', async () => {
    (getSupabase as any).mockReturnValue(buildMock({
      users: [
        { id: 'U1', name: 'Riya', phone: '9876500001', email: null, community_host_since: '2026-01-01', community_host_notes: null },
        { id: 'U2', name: 'Arjun', phone: '9876500002', email: null, community_host_since: '2026-02-01', community_host_notes: null },
      ],
      hostSeats: [{ user_id: 'U1' }, { user_id: 'U1' }, { user_id: 'U2' }],
      memberships: [
        { user_id: 'U1', tier: 'initiate', expires_at: '2999-12-31', never_expires: true },
        { user_id: 'U2', tier: 'initiate', expires_at: '2999-12-31', never_expires: true },
        { user_id: 'U2', tier: 'guildmaster', expires_at: '2027-01-01', never_expires: false },
      ],
    }));

    const res = await handleListCommunityHosts(mockEnv());
    const body = await res.json<any>();

    // Busiest host first.
    expect(body.hosts.map((h: any) => h.id)).toEqual(['U1', 'U2']);
    expect(body.hosts[0].sessions_hosted).toBe(2);
    expect(body.hosts[0].membership_tier).toBe('initiate');
    expect(body.hosts[0].membership_never_expires).toBe(true);
    // A paid upgrade outranks the free host membership.
    expect(body.hosts[1].membership_tier).toBe('guildmaster');
    expect(body.hosts[1].membership_never_expires).toBe(false);
  });
});

describe('handleSetCommunityHost', () => {
  it('flags the user and grants the free never-expiring membership', async () => {
    (getSupabase as any).mockReturnValue(buildMock({
      user: { id: 'U1', name: 'Riya', is_community_host: false, community_host_since: null },
      memberships: [{ id: 'M-NEW', tier: 'initiate', expires_at: '2999-12-31', never_expires: true }],
    }));

    const res = await handleSetCommunityHost(
      'U1',
      post({ is_community_host: true, notes: 'Runs Clocktower nights' }),
      mockEnv(),
    );
    const body = await res.json<any>();

    expect(res.status).toBe(200);
    expect(body.is_community_host).toBe(true);
    expect(body.active_tier).toBe('initiate');
    expect(captured.membershipInsert).toMatchObject({ tier: 'initiate', amount: 0, never_expires: true });
    expect(captured.userUpdate).toMatchObject({
      is_community_host: true,
      community_host_notes: 'Runs Clocktower nights',
    });
  });

  it('keeps the original host-since date when re-saving an existing host', async () => {
    (getSupabase as any).mockReturnValue(buildMock({
      user: { id: 'U1', name: 'Riya', is_community_host: true, community_host_since: '2026-03-01' },
      hostMembership: { id: 'M1', status: 'paid' },
      memberships: [{ id: 'M1', tier: 'initiate', expires_at: '2999-12-31', never_expires: true }],
    }));

    await handleSetCommunityHost('U1', post({ is_community_host: true, notes: 'Updated' }), mockEnv());

    expect(captured.userUpdate.community_host_since).toBe('2026-03-01');
    expect(captured.membershipInsert).toBeUndefined();
  });

  it('reports the paid tier still in force for a host who upgraded', async () => {
    (getSupabase as any).mockReturnValue(buildMock({
      user: { id: 'U1', name: 'Riya', is_community_host: false, community_host_since: null },
      memberships: [
        { id: 'M-NEW', tier: 'initiate', expires_at: '2999-12-31', never_expires: true },
        { id: 'M-PAID', tier: 'adventurer', expires_at: '2027-01-01', never_expires: false },
      ],
    }));

    const res = await handleSetCommunityHost('U1', post({ is_community_host: true }), mockEnv());
    const body = await res.json<any>();

    expect(body.active_tier).toBe('adventurer');
    expect(body.active_never_expires).toBe(false);
  });

  it('cancels the free membership when standing a host down', async () => {
    (getSupabase as any).mockReturnValue(buildMock({
      user: { id: 'U1', name: 'Riya', is_community_host: true, community_host_since: '2026-01-01' },
      memberships: [],
    }));

    const res = await handleSetCommunityHost('U1', post({ is_community_host: false }), mockEnv());
    const body = await res.json<any>();

    expect(body.is_community_host).toBe(false);
    expect(body.memberships_cancelled).toBe(1);
    expect(captured.membershipUpdate).toEqual({ status: 'cancelled' });
    expect(captured.userUpdate).toMatchObject({ is_community_host: false });
  });

  it('rejects a request that does not say which way to set the flag', async () => {
    (getSupabase as any).mockReturnValue(buildMock());

    const res = await handleSetCommunityHost('U1', post({ notes: 'hi' }), mockEnv());

    expect(res.status).toBe(400);
  });

  it('404s for an unknown user', async () => {
    (getSupabase as any).mockReturnValue(buildMock({ user: null }));

    const res = await handleSetCommunityHost('nope', post({ is_community_host: true }), mockEnv());

    expect(res.status).toBe(404);
  });
});

describe('handleCreateCommunityHost', () => {
  it('creates the user record when the number is new', async () => {
    (getSupabase as any).mockReturnValue(buildMock({ user: null, memberships: [] }));

    const res = await handleCreateCommunityHost(
      post({ phone: '9876543210', name: 'Riya', email: 'riya@x.com' }),
      mockEnv(),
    );
    const body = await res.json<any>();

    expect(res.status).toBe(200);
    expect(body.user_id).toBe('NEWUSER');
    expect(captured.userInsert).toMatchObject({ phone: '9876543210', name: 'Riya', source: 'community_host' });
    expect(captured.membershipInsert).toMatchObject({ user_id: 'NEWUSER', tier: 'initiate', amount: 0 });
  });

  it('reuses an existing user without blanking their name', async () => {
    (getSupabase as any).mockReturnValue(buildMock({
      user: { id: 'U1', name: 'Riya Sharma', is_community_host: false },
      memberships: [],
    }));

    const res = await handleCreateCommunityHost(post({ phone: '9876543210', name: 'R' }), mockEnv());

    expect(res.status).toBe(200);
    expect(captured.userInsert).toBeUndefined();
    expect(captured.userUpdate).toMatchObject({ is_community_host: true });
  });

  it('refuses a number that is already a host', async () => {
    (getSupabase as any).mockReturnValue(buildMock({
      user: { id: 'U1', name: 'Riya', is_community_host: true },
    }));

    const res = await handleCreateCommunityHost(post({ phone: '9876543210', name: 'Riya' }), mockEnv());
    const body = await res.json<any>();

    expect(res.status).toBe(409);
    expect(body.code).toBe('already_host');
  });

  it('needs a name for a number we have never seen', async () => {
    (getSupabase as any).mockReturnValue(buildMock({ user: null }));

    const res = await handleCreateCommunityHost(post({ phone: '9876543210' }), mockEnv());
    const body = await res.json<any>();

    expect(res.status).toBe(400);
    expect(body.error).toContain('name');
  });

  it('rejects an unusable phone number in plain English', async () => {
    (getSupabase as any).mockReturnValue(buildMock());

    const res = await handleCreateCommunityHost(post({ phone: '123', name: 'Riya' }), mockEnv());
    const body = await res.json<any>();

    expect(res.status).toBe(400);
    expect(body.error).toContain('10-digit');
  });
});

describe('assertCommunityHost', () => {
  it('returns the user when they are on the roster', async () => {
    const supabase = buildMock({ user: { id: 'U1', name: 'Riya', email: null, is_community_host: true } }) as any;
    await expect(assertCommunityHost(supabase, '9876543210')).resolves.toMatchObject({ id: 'U1' });
  });

  it('returns null for a user who is not a host', async () => {
    const supabase = buildMock({ user: { id: 'U1', name: 'Riya', email: null, is_community_host: false } }) as any;
    await expect(assertCommunityHost(supabase, '9876543210')).resolves.toBeNull();
  });

  it('returns null for an unknown number', async () => {
    const supabase = buildMock({ user: null }) as any;
    await expect(assertCommunityHost(supabase, '9876543210')).resolves.toBeNull();
  });
});
