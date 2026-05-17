import { describe, expect, it } from 'vitest';
import {
  consumePromoUses,
  getActivePromo,
  getApplicablePromo,
  restorePromoUses,
  type ActivePromo,
} from './promos';

type SbStub = Parameters<typeof getActivePromo>[0];

interface PromoRow {
  id: string;
  remaining_uses: number;
  max_event_price: number;
  expires_at: string | null;
}

function fakeSupabaseSinglePromo(row: PromoRow | null) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          gt: () => ({
            or: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: () => Promise.resolve({ data: row, error: null }),
                }),
              }),
            }),
          }),
        }),
      }),
    }),
  } as unknown as SbStub;
}

function fakeSupabaseUpdate(opts: {
  matchedRow: { id: string } | null;
  capturedUpdate?: { value: Record<string, unknown> | null };
  capturedFilters?: { value: Array<[string, unknown]> };
}) {
  return {
    from: () => ({
      update: (vals: Record<string, unknown>) => {
        if (opts.capturedUpdate) opts.capturedUpdate.value = vals;
        const filters: Array<[string, unknown]> = [];
        const builder: any = {
          eq: (k: string, v: unknown) => {
            filters.push([k, v]);
            if (opts.capturedFilters) opts.capturedFilters.value = filters;
            return builder;
          },
          select: () => ({
            maybeSingle: () => Promise.resolve({ data: opts.matchedRow, error: null }),
          }),
        };
        return builder;
      },
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve({
              data: opts.matchedRow ? { remaining_uses: 3 } : null,
              error: null,
            }),
        }),
      }),
    }),
  } as unknown as SbStub;
}

describe('getActivePromo', () => {
  it('returns null when user has no active promo', async () => {
    const sb = fakeSupabaseSinglePromo(null);
    expect(await getActivePromo(sb, 'u1')).toBeNull();
  });

  it('returns the matching promo row', async () => {
    const row: PromoRow = { id: 'p1', remaining_uses: 2, max_event_price: 500, expires_at: null };
    const sb = fakeSupabaseSinglePromo(row);
    expect(await getActivePromo(sb, 'u1')).toEqual(row);
  });
});

describe('getApplicablePromo', () => {
  it('returns null when event price exceeds cap', async () => {
    const row: PromoRow = { id: 'p1', remaining_uses: 2, max_event_price: 300, expires_at: null };
    const sb = fakeSupabaseSinglePromo(row);
    expect(await getApplicablePromo(sb, 'u1', 500)).toBeNull();
  });

  it('returns the promo when event price equals cap', async () => {
    const row: PromoRow = { id: 'p1', remaining_uses: 2, max_event_price: 500, expires_at: null };
    const sb = fakeSupabaseSinglePromo(row);
    expect(await getApplicablePromo(sb, 'u1', 500)).toEqual(row);
  });

  it('returns the promo when event price is below cap', async () => {
    const row: PromoRow = { id: 'p1', remaining_uses: 1, max_event_price: 1000, expires_at: null };
    const sb = fakeSupabaseSinglePromo(row);
    expect(await getApplicablePromo(sb, 'u1', 200)).toEqual(row);
  });
});

describe('consumePromoUses', () => {
  const promo: ActivePromo = {
    id: 'p1',
    remaining_uses: 3,
    max_event_price: 500,
    expires_at: null,
  };

  it('returns true and decrements when not racing', async () => {
    const captured: { value: Record<string, unknown> | null } = { value: null };
    const sb = fakeSupabaseUpdate({ matchedRow: { id: 'p1' }, capturedUpdate: captured });
    expect(await consumePromoUses(sb, promo, 2)).toBe(true);
    expect(captured.value).toEqual({ remaining_uses: 1 });
  });

  it('returns false when concurrent write changed the row (no match)', async () => {
    const sb = fakeSupabaseUpdate({ matchedRow: null });
    expect(await consumePromoUses(sb, promo, 1)).toBe(false);
  });

  it('returns false when uses exceeds remaining (would go negative)', async () => {
    const sb = fakeSupabaseUpdate({ matchedRow: { id: 'p1' } });
    expect(await consumePromoUses(sb, promo, 5)).toBe(false);
  });

  it('is a no-op for zero uses', async () => {
    const captured: { value: Record<string, unknown> | null } = { value: null };
    const sb = fakeSupabaseUpdate({ matchedRow: null, capturedUpdate: captured });
    expect(await consumePromoUses(sb, promo, 0)).toBe(true);
    expect(captured.value).toBeNull();
  });
});

describe('restorePromoUses', () => {
  it('does nothing for zero uses', async () => {
    const captured: { value: Record<string, unknown> | null } = { value: null };
    const sb = fakeSupabaseUpdate({ matchedRow: { id: 'p1' }, capturedUpdate: captured });
    await restorePromoUses(sb, 'p1', 0);
    expect(captured.value).toBeNull();
  });

  it('increments remaining_uses by the restored count', async () => {
    const captured: { value: Record<string, unknown> | null } = { value: null };
    const sb = fakeSupabaseUpdate({ matchedRow: { id: 'p1' }, capturedUpdate: captured });
    await restorePromoUses(sb, 'p1', 2);
    // matchedRow stub returns remaining_uses: 3, so restore +2 = 5
    expect(captured.value).toEqual({ remaining_uses: 5 });
  });
});
