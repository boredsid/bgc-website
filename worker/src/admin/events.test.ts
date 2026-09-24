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

function mockSupabase(
  existingGuests: { email: string }[],
  capture: Capture,
  existingEvent: any = { date: '2026-09-05T18:00:00+05:30', end_date: null },
) {
  return {
    from: (table: string) => {
      if (table === 'events') {
        return {
          update: (row: any) => { capture.eventUpdate = row; return { eq: () => ({ select: () => ({ maybeSingle: async () => ({ data: { id: 'e1', ...row }, error: null }) }) }) }; },
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: existingEvent, error: null }) }) }),
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

  it('normalizes fields that do not apply to externally managed events', async () => {
    const cap: Capture = { eventUpdate: null, deletedFor: null, upserted: [] };
    (getSupabase as any).mockReturnValue(mockSupabase([], cap));
    const res = await handleUpdateEvent('e1', patch({
      externally_managed: true,
      external_registration_url: ' https://ttrpgcon.example/register ',
      price: 500,
      capacity: 100,
      custom_questions: [{ id: 'q1' }],
      price_includes: 'Lunch',
      guild_path_exclusive: true,
      is_collaboration: true,
    }), mockEnv(), ctx, 'admin@bgc.in');

    expect(res.status).toBe(200);
    expect(cap.eventUpdate).toMatchObject({
      externally_managed: true,
      external_registration_url: 'https://ttrpgcon.example/register',
      price: 0,
      capacity: 0,
      custom_questions: [],
      price_includes: null,
      guild_path_exclusive: false,
      is_collaboration: false,
    });
  });

  it('rejects an external event without a valid partner URL', async () => {
    const cap: Capture = { eventUpdate: null, deletedFor: null, upserted: [] };
    (getSupabase as any).mockReturnValue(mockSupabase([], cap));
    const res = await handleUpdateEvent(
      'e1',
      patch({ externally_managed: true, external_registration_url: 'ttrpgcon.example/register' }),
      mockEnv(),
      ctx,
      'admin@bgc.in',
    );
    expect(res.status).toBe(400);
    expect(cap.eventUpdate).toBeNull();
  });
});

describe('handleUpdateEvent timing', () => {
  it('persists an all-day, multi-day event', async () => {
    const cap: Capture = { eventUpdate: null, deletedFor: null, upserted: [] };
    (getSupabase as any).mockReturnValue(mockSupabase([], cap));
    const res = await handleUpdateEvent('e1', patch({
      date: '2026-09-05T00:00:00+05:30',
      end_date: '2026-09-07T00:00:00+05:30',
      is_all_day: true,
    }), mockEnv(), ctx, 'admin@bgc.in');
    expect(res.status).toBe(200);
    expect(cap.eventUpdate).toMatchObject({
      date: '2026-09-05T00:00:00+05:30',
      end_date: '2026-09-07T00:00:00+05:30',
      is_all_day: true,
    });
  });

  it('clears the end when it is sent as null or blank', async () => {
    const cap: Capture = { eventUpdate: null, deletedFor: null, upserted: [] };
    (getSupabase as any).mockReturnValue(mockSupabase([], cap));
    const res = await handleUpdateEvent('e1', patch({ end_date: '' }), mockEnv(), ctx, 'admin@bgc.in');
    expect(res.status).toBe(200);
    expect(cap.eventUpdate).toMatchObject({ end_date: null });
  });

  it('rejects an end that falls before the start in the same payload', async () => {
    const cap: Capture = { eventUpdate: null, deletedFor: null, upserted: [] };
    (getSupabase as any).mockReturnValue(mockSupabase([], cap));
    const res = await handleUpdateEvent('e1', patch({
      date: '2026-09-05T18:00:00+05:30',
      end_date: '2026-09-04T18:00:00+05:30',
    }), mockEnv(), ctx, 'admin@bgc.in');
    expect(res.status).toBe(400);
    expect(cap.eventUpdate).toBeNull();
  });

  it('checks a lone end against the stored start', async () => {
    const cap: Capture = { eventUpdate: null, deletedFor: null, upserted: [] };
    (getSupabase as any).mockReturnValue(
      mockSupabase([], cap, { date: '2026-09-05T18:00:00+05:30', end_date: null }),
    );
    const res = await handleUpdateEvent('e1', patch({ end_date: '2026-09-01T18:00:00+05:30' }), mockEnv(), ctx, 'admin@bgc.in');
    expect(res.status).toBe(400);
    expect(cap.eventUpdate).toBeNull();
  });

  it('checks a lone start against the stored end', async () => {
    const cap: Capture = { eventUpdate: null, deletedFor: null, upserted: [] };
    (getSupabase as any).mockReturnValue(
      mockSupabase([], cap, { date: '2026-09-05T18:00:00+05:30', end_date: '2026-09-07T18:00:00+05:30' }),
    );
    const res = await handleUpdateEvent('e1', patch({ date: '2026-09-09T18:00:00+05:30' }), mockEnv(), ctx, 'admin@bgc.in');
    expect(res.status).toBe(400);
    expect(cap.eventUpdate).toBeNull();
  });

  it('rejects a non-boolean all-day flag', async () => {
    const cap: Capture = { eventUpdate: null, deletedFor: null, upserted: [] };
    (getSupabase as any).mockReturnValue(mockSupabase([], cap));
    const res = await handleUpdateEvent('e1', patch({ is_all_day: 'yes' }), mockEnv(), ctx, 'admin@bgc.in');
    expect(res.status).toBe(400);
    expect(cap.eventUpdate).toBeNull();
  });

  it('never lets a client write the derived ends_at column', async () => {
    const cap: Capture = { eventUpdate: null, deletedFor: null, upserted: [] };
    (getSupabase as any).mockReturnValue(mockSupabase([], cap));
    const res = await handleUpdateEvent('e1', patch({ name: 'Renamed', ends_at: '2030-01-01T00:00:00Z' }), mockEnv(), ctx, 'admin@bgc.in');
    expect(res.status).toBe(200);
    expect(cap.eventUpdate).not.toHaveProperty('ends_at');
  });
});

describe('handleUpdateEvent Google Photos album', () => {
  async function update(google_photos_url: unknown) {
    const cap: Capture = { eventUpdate: null, deletedFor: null, upserted: [] };
    (getSupabase as any).mockReturnValue(mockSupabase([], cap));
    const res = await handleUpdateEvent('e1', patch({ google_photos_url }), mockEnv(), ctx, 'admin@bgc.in');
    return { res, cap };
  }

  it('stores a share link in its canonical form', async () => {
    const { res, cap } = await update('  https://photos.app.goo.gl/QKGRYqfdS15bj8Kr5/ ');
    expect(res.status).toBe(200);
    expect(cap.eventUpdate.google_photos_url).toBe('https://photos.app.goo.gl/QKGRYqfdS15bj8Kr5');
  });

  it('clears the album when the link is blanked', async () => {
    const { res, cap } = await update('   ');
    expect(res.status).toBe(200);
    expect(cap.eventUpdate.google_photos_url).toBeNull();
  });

  it('rejects the owner-only album address with a fix', async () => {
    const { res, cap } = await update('https://photos.google.com/album/AF1QipPk40ln8lzMiqql3QK9');
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toMatch(/Create link/);
    expect(cap.eventUpdate).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Deleting a draft event
// ---------------------------------------------------------------------------

import { handleDeleteEvent } from './events';

interface DeleteCounts { registrations?: number; finance_transactions?: number; leads?: number; event_guest_admins?: number }

function mockDeleteSupabase(
  event: Record<string, unknown> | null,
  counts: DeleteCounts = {},
  state: { deleted: string | null } = { deleted: null },
) {
  return {
    from: (table: string) => {
      if (table === 'events') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: event, error: null }) }) }),
          delete: () => ({ eq: async (_col: string, id: string) => { state.deleted = id; return { error: null }; } }),
        };
      }
      return {
        select: () => ({ eq: async () => ({ count: counts[table as keyof DeleteCounts] ?? 0, error: null }) }),
      };
    },
  };
}

const future = new Date(Date.now() + 7 * 86400000).toISOString();
const past = new Date(Date.now() - 7 * 86400000).toISOString();
const draft = { id: 'e1', name: 'Draft night', is_published: false, ends_at: future };

async function body(res: Response) { return JSON.parse(await res.text()); }

describe('handleDeleteEvent', () => {
  it('deletes an unpublished future event and reports what went with it', async () => {
    const state = { deleted: null as string | null };
    (getSupabase as any).mockReturnValue(mockDeleteSupabase(draft, { leads: 2, event_guest_admins: 1 }, state));
    const res = await handleDeleteEvent('e1', mockEnv(), ctx);
    expect(res.status).toBe(200);
    expect(await body(res)).toMatchObject({ success: true, deleted: { leads: 2, guest_admins: 1 } });
    expect(state.deleted).toBe('e1');
    // Guest admins vanish with the event, so their edge access has to be rebuilt.
    expect(syncCfAccessGroup).toHaveBeenCalled();
  });

  it('refuses to delete a published event', async () => {
    const state = { deleted: null as string | null };
    (getSupabase as any).mockReturnValue(mockDeleteSupabase({ ...draft, is_published: true }, {}, state));
    const res = await handleDeleteEvent('e1', mockEnv(), ctx);
    expect(res.status).toBe(409);
    expect((await body(res)).error).toContain('Published off');
    expect(state.deleted).toBeNull();
  });

  it('refuses to delete an event that has already finished', async () => {
    const state = { deleted: null as string | null };
    (getSupabase as any).mockReturnValue(mockDeleteSupabase({ ...draft, ends_at: past }, {}, state));
    const res = await handleDeleteEvent('e1', mockEnv(), ctx);
    expect(res.status).toBe(409);
    expect((await body(res)).error).toContain('already finished');
    expect(state.deleted).toBeNull();
  });

  it('keeps a multi-day event that is still running', async () => {
    // Started yesterday, ends next week: date is past but ends_at is not, and
    // ends_at is what decides.
    const state = { deleted: null as string | null };
    (getSupabase as any).mockReturnValue(mockDeleteSupabase({ ...draft, date: past, ends_at: future }, {}, state));
    const res = await handleDeleteEvent('e1', mockEnv(), ctx);
    expect(res.status).toBe(200);
    expect(state.deleted).toBe('e1');
  });

  it('refuses to delete an event people have registered for', async () => {
    const state = { deleted: null as string | null };
    (getSupabase as any).mockReturnValue(mockDeleteSupabase(draft, { registrations: 3 }, state));
    const res = await handleDeleteEvent('e1', mockEnv(), ctx);
    expect(res.status).toBe(409);
    expect((await body(res)).error).toContain('3 people have registered');
    expect(state.deleted).toBeNull();
  });

  it('refuses to delete an event with money linked to it', async () => {
    const state = { deleted: null as string | null };
    (getSupabase as any).mockReturnValue(mockDeleteSupabase(draft, { finance_transactions: 1 }, state));
    const res = await handleDeleteEvent('e1', mockEnv(), ctx);
    expect(res.status).toBe(409);
    expect((await body(res)).error).toContain('1 money entry is linked');
    expect(state.deleted).toBeNull();
  });

  it('404s when the event is already gone', async () => {
    (getSupabase as any).mockReturnValue(mockDeleteSupabase(null));
    const res = await handleDeleteEvent('missing', mockEnv(), ctx);
    expect(res.status).toBe(404);
  });
});
