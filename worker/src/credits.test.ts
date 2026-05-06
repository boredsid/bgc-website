import { describe, expect, it } from 'vitest';
import { applyCreditsToTotal, getUserBalance } from './credits';

function fakeSupabaseWithBalance(rows: { amount: number }[]) {
  return {
    from: () => ({
      select: () => ({
        eq: () => Promise.resolve({ data: rows, error: null }),
      }),
    }),
  } as unknown as Parameters<typeof getUserBalance>[0];
}

describe('getUserBalance', () => {
  it('returns 0 when no rows', async () => {
    const sb = fakeSupabaseWithBalance([]);
    expect(await getUserBalance(sb, 'u1')).toBe(0);
  });

  it('sums positives and negatives', async () => {
    const sb = fakeSupabaseWithBalance([{ amount: 500 }, { amount: -200 }, { amount: 100 }]);
    expect(await getUserBalance(sb, 'u1')).toBe(400);
  });
});

describe('applyCreditsToTotal', () => {
  it('returns 0 when balance is 0', async () => {
    const sb = fakeSupabaseWithBalance([]);
    expect(await applyCreditsToTotal(sb, 'u1', 800)).toEqual({ creditsApplied: 0, finalAmount: 800 });
  });

  it('caps at totalAmount when balance exceeds it', async () => {
    const sb = fakeSupabaseWithBalance([{ amount: 1000 }]);
    expect(await applyCreditsToTotal(sb, 'u1', 300)).toEqual({ creditsApplied: 300, finalAmount: 0 });
  });

  it('caps at balance when total exceeds it', async () => {
    const sb = fakeSupabaseWithBalance([{ amount: 200 }]);
    expect(await applyCreditsToTotal(sb, 'u1', 800)).toEqual({ creditsApplied: 200, finalAmount: 600 });
  });

  it('floors negative balance to 0 applied', async () => {
    const sb = fakeSupabaseWithBalance([{ amount: -50 }]);
    expect(await applyCreditsToTotal(sb, 'u1', 800)).toEqual({ creditsApplied: 0, finalAmount: 800 });
  });

  it('returns 0 applied when total is 0 or negative', async () => {
    const sb = fakeSupabaseWithBalance([{ amount: 1000 }]);
    expect(await applyCreditsToTotal(sb, 'u1', 0)).toEqual({ creditsApplied: 0, finalAmount: 0 });
  });
});
