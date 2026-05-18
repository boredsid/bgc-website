// worker/src/guild-status.test.ts
import { describe, expect, it, vi } from 'vitest';

function mockEnv() {
  return {
    SUPABASE_URL: 'x',
    SUPABASE_SERVICE_KEY: 'x',
    UPI_ID: 'x',
    APPS_SCRIPT_URL: '',
    APPS_SCRIPT_SECRET: '',
    BGC_SITE_URL: '',
    CF_ACCESS_TEAM_DOMAIN: 'x',
    CF_ACCESS_AUD: 'x',
    ADMIN_EMAILS: '',
    ENVIRONMENT: 'production',
    REPLAY_TO_BGC_SECRET: 'test-secret',
  } as any;
}

vi.mock('./supabase', () => ({ getSupabase: vi.fn() }));

import { getSupabase } from './supabase';
import { handleGuildStatus } from './guild-status';

interface MemberRow {
  tier: 'initiate' | 'adventurer' | 'guildmaster';
  expires_at: string;
}

function buildSupabaseMock(opts: {
  user?: { id: string } | null;
  member?: MemberRow | null;
}) {
  const user = opts.user ?? null;
  const member = opts.member ?? null;
  return {
    from: (table: string) => {
      if (table === 'users') {
        return {
          select: () => ({
            eq: (_c: string, _v: string) => ({
              maybeSingle: async () => ({ data: user, error: null }),
            }),
          }),
        };
      }
      if (table === 'guild_path_members') {
        return {
          select: () => ({
            eq: (_c1: string, _v1: string) => ({
              eq: (_c2: string, _v2: string) => ({
                gte: (_c3: string, _v3: string) => ({
                  order: () => ({
                    limit: () => ({
                      maybeSingle: async () => ({ data: member, error: null }),
                    }),
                  }),
                }),
              }),
            }),
          }),
        };
      }
      throw new Error('unexpected table ' + table);
    },
  };
}

function bearer(token: string) {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

describe('handleGuildStatus', () => {
  it('rejects request with no Authorization header', async () => {
    (getSupabase as any).mockReturnValue(buildSupabaseMock({}));
    const req = new Request('http://localhost/api/guild-status', {
      method: 'POST',
      body: JSON.stringify({ phone: '9876543210' }),
    });
    const res = await handleGuildStatus(req, mockEnv());
    expect(res.status).toBe(401);
  });

  it('rejects request with wrong bearer token', async () => {
    (getSupabase as any).mockReturnValue(buildSupabaseMock({}));
    const req = new Request('http://localhost/api/guild-status', {
      method: 'POST',
      headers: bearer('wrong-secret'),
      body: JSON.stringify({ phone: '9876543210' }),
    });
    const res = await handleGuildStatus(req, mockEnv());
    expect(res.status).toBe(401);
  });

  it('rejects with 401 when secret is missing in env', async () => {
    (getSupabase as any).mockReturnValue(buildSupabaseMock({}));
    const env = mockEnv();
    env.REPLAY_TO_BGC_SECRET = '';
    const req = new Request('http://localhost/api/guild-status', {
      method: 'POST',
      headers: bearer('test-secret'),
      body: JSON.stringify({ phone: '9876543210' }),
    });
    const res = await handleGuildStatus(req, env);
    expect(res.status).toBe(401);
  });

  it('returns {tier:null, active:false} for unknown phone with valid auth', async () => {
    (getSupabase as any).mockReturnValue(buildSupabaseMock({ user: null }));
    const req = new Request('http://localhost/api/guild-status', {
      method: 'POST',
      headers: bearer('test-secret'),
      body: JSON.stringify({ phone: '9876543210' }),
    });
    const res = await handleGuildStatus(req, mockEnv());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ tier: null, active: false });
  });

  it('returns {tier:null, active:false} when user exists but has no paid membership', async () => {
    (getSupabase as any).mockReturnValue(
      buildSupabaseMock({ user: { id: 'u1' }, member: null }),
    );
    const req = new Request('http://localhost/api/guild-status', {
      method: 'POST',
      headers: bearer('test-secret'),
      body: JSON.stringify({ phone: '9876543210' }),
    });
    const res = await handleGuildStatus(req, mockEnv());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ tier: null, active: false });
  });

  it('returns {tier, active:true} for active paid member', async () => {
    (getSupabase as any).mockReturnValue(
      buildSupabaseMock({
        user: { id: 'u1' },
        member: { tier: 'adventurer', expires_at: '2099-01-01' },
      }),
    );
    const req = new Request('http://localhost/api/guild-status', {
      method: 'POST',
      headers: bearer('test-secret'),
      body: JSON.stringify({ phone: '9876543210' }),
    });
    const res = await handleGuildStatus(req, mockEnv());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ tier: 'adventurer', active: true });
  });

  it('returns {tier:null, active:false} for malformed phone with valid auth', async () => {
    (getSupabase as any).mockReturnValue(buildSupabaseMock({ user: null }));
    const req = new Request('http://localhost/api/guild-status', {
      method: 'POST',
      headers: bearer('test-secret'),
      body: JSON.stringify({ phone: '12' }),
    });
    const res = await handleGuildStatus(req, mockEnv());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ tier: null, active: false });
  });
});
