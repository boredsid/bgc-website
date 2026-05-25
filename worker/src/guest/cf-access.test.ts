import { describe, expect, it, vi, beforeEach } from 'vitest';

function mockEnv(extra: Record<string, string> = {}) {
  return {
    SUPABASE_URL: 'x', SUPABASE_SERVICE_KEY: 'x',
    UPI_ID: 'x', APPS_SCRIPT_URL: '', APPS_SCRIPT_SECRET: '', BGC_SITE_URL: '',
    CF_ACCESS_TEAM_DOMAIN: 'x', CF_ACCESS_AUD: 'x', ADMIN_EMAILS: '', ENVIRONMENT: 'production',
    ...extra,
  } as any;
}

vi.mock('../supabase', () => ({ getSupabase: vi.fn() }));
import { getSupabase } from '../supabase';
import { activeGuestEmails, syncCfAccessGroup } from './cf-access';

function mockSupabase(activeEvents: { id: string }[], guestRows: { email: string }[]) {
  return {
    from: (table: string) => {
      if (table === 'events') {
        return { select: () => ({ eq: () => ({ gte: async () => ({ data: activeEvents, error: null }) }) }) };
      }
      if (table === 'event_guest_admins') {
        return { select: () => ({ in: async () => ({ data: guestRows, error: null }) }) };
      }
      return null;
    },
  };
}

describe('activeGuestEmails', () => {
  it('returns the de-duped set of guest emails across active collaboration events', async () => {
    (getSupabase as any).mockReturnValue(mockSupabase([{ id: 'e1' }, { id: 'e2' }], [{ email: 'a@x.com' }, { email: 'a@x.com' }, { email: 'b@x.com' }]));
    const emails = await activeGuestEmails(mockEnv());
    expect(emails.sort()).toEqual(['a@x.com', 'b@x.com']);
  });

  it('returns [] when no events are active', async () => {
    (getSupabase as any).mockReturnValue(mockSupabase([], []));
    expect(await activeGuestEmails(mockEnv())).toEqual([]);
  });
});

describe('syncCfAccessGroup', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('skips (no fetch) when CF secrets are missing', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    (getSupabase as any).mockReturnValue(mockSupabase([{ id: 'e1' }], [{ email: 'a@x.com' }]));
    await syncCfAccessGroup(mockEnv());
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('PUTs the active email set to the CF group when secrets are present', async () => {
    const fetchSpy = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    (getSupabase as any).mockReturnValue(mockSupabase([{ id: 'e1' }], [{ email: 'a@x.com' }]));
    await syncCfAccessGroup(mockEnv({ CF_API_TOKEN: 't', CF_ACCOUNT_ID: 'acc', CF_ACCESS_GROUP_ID: 'grp' }));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = fetchSpy.mock.calls[0];
    expect(calledUrl).toBe('https://api.cloudflare.com/client/v4/accounts/acc/access/groups/grp');
    expect(init.method).toBe('PUT');
    const sent = JSON.parse(init.body);
    expect(sent.include).toEqual([{ email: { email: 'a@x.com' } }]);
  });

  it('sends a non-matching placeholder include when there are no active guests', async () => {
    const fetchSpy = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    (getSupabase as any).mockReturnValue(mockSupabase([], []));
    await syncCfAccessGroup(mockEnv({ CF_API_TOKEN: 't', CF_ACCOUNT_ID: 'acc', CF_ACCESS_GROUP_ID: 'grp' }));
    const sent = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(sent.include).toEqual([{ email: { email: 'no-guests@invalid.bgc' } }]);
  });
});
