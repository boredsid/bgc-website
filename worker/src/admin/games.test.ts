import { describe, it, expect } from 'vitest';
import { aggregateOwners, type OwnerGameRow } from './games';

const games: OwnerGameRow[] = [
  // Alice: 3 games — 1 at home (currently_with empty), 1 with Alice (self), 1 with Bob
  { owned_by: 'Alice', currently_with: '' },
  { owned_by: 'Alice', currently_with: 'Alice' },
  { owned_by: 'Alice', currently_with: 'Bob' },
  // Bob: 2 games, both at home (one null, one matching name)
  { owned_by: 'Bob', currently_with: null },
  { owned_by: 'Bob', currently_with: 'Bob' },
  // Carol: 5 games out, with 4 distinct holders (tests top-3 truncation)
  { owned_by: 'Carol', currently_with: 'Dan' },
  { owned_by: 'Carol', currently_with: 'Dan' },
  { owned_by: 'Carol', currently_with: 'Eve' },
  { owned_by: 'Carol', currently_with: 'Frank' },
  { owned_by: 'Carol', currently_with: 'Gina' },
  // Whitespace collapses: " Alice " merges with "Alice"
  { owned_by: ' Alice ', currently_with: 'Alice' },
  // Unowned bucket: null and empty string
  { owned_by: null, currently_with: 'Hank' },
  { owned_by: '', currently_with: null },
];

describe('aggregateOwners', () => {
  it('groups by trimmed owned_by, treating null/empty as the Unowned bucket', () => {
    const rows = aggregateOwners(games);
    const byOwner = Object.fromEntries(rows.map((r) => [r.owner ?? '__unowned__', r]));
    expect(rows).toHaveLength(4);
    expect(byOwner.Alice.total).toBe(4);   // 3 + the trimmed " Alice "
    expect(byOwner.Bob.total).toBe(2);
    expect(byOwner.Carol.total).toBe(5);
    expect(byOwner.__unowned__.total).toBe(2);
    expect(byOwner.__unowned__.owner).toBeNull();
  });

  it('counts with_owner when currently_with is null/empty or equals owner', () => {
    const rows = aggregateOwners(games);
    const alice = rows.find((r) => r.owner === 'Alice')!;
    const bob = rows.find((r) => r.owner === 'Bob')!;
    // Alice: 4 rows. with_owner = empty(self) + 'Alice'(self) + ' Alice 'row whose currently_with='Alice' (self) = 3.
    // with_others = 'Bob' = 1.
    expect(alice.with_owner).toBe(3);
    expect(alice.with_others).toBe(1);
    expect(bob.with_owner).toBe(2);
    expect(bob.with_others).toBe(0);
  });

  it('produces empty top_holders when with_others is 0', () => {
    const rows = aggregateOwners(games);
    const bob = rows.find((r) => r.owner === 'Bob')!;
    expect(bob.top_holders).toEqual([]);
    expect(bob.more_holders).toBe(0);
  });

  it('returns at most 3 top_holders by count desc, alphabetical tiebreak, with more_holders count', () => {
    const rows = aggregateOwners(games);
    const carol = rows.find((r) => r.owner === 'Carol')!;
    // Holders: Dan=2, Eve=1, Frank=1, Gina=1 → top 3 should be Dan, Eve, Frank (alpha tiebreak)
    expect(carol.top_holders).toEqual([
      { name: 'Dan', count: 2 },
      { name: 'Eve', count: 1 },
      { name: 'Frank', count: 1 },
    ]);
    expect(carol.more_holders).toBe(1); // Gina excluded
  });

  it('sorts results by total desc then owner asc; Unowned sorts like any other row', () => {
    const rows = aggregateOwners(games);
    expect(rows.map((r) => r.owner ?? '__unowned__')).toEqual([
      'Carol',     // 5
      'Alice',     // 4
      'Bob',       // 2
      '__unowned__', // 2
    ]);
  });

  it('returns empty array for empty input', () => {
    expect(aggregateOwners([])).toEqual([]);
  });
});
