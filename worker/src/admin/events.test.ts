import { describe, expect, it, vi } from 'vitest';

function mockEnv() {
  return {
    SUPABASE_URL: 'x', SUPABASE_SERVICE_KEY: 'x',
    UPI_ID: 'x', APPS_SCRIPT_URL: '', APPS_SCRIPT_SECRET: '', BGC_SITE_URL: '',
    CF_ACCESS_TEAM_DOMAIN: 'x', CF_ACCESS_AUD: 'x', ADMIN_EMAILS: '', ENVIRONMENT: 'production',
  } as any;
}
const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as any;

vi.mock('../supabase', () => ({ getSupabase: vi.fn() }));
vi.mock('../guest/cf-access', () => ({ syncCfAccessGroup: vi.fn(async () => {}) }));

import { getSupabase } from '../supabase';
import { syncCfAccessGroup } from '../guest/cf-access';
import { handleUpdateEvent } from './events';

interface Capture { eventUpdate: any; deletedFor: string | null; upserted: any[] }

function mockSupabase(existingGuests: { email: string }[], capture: Capture) {
  return {
    from: (table: string) => {
      if (table === 'events') {
        return {
          update: (row: any) => { capture.eventUpdate = row; return { eq: () => ({ select: () => ({ maybeSingle: async () => ({ data: { id: 'e1', ...row }, error: null }) }) }) }; },
        };
      }
      if (table === 'event_guest_admins') {
        return {
          select: () => ({ eq: async () => ({ data: existingGuests, error: null }) }),
          delete: () => ({ eq: () => ({ in: async (_col: string, emails: string[]) => { capture.deletedFor = emails.join(','); return { error: null }; } }) }),
          upsert: async (rows: any[]) => { capture.upserted = rows; return { error: null }; },
        };
      }
      return null;
    },
  };
}

function patch(body: unknown) {
  return new Request('http://localhost/api/admin/events/e1', { method: 'PATCH', body: JSON.stringify(body) });
}

describe('handleUpdateEvent collaboration', () => {
  it('persists is_collaboration on the event row', async () => {
    const cap: Capture = { eventUpdate: null, deletedFor: null, upserted: [] };
    (getSupabase as any).mockReturnValue(mockSupabase([], cap));
    const res = await handleUpdateEvent('e1', patch({ is_collaboration: true }), mockEnv(), ctx, 'admin@bgc.in');
    expect(res.status).toBe(200);
    expect(cap.eventUpdate).toMatchObject({ is_collaboration: true });
  });

  it('upserts new guest emails (lowercased), removes dropped ones, and triggers CF sync', async () => {
    const cap: Capture = { eventUpdate: null, deletedFor: null, upserted: [] };
    (getSupabase as any).mockReturnValue(mockSupabase([{ email: 'old@x.com' }], cap));
    const res = await handleUpdateEvent('e1', patch({ is_collaboration: true, guest_admins: ['NEW@x.com'] }), mockEnv(), ctx, 'admin@bgc.in');
    expect(res.status).toBe(200);
    expect(cap.upserted).toEqual([{ event_id: 'e1', email: 'new@x.com', created_by: 'admin@bgc.in' }]);
    expect(cap.deletedFor).toBe('old@x.com');
    expect(syncCfAccessGroup).toHaveBeenCalled();
  });

  it('does not touch guests or sync when guest_admins is absent', async () => {
    const cap: Capture = { eventUpdate: null, deletedFor: null, upserted: [] };
    (getSupabase as any).mockReturnValue(mockSupabase([], cap));
    (syncCfAccessGroup as any).mockClear();
    const res = await handleUpdateEvent('e1', patch({ name: 'Renamed' }), mockEnv(), ctx, 'admin@bgc.in');
    expect(res.status).toBe(200);
    expect(cap.upserted).toEqual([]);
    expect(syncCfAccessGroup).not.toHaveBeenCalled();
  });
});
