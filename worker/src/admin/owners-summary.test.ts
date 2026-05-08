import { describe, it, expect, vi } from 'vitest';

function mockEnv() {
  return {
    SUPABASE_URL: 'x', SUPABASE_SERVICE_KEY: 'x',
    UPI_ID: 'x', APPS_SCRIPT_URL: '', APPS_SCRIPT_SECRET: '', BGC_SITE_URL: '',
    CF_ACCESS_TEAM_DOMAIN: 'x', CF_ACCESS_AUD: 'x', ADMIN_EMAILS: '', ENVIRONMENT: 'production',
  } as any;
}

vi.mock('../supabase', () => ({ getSupabase: vi.fn() }));

import { getSupabase } from '../supabase';
import { handleOwnersSummary } from './games';

function buildSupabaseMock(rows: { owned_by: string | null; currently_with: string | null }[] | null, error: { message: string } | null) {
  return {
    from: (table: string) => {
      if (table !== 'games') throw new Error(`unexpected table ${table}`);
      return {
        select: () => Promise.resolve({ data: rows, error }),
      };
    },
  };
}

describe('handleOwnersSummary', () => {
  it('returns aggregated owners on success', async () => {
    (getSupabase as any).mockReturnValue(buildSupabaseMock([
      { owned_by: 'Alice', currently_with: 'Bob' },
      { owned_by: 'Alice', currently_with: null },
      { owned_by: null, currently_with: 'Carol' },
    ], null));

    const res = await handleOwnersSummary(mockEnv());
    expect(res.status).toBe(200);
    const body = await res.json() as { owners: any[] };
    expect(body.owners).toHaveLength(2);
    const alice = body.owners.find((o) => o.owner === 'Alice');
    expect(alice).toMatchObject({ owner: 'Alice', total: 2, with_owner: 1, with_others: 1 });
    expect(alice.top_holders).toEqual([{ name: 'Bob', count: 1 }]);
    const unowned = body.owners.find((o) => o.owner === null);
    expect(unowned).toMatchObject({ owner: null, total: 1, with_owner: 0, with_others: 1 });
  });

  it('returns 500 on supabase error', async () => {
    (getSupabase as any).mockReturnValue(buildSupabaseMock(null, { message: 'boom' }));
    const res = await handleOwnersSummary(mockEnv());
    expect(res.status).toBe(500);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/owners/i);
  });

  it('returns empty list when no games exist', async () => {
    (getSupabase as any).mockReturnValue(buildSupabaseMock([], null));
    const res = await handleOwnersSummary(mockEnv());
    expect(res.status).toBe(200);
    const body = await res.json() as { owners: any[] };
    expect(body.owners).toEqual([]);
  });
});
