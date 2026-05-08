# Game Owners Summary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "Owners" tab to the admin Games page that aggregates the `games` table by `owned_by` and lets admins drill into the existing All Games view filtered by owner.

**Architecture:** A new worker endpoint `GET /api/admin/games/owners-summary` runs an in-memory aggregation over all games (the table is small, ~130 rows). The admin Games page gains URL-driven tab and `owned_by` filter state; clicking an owner row in the new view navigates to the existing list pre-filtered.

**Tech Stack:** Cloudflare Workers + Supabase (worker), React 19 + Vite + Vitest + react-router-dom v7 (admin). All TDD with vitest.

**Reference spec:** `docs/superpowers/specs/2026-05-08-game-owners-summary-design.md`

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `worker/src/admin/games.ts` | modify | Add pure `aggregateOwners()` function and `handleOwnersSummary()` HTTP handler. |
| `worker/src/admin/games.test.ts` | create | Unit tests for `aggregateOwners()`. |
| `worker/src/admin/owners-summary.test.ts` | create | Handler test with mocked supabase. |
| `worker/src/index.ts` | modify | Register `/api/admin/games/owners-summary` route before the generic games matcher. |
| `admin/src/lib/types.ts` | modify | Add `OwnerSummaryRow` type. |
| `admin/src/pages/OwnersSummary.tsx` | create | New component rendering the owners aggregate table (desktop + mobile). |
| `admin/src/pages/OwnersSummary.test.tsx` | create | Tests for rendering and row-click navigation. |
| `admin/src/pages/GamesList.tsx` | modify | Add tab switcher (`?tab=owners`) and `?owned_by=` filter chip. |
| `admin/src/pages/GamesList.test.tsx` | create | Tests for tab routing and owner-filter chip. |

---

## Task 1: Add OwnerSummaryRow type

**Files:**
- Modify: `admin/src/lib/types.ts`

- [ ] **Step 1: Add the type at the bottom of the file**

Append after the existing `UserDetail` interface:

```ts
export interface OwnerSummaryRow {
  owner: string | null;
  total: number;
  with_owner: number;
  with_others: number;
  top_holders: Array<{ name: string; count: number }>;
  more_holders: number;
}
```

- [ ] **Step 2: Type-check passes**

Run: `cd admin && npx tsc -b`
Expected: exits 0 with no errors.

- [ ] **Step 3: Commit**

```bash
git add admin/src/lib/types.ts
git commit -m "feat(admin): add OwnerSummaryRow type"
```

---

## Task 2: Worker — `aggregateOwners` pure function (TDD)

This task extracts the aggregation logic as a pure function so it can be tested without mocking Supabase, matching the existing `aggregateRegistrations` pattern in `worker/src/admin/summary.ts`.

**Files:**
- Test: `worker/src/admin/games.test.ts` (create)
- Modify: `worker/src/admin/games.ts`

- [ ] **Step 1: Write the failing test file**

Create `worker/src/admin/games.test.ts`:

```ts
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
```

Note: Bob and Unowned both have total 2; alphabetical tiebreak puts `Bob` (real name) before `__unowned__` because the implementation will use the display owner string and sort `null` last. That's reflected in the assertion above.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd worker && npm test -- games.test.ts`
Expected: FAIL — "aggregateOwners is not exported" or similar.

- [ ] **Step 3: Implement `aggregateOwners` in `worker/src/admin/games.ts`**

Append to the bottom of `worker/src/admin/games.ts` (after the existing `handleUpdateGame`):

```ts
export interface OwnerGameRow {
  owned_by: string | null;
  currently_with: string | null;
}

export interface OwnerSummary {
  owner: string | null;
  total: number;
  with_owner: number;
  with_others: number;
  top_holders: Array<{ name: string; count: number }>;
  more_holders: number;
}

export function aggregateOwners(games: OwnerGameRow[]): OwnerSummary[] {
  const groups = new Map<
    string,
    {
      display: string | null;
      total: number;
      with_owner: number;
      with_others: number;
      holders: Map<string, number>;
    }
  >();

  for (const g of games) {
    const ownerTrim = (g.owned_by ?? '').trim();
    const key = ownerTrim === '' ? '__unowned__' : ownerTrim;
    const display = ownerTrim === '' ? null : ownerTrim;
    let group = groups.get(key);
    if (!group) {
      group = { display, total: 0, with_owner: 0, with_others: 0, holders: new Map() };
      groups.set(key, group);
    }
    group.total += 1;

    const heldTrim = (g.currently_with ?? '').trim();
    const isWithOwner = heldTrim === '' || (ownerTrim !== '' && heldTrim === ownerTrim);
    if (isWithOwner) {
      group.with_owner += 1;
    } else {
      group.with_others += 1;
      group.holders.set(heldTrim, (group.holders.get(heldTrim) ?? 0) + 1);
    }
  }

  const rows: OwnerSummary[] = [];
  for (const group of groups.values()) {
    const sortedHolders = [...group.holders.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([name, count]) => ({ name, count }));
    const top_holders = sortedHolders.slice(0, 3);
    const more_holders = sortedHolders.length - top_holders.length;
    rows.push({
      owner: group.display,
      total: group.total,
      with_owner: group.with_owner,
      with_others: group.with_others,
      top_holders,
      more_holders,
    });
  }

  rows.sort((a, b) => {
    if (b.total !== a.total) return b.total - a.total;
    // Owner asc with null sorted last
    if (a.owner === null && b.owner === null) return 0;
    if (a.owner === null) return 1;
    if (b.owner === null) return -1;
    return a.owner.localeCompare(b.owner);
  });

  return rows;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd worker && npm test -- games.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 5: Run full worker test suite to make sure nothing else broke**

Run: `cd worker && npm test`
Expected: PASS — all tests green.

- [ ] **Step 6: Commit**

```bash
git add worker/src/admin/games.ts worker/src/admin/games.test.ts
git commit -m "feat(worker): aggregateOwners pure function for owners summary"
```

---

## Task 3: Worker — `handleOwnersSummary` HTTP handler (TDD)

**Files:**
- Test: `worker/src/admin/owners-summary.test.ts` (create)
- Modify: `worker/src/admin/games.ts`

- [ ] **Step 1: Write the failing test file**

Create `worker/src/admin/owners-summary.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd worker && npm test -- owners-summary.test.ts`
Expected: FAIL — `handleOwnersSummary` is not exported.

- [ ] **Step 3: Implement the handler in `worker/src/admin/games.ts`**

Append after `aggregateOwners`:

```ts
export async function handleOwnersSummary(env: Env): Promise<Response> {
  const supabase = getSupabase(env);
  const { data, error } = await supabase.from('games').select('owned_by, currently_with');
  if (error) return jsonResponse({ error: 'Failed to load owners summary' }, 500);
  const owners = aggregateOwners((data ?? []) as OwnerGameRow[]);
  return jsonResponse({ owners });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd worker && npm test -- owners-summary.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 5: Run full worker tests**

Run: `cd worker && npm test`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add worker/src/admin/games.ts worker/src/admin/owners-summary.test.ts
git commit -m "feat(worker): handleOwnersSummary HTTP handler"
```

---

## Task 4: Worker — wire `/api/admin/games/owners-summary` route

The existing games regex `^/api/admin/games(?:/([^/]+))?$` would match `/api/admin/games/owners-summary` and treat `owners-summary` as a game id. The new route MUST be registered BEFORE that block, mirroring how `/api/admin/games/export` is handled.

**Files:**
- Modify: `worker/src/index.ts`

- [ ] **Step 1: Add import**

In `worker/src/index.ts`, find the existing import line:

```ts
import { handleListGames, handleGetGame, handleCreateGame, handleUpdateGame } from './admin/games';
```

Replace with:

```ts
import { handleListGames, handleGetGame, handleCreateGame, handleUpdateGame, handleOwnersSummary } from './admin/games';
```

- [ ] **Step 2: Register the route before the games regex matcher**

Find the existing block:

```ts
          if (!adminResponse && url.pathname === '/api/admin/games/export' && request.method === 'GET') {
            adminResponse = await handleExportGames(request, env);
          }

          if (!adminResponse) {
            const gamesMatch = url.pathname.match(/^\/api\/admin\/games(?:\/([^/]+))?$/);
```

Insert a new check between the export block and the regex match block:

```ts
          if (!adminResponse && url.pathname === '/api/admin/games/export' && request.method === 'GET') {
            adminResponse = await handleExportGames(request, env);
          }

          if (!adminResponse && url.pathname === '/api/admin/games/owners-summary' && request.method === 'GET') {
            adminResponse = await handleOwnersSummary(env);
          }

          if (!adminResponse) {
            const gamesMatch = url.pathname.match(/^\/api\/admin\/games(?:\/([^/]+))?$/);
```

- [ ] **Step 3: Type-check**

Run: `cd worker && npx tsc --noEmit`
Expected: exits 0.

- [ ] **Step 4: Run worker test suite**

Run: `cd worker && npm test`
Expected: all tests pass (router change is structural; existing tests still green).

- [ ] **Step 5: Commit**

```bash
git add worker/src/index.ts
git commit -m "feat(worker): route /api/admin/games/owners-summary"
```

---

## Task 5: Admin — `OwnersSummary` page (TDD)

**Files:**
- Create: `admin/src/pages/OwnersSummary.tsx`
- Create: `admin/src/pages/OwnersSummary.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `admin/src/pages/OwnersSummary.test.tsx`:

```tsx
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import OwnersSummary from './OwnersSummary';

vi.mock('@/lib/api', () => ({
  fetchAdmin: vi.fn(async () => ({
    owners: [
      {
        owner: 'Alice',
        total: 4,
        with_owner: 2,
        with_others: 2,
        top_holders: [{ name: 'Bob', count: 2 }],
        more_holders: 0,
      },
      {
        owner: null,
        total: 1,
        with_owner: 1,
        with_others: 0,
        top_holders: [],
        more_holders: 0,
      },
    ],
  })),
  showApiError: vi.fn(),
}));
vi.mock('@/lib/revalidate', () => ({ useRevalidate: () => {} }));

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/games" element={<div data-testid="games-page">games:{location.search}</div>} />
        <Route path="/owners" element={<OwnersSummary />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('OwnersSummary', () => {
  it('renders owner rows with totals', async () => {
    renderAt('/owners');
    await waitFor(() => expect(screen.getAllByText('Alice').length).toBeGreaterThan(0));
    expect(screen.getAllByText(/Unowned/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText('4').length).toBeGreaterThan(0);
  });

  it('clicking a real-owner row navigates to /games?owned_by=<owner>', async () => {
    renderAt('/owners');
    await waitFor(() => expect(screen.getAllByText('Alice').length).toBeGreaterThan(0));
    const aliceCells = screen.getAllByText('Alice');
    fireEvent.click(aliceCells[0]);
    await waitFor(() => expect(screen.getByTestId('games-page')).toBeInTheDocument());
    expect(screen.getByTestId('games-page').textContent).toContain('owned_by=Alice');
  });

  it('clicking the Unowned row navigates with the __unowned__ sentinel', async () => {
    renderAt('/owners');
    await waitFor(() => expect(screen.getAllByText(/Unowned/i).length).toBeGreaterThan(0));
    const unownedCell = screen.getAllByText(/Unowned/i)[0];
    fireEvent.click(unownedCell);
    await waitFor(() => expect(screen.getByTestId('games-page')).toBeInTheDocument());
    expect(screen.getByTestId('games-page').textContent).toContain('owned_by=__unowned__');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd admin && npm test -- OwnersSummary`
Expected: FAIL — module `./OwnersSummary` not found.

- [ ] **Step 3: Implement `OwnersSummary.tsx`**

Create `admin/src/pages/OwnersSummary.tsx`:

```tsx
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import DataTable, { Column } from '@/components/DataTable';
import MobileCardList, { CardField } from '@/components/MobileCardList';
import { fetchAdmin, showApiError } from '@/lib/api';
import { useRevalidate } from '@/lib/revalidate';
import type { OwnerSummaryRow } from '@/lib/types';

const UNOWNED_SENTINEL = '__unowned__';

function ownerLabel(owner: string | null): string {
  return owner ?? 'Unowned';
}

function formatHolders(row: OwnerSummaryRow): string {
  if (row.top_holders.length === 0) return '—';
  const list = row.top_holders.map((h) => `${h.name} (${h.count})`).join(', ');
  return row.more_holders > 0 ? `${list}, +${row.more_holders} more` : list;
}

export default function OwnersSummary() {
  const [owners, setOwners] = useState<OwnerSummaryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const refresh = useCallback(() => {
    setLoading(true);
    fetchAdmin<{ owners: OwnerSummaryRow[] }>('/api/admin/games/owners-summary')
      .then((r) => setOwners(r.owners))
      .catch(showApiError)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  useRevalidate(refresh);

  function openOwner(row: OwnerSummaryRow) {
    const param = row.owner ?? UNOWNED_SENTINEL;
    navigate(`/games?owned_by=${encodeURIComponent(param)}`);
  }

  const columns: Column<OwnerSummaryRow>[] = [
    {
      key: 'owner', header: 'Owner',
      render: (r) => ownerLabel(r.owner),
      sortable: true,
      sortValue: (r) => ownerLabel(r.owner).toLowerCase(),
    },
    {
      key: 'total', header: 'Total',
      render: (r) => r.total,
      sortable: true, sortValue: (r) => r.total,
    },
    {
      key: 'with_owner', header: 'With owner',
      render: (r) => r.with_owner,
      sortable: true, sortValue: (r) => r.with_owner,
    },
    {
      key: 'with_others', header: 'With others',
      render: (r) => r.with_others,
      sortable: true, sortValue: (r) => r.with_others,
    },
    {
      key: 'currently_with', header: 'Currently with',
      render: (r) => formatHolders(r),
    },
  ];

  const fields: CardField<OwnerSummaryRow>[] = [
    { key: 'owner', render: (r) => ownerLabel(r.owner), primary: true },
    {
      key: 'meta',
      render: (r) => `${r.total} owned · ${r.with_others} with others`,
    },
    {
      key: 'holders',
      render: (r) => formatHolders(r),
    },
  ];

  if (loading) return <p>Loading…</p>;

  return (
    <>
      <div className="md:hidden">
        <MobileCardList
          rows={owners}
          fields={fields}
          rowKey={(r) => r.owner ?? UNOWNED_SENTINEL}
          onRowClick={openOwner}
          emptyMessage="No owners yet."
        />
      </div>
      <div className="hidden md:block">
        <DataTable
          rows={owners}
          columns={columns}
          rowKey={(r) => r.owner ?? UNOWNED_SENTINEL}
          onRowClick={openOwner}
          emptyMessage="No owners yet."
        />
      </div>
    </>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd admin && npm test -- OwnersSummary`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add admin/src/pages/OwnersSummary.tsx admin/src/pages/OwnersSummary.test.tsx
git commit -m "feat(admin): OwnersSummary page with desktop and mobile views"
```

---

## Task 6: Admin — wire tab + owner filter into GamesList (TDD)

This task adds two URL-driven concerns to `GamesList`:

1. `?tab=owners` swaps the rendered list for the new `OwnersSummary` component.
2. `?owned_by=<value>` (only on the All games tab) filters the existing list and shows a removable chip. The sentinel `__unowned__` filters to rows where `owned_by` is null/empty.

**Files:**
- Create: `admin/src/pages/GamesList.test.tsx`
- Modify: `admin/src/pages/GamesList.tsx`

- [ ] **Step 1: Write the failing test**

Create `admin/src/pages/GamesList.test.tsx`:

```tsx
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import GamesList from './GamesList';

const SAMPLE_GAMES = [
  {
    id: 'g1', title: 'Catan', player_count: '3-4', max_players: 4,
    avg_rating: null, weight: null, complexity: null,
    play_time: null, max_play_time: null, length: null,
    owned_by: 'Alice', currently_with: 'Alice',
  },
  {
    id: 'g2', title: 'Wingspan', player_count: '1-5', max_players: 5,
    avg_rating: null, weight: null, complexity: null,
    play_time: null, max_play_time: null, length: null,
    owned_by: 'Bob', currently_with: null,
  },
  {
    id: 'g3', title: 'Mystery Game', player_count: '2', max_players: 2,
    avg_rating: null, weight: null, complexity: null,
    play_time: null, max_play_time: null, length: null,
    owned_by: null, currently_with: null,
  },
];

vi.mock('@/lib/api', () => ({
  fetchAdmin: vi.fn(async (path: string) => {
    if (path === '/api/admin/games') return { games: SAMPLE_GAMES };
    if (path === '/api/admin/games/owners-summary') {
      return {
        owners: [
          { owner: 'Alice', total: 1, with_owner: 1, with_others: 0, top_holders: [], more_holders: 0 },
          { owner: 'Bob', total: 1, with_owner: 1, with_others: 0, top_holders: [], more_holders: 0 },
          { owner: null, total: 1, with_owner: 1, with_others: 0, top_holders: [], more_holders: 0 },
        ],
      };
    }
    return {};
  }),
  showApiError: vi.fn(),
}));
vi.mock('@/lib/revalidate', () => ({ useRevalidate: () => {} }));

describe('GamesList', () => {
  it('renders all games by default', async () => {
    render(<MemoryRouter initialEntries={['/games']}><GamesList /></MemoryRouter>);
    await waitFor(() => expect(screen.getAllByText('Catan').length).toBeGreaterThan(0));
    expect(screen.getAllByText('Wingspan').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Mystery Game').length).toBeGreaterThan(0);
  });

  it('?owned_by=Alice filters rows and shows a clearable chip', async () => {
    render(<MemoryRouter initialEntries={['/games?owned_by=Alice']}><GamesList /></MemoryRouter>);
    await waitFor(() => expect(screen.getAllByText('Catan').length).toBeGreaterThan(0));
    expect(screen.queryByText('Wingspan')).toBeNull();
    expect(screen.queryByText('Mystery Game')).toBeNull();
    const chip = screen.getByTestId('owned-by-chip');
    expect(chip.textContent).toMatch(/Alice/);

    fireEvent.click(screen.getByTestId('owned-by-chip-clear'));
    await waitFor(() => expect(screen.getAllByText('Wingspan').length).toBeGreaterThan(0));
    expect(screen.queryByTestId('owned-by-chip')).toBeNull();
  });

  it('?owned_by=__unowned__ filters to games with null/empty owned_by', async () => {
    render(<MemoryRouter initialEntries={['/games?owned_by=__unowned__']}><GamesList /></MemoryRouter>);
    await waitFor(() => expect(screen.getAllByText('Mystery Game').length).toBeGreaterThan(0));
    expect(screen.queryByText('Catan')).toBeNull();
    expect(screen.queryByText('Wingspan')).toBeNull();
    expect(screen.getByTestId('owned-by-chip').textContent).toMatch(/Unowned/i);
  });

  it('?tab=owners renders the OwnersSummary view instead of the games list', async () => {
    render(<MemoryRouter initialEntries={['/games?tab=owners']}><GamesList /></MemoryRouter>);
    await waitFor(() => expect(screen.getAllByText('Alice').length).toBeGreaterThan(0));
    expect(screen.queryByText('Catan')).toBeNull();
    expect(screen.queryByText('Wingspan')).toBeNull();
  });

  it('switching tabs updates the URL', async () => {
    render(<MemoryRouter initialEntries={['/games']}><GamesList /></MemoryRouter>);
    await waitFor(() => expect(screen.getAllByText('Catan').length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole('tab', { name: /owners/i }));
    await waitFor(() => expect(screen.getAllByText('Bob').length).toBeGreaterThan(0));
    expect(screen.queryByText('Catan')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd admin && npm test -- GamesList`
Expected: FAIL — chip test ids don't exist; tab role doesn't exist.

- [ ] **Step 3: Modify `GamesList.tsx`**

This is the most invasive change. Replace the entire `admin/src/pages/GamesList.tsx` with the version below. (Read the existing file first to confirm it matches the structure assumed here; the changes vs. the existing version are: import `useSearchParams` and `OwnersSummary`, derive `tab` and `ownerFilter` from the URL, add `applyOwnerFilter` to `filtered`, render a tab switcher above the toolbar, render the chip, and short-circuit to `<OwnersSummary />` when `tab === 'owners'`.)

```tsx
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import DataTable, { Column } from '@/components/DataTable';
import MobileCardList, { CardField } from '@/components/MobileCardList';
import { BulkActionBar, type BulkAction } from '@/components/BulkActionBar';
import { fetchAdmin, showApiError } from '@/lib/api';
import { useRevalidate } from '@/lib/revalidate';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { Game } from '@/lib/types';
import OwnersSummary from './OwnersSummary';

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '';
const UNOWNED_SENTINEL = '__unowned__';

export default function GamesList() {
  const [games, setGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [withFilter, setWithFilter] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkUpdateOpen, setBulkUpdateOpen] = useState(false);
  const [bulkUpdateValue, setBulkUpdateValue] = useState('');
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get('tab') === 'owners' ? 'owners' : 'all';
  const ownerFilter = tab === 'all' ? searchParams.get('owned_by') : null;

  const refresh = useCallback(() => {
    setLoading(true);
    fetchAdmin<{ games: Game[] }>('/api/admin/games')
      .then((r) => setGames(r.games))
      .catch(showApiError)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  useRevalidate(refresh);

  const filtered = useMemo(() => {
    const s = search.toLowerCase().trim();
    const w = withFilter.toLowerCase().trim();
    return games.filter((g) => {
      if (s && !g.title.toLowerCase().includes(s)) return false;
      if (w && !(g.currently_with || '').toLowerCase().includes(w)) return false;
      if (ownerFilter !== null) {
        const ownerTrim = (g.owned_by ?? '').trim();
        if (ownerFilter === UNOWNED_SENTINEL) {
          if (ownerTrim !== '') return false;
        } else if (ownerTrim !== ownerFilter) {
          return false;
        }
      }
      return true;
    });
  }, [games, search, withFilter, ownerFilter]);

  function setTab(next: 'all' | 'owners') {
    const params = new URLSearchParams(searchParams);
    if (next === 'owners') {
      params.set('tab', 'owners');
      params.delete('owned_by'); // owner filter only applies on the all-games tab
    } else {
      params.delete('tab');
    }
    setSearchParams(params, { replace: true });
  }

  function clearOwnerFilter() {
    const params = new URLSearchParams(searchParams);
    params.delete('owned_by');
    setSearchParams(params, { replace: true });
  }

  // ---- Inline currently_with edit (desktop) ----
  async function updateCurrentlyWith(game: Game, next: string | null) {
    const prev = game.currently_with ?? null;
    setGames((rows) => rows.map((g) => g.id === game.id ? { ...g, currently_with: next } : g));
    try {
      await fetchAdmin(`/api/admin/games/${game.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ currently_with: next }),
      });
    } catch (e) {
      setGames((rows) => rows.map((g) => g.id === game.id ? { ...g, currently_with: prev } : g));
      showApiError(e);
    }
  }

  // ---- Bulk operations ----
  async function bulkUpdateCurrentlyWith() {
    const ids = [...selectedIds];
    const value = bulkUpdateValue.trim();
    const next = value === '' ? null : value;
    setBulkUpdateOpen(false);
    if (ids.length === 0) return;
    const results = await Promise.allSettled(
      ids.map((id) =>
        fetchAdmin(`/api/admin/games/${id}`, {
          method: 'PATCH',
          body: JSON.stringify({ currently_with: next }),
        }),
      ),
    );
    const failed = results.filter((r) => r.status === 'rejected').length;
    if (failed > 0) toast.error(`${failed} update${failed === 1 ? '' : 's'} failed`);
    else toast.success(`Updated ${ids.length} game${ids.length === 1 ? '' : 's'}`);
    setSelectedIds([]);
    setBulkUpdateValue('');
    refresh();
  }

  function bulkExportCsv() {
    if (selectedIds.length === 0) return;
    window.location.href = `${API_BASE}/api/admin/games/export?ids=${encodeURIComponent(selectedIds.join(','))}`;
  }

  const bulkActions: BulkAction[] = [
    { label: 'Update "Currently with"', onClick: () => setBulkUpdateOpen(true) },
    { label: 'Export CSV', onClick: bulkExportCsv },
  ];

  const columns: Column<Game>[] = [
    {
      key: 'title', header: 'Title', render: (g) => g.title,
      sortable: true, sortValue: (g) => g.title.toLowerCase(),
    },
    { key: 'players', header: 'Players', render: (g) => g.player_count || '—' },
    { key: 'complexity', header: 'Complexity', render: (g) => g.complexity || '—' },
    { key: 'owned_by', header: 'Owned by', render: (g) => g.owned_by || '—' },
    {
      key: 'currently_with',
      header: 'Currently with',
      render: (g) => (
        <CurrentlyWithCell
          game={g}
          onChange={(next) => updateCurrentlyWith(g, next)}
        />
      ),
      sortable: true,
      sortValue: (g) => (g.currently_with ?? '').toLowerCase(),
    },
  ];

  const fields: CardField<Game>[] = [
    { key: 'title', render: (g) => g.title, primary: true },
    { key: 'meta', render: (g) => `${g.player_count || '—'} · ${g.complexity || '—'}` },
  ];

  const ownerChipLabel = ownerFilter === UNOWNED_SENTINEL ? 'Unowned' : ownerFilter;

  return (
    <div>
      <div role="tablist" className="flex gap-1 mb-3 border-b">
        <button
          role="tab"
          aria-selected={tab === 'all'}
          onClick={() => setTab('all')}
          className={cn(
            'px-3 py-2 text-sm border-b-2 -mb-px',
            tab === 'all' ? 'border-primary font-medium' : 'border-transparent text-muted-foreground',
          )}
        >
          All games
        </button>
        <button
          role="tab"
          aria-selected={tab === 'owners'}
          onClick={() => setTab('owners')}
          className={cn(
            'px-3 py-2 text-sm border-b-2 -mb-px',
            tab === 'owners' ? 'border-primary font-medium' : 'border-transparent text-muted-foreground',
          )}
        >
          Owners
        </button>
      </div>

      {tab === 'owners' ? (
        <OwnersSummary />
      ) : (
        <>
          {ownerFilter !== null && (
            <div className="mb-3">
              <span
                data-testid="owned-by-chip"
                className="inline-flex items-center gap-1 rounded-full bg-muted px-3 py-1 text-sm"
              >
                Owner: {ownerChipLabel}
                <button
                  data-testid="owned-by-chip-clear"
                  aria-label="Clear owner filter"
                  className="hover:bg-background rounded-full p-0.5"
                  onClick={clearOwnerFilter}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            </div>
          )}

          <div className="flex flex-wrap gap-2 mb-3">
            <Input
              className="max-w-xs"
              placeholder="Search title"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <Input
              className="max-w-xs"
              placeholder="Currently with"
              value={withFilter}
              onChange={(e) => setWithFilter(e.target.value)}
            />
          </div>

          {loading ? <p>Loading…</p> : (
            <>
              <div className="md:hidden">
                <MobileCardList
                  rows={filtered}
                  fields={fields}
                  rowKey={(g) => g.id}
                  onRowClick={(g) => navigate(`/games/${g.id}`)}
                  emptyMessage="No games match."
                  trailing={(g) => (
                    <span className="text-xs text-muted-foreground">
                      {g.currently_with || '—'}
                    </span>
                  )}
                />
              </div>
              <div className="hidden md:block">
                <BulkActionBar
                  count={selectedIds.length}
                  actions={bulkActions}
                  onClear={() => setSelectedIds([])}
                />
                <DataTable
                  rows={filtered}
                  columns={columns}
                  rowKey={(g) => g.id}
                  onRowClick={(g) => navigate(`/games/${g.id}`)}
                  emptyMessage="No games match."
                  selectable
                  selectedIds={selectedIds}
                  onSelectedIdsChange={setSelectedIds}
                />
              </div>
            </>
          )}

          <Link
            to="/games/new"
            className="md:hidden fixed right-4 bottom-20 z-30 h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center"
            style={{ bottom: 'calc(5rem + env(safe-area-inset-bottom))' }}
            aria-label="Add game"
          >
            <Plus className="h-6 w-6" />
          </Link>

          <Dialog open={bulkUpdateOpen} onOpenChange={setBulkUpdateOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Update "Currently with" for {selectedIds.length} games</DialogTitle>
              </DialogHeader>
              <div className="py-2">
                <Input
                  autoFocus
                  placeholder="Name (leave blank to clear)"
                  value={bulkUpdateValue}
                  onChange={(e) => setBulkUpdateValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') bulkUpdateCurrentlyWith();
                  }}
                />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setBulkUpdateOpen(false)}>Cancel</Button>
                <Button onClick={bulkUpdateCurrentlyWith}>OK</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      )}
    </div>
  );
}

function CurrentlyWithCell({ game, onChange }: { game: Game; onChange: (next: string | null) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(game.currently_with || '');
  if (!editing) {
    return (
      <button
        className="text-left hover:underline"
        onClick={(e) => {
          e.stopPropagation();
          setEditing(true);
          setValue(game.currently_with || '');
        }}
      >
        {game.currently_with || '—'}
      </button>
    );
  }
  function commit() {
    setEditing(false);
    const next = value || null;
    const prev = game.currently_with || null;
    if (next !== prev) onChange(next);
  }
  return (
    <Input
      autoFocus
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        else if (e.key === 'Escape') {
          setEditing(false);
          setValue(game.currently_with || '');
        }
      }}
      onClick={(e) => e.stopPropagation()}
      className="h-7 text-xs"
    />
  );
}
```

Important compatibility note: read the existing `GamesList.tsx` before pasting. The `MobileCardList` and `Dialog` blocks above mirror the existing implementation; if there are subtle differences (extra props, different toolbar markup) preserve the current behaviour and only add the new pieces.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd admin && npm test -- GamesList`
Expected: PASS — 5 tests.

- [ ] **Step 5: Run full admin test suite**

Run: `cd admin && npm test`
Expected: all admin tests pass.

- [ ] **Step 6: Type-check**

Run: `cd admin && npx tsc -b`
Expected: exits 0.

- [ ] **Step 7: Commit**

```bash
git add admin/src/pages/GamesList.tsx admin/src/pages/GamesList.test.tsx
git commit -m "feat(admin): add Owners tab and owner filter to Games page"
```

---

## Task 7: Manual verification

- [ ] **Step 1: Run worker locally**

Run: `cd worker && npm run dev`
Expected: worker starts on `:8787`.

- [ ] **Step 2: Run admin locally in another terminal**

Run: `cd admin && npm run dev`
Expected: admin opens at the printed URL.

- [ ] **Step 3: Smoke-test the feature**

In the browser, with admin auth set up:

1. Navigate to `/games` — confirm "All games" tab is active and the existing list renders.
2. Click the "Owners" tab — URL becomes `/games?tab=owners`, owner rows appear with totals.
3. Click an owner row — URL becomes `/games?owned_by=<owner>`, list filters, chip appears.
4. Click the chip's × — chip disappears, full list returns.
5. Visit `/games?owned_by=__unowned__` directly (or via the Unowned row if present) — confirm only games with no owner are shown and the chip reads "Owner: Unowned".
6. Confirm mobile (responsive view) shows card layout for both tabs and rows are tappable.

- [ ] **Step 4: Final tests**

Run: `cd worker && npm test && cd ../admin && npm test`
Expected: all tests pass.

---

## Self-Review Notes

- **Spec coverage:** Tabs (Task 6), Owner column + counts + currently-with breakdown (Tasks 2, 5), drill-in via URL filter (Task 6), mobile parity (Task 5), Unowned bucketing (Tasks 2, 5, 6), endpoint contract (Tasks 2-4), tests at all layers (Tasks 2, 3, 5, 6).
- **Type consistency:** `OwnerSummaryRow` (admin) and `OwnerSummary` (worker) share the same field names and shapes; the worker emits the JSON the admin expects.
- **Sentinel consistency:** `__unowned__` is used in URL params (Tasks 5, 6) and is reserved — it is never a real owner name in any test fixture.
- **Router ordering:** Task 4 explicitly inserts the new path before the games regex matcher to avoid `owners-summary` being treated as a game id.
