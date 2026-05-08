# Game Owners Summary — Design Spec

**Date:** 2026-05-08
**Surface:** Admin app (`admin.boardgamecompany.in`)
**Feature scope:** Read-only summary view of board-game owners aggregated from the `games` table.

## Problem

The `games` table tracks each game's `owned_by` (the person who owns it) and `currently_with` (who has it at the moment) as free-text columns. Admins currently have no way to ask: *"How many games does each owner have, and where are those games right now?"* Today they would have to scan the games list manually.

## Goals

- Show one row per distinct game owner with totals and a "currently with" breakdown.
- Drill into a specific owner to see their games, reusing the existing All Games view.
- Keep the feature co-located with the games library (no new sidebar entry).

## Non-goals

- Editing owners across multiple games at once.
- Linking owners to the registered `users` table — `owned_by` remains free-text.
- Tracking history of who had a game when — only the current `currently_with` snapshot is summarized.

## UX

### Placement

The Games page (`/games`) gains a tab switcher near the top:

- **All games** (default) — existing list, unchanged.
- **Owners** — new aggregate view.

The active tab is reflected in the URL via `?tab=owners` so links are shareable. Default (no param) is All games.

### Owners tab

Table columns (desktop) / card fields (mobile):

| Column        | Source                                                                  |
|---------------|-------------------------------------------------------------------------|
| Owner         | `games.owned_by`. Null/empty bucketed as a single row labelled `Unowned`. |
| Total         | Count of games for that owner.                                          |
| With owner    | Count where `currently_with = owned_by` OR `currently_with` is null/empty. |
| With others   | Count where `currently_with` is set and differs from `owned_by`.        |
| Currently with | Top 3 distinct `currently_with` values that differ from owner, formatted as `Alice (2), Bob (1)`, with `+N more` suffix if more than 3. Empty cell when "With others" is 0. |

Sort: by `Total` descending by default. The existing `DataTable` sortable columns can be reused so admins can sort by other columns too.

### Drill-in

Clicking an owner row navigates to `/games?owned_by=<owner>` (using the literal sentinel `__unowned__` for the Unowned bucket). The Games page reads that param, switches to the **All games** tab, and:

- Filters the displayed games to only those matching that owner (or null/empty for `__unowned__`).
- Renders a removable chip near the search/filter row: `Owner: Alice ×`. Clicking × removes the URL param and clears the filter.

The filter is client-side; the existing list endpoint already returns every game.

### Mobile

Mirrors other admin list pages: `MobileCardList` with primary line = owner name, secondary line summarizing counts (e.g. `12 owned · 3 with others`), and the same row-click behaviour.

## Backend

### New endpoint

`GET /api/admin/games/owners-summary`

- Auth: standard admin gate, identical to other `/api/admin/*` endpoints.
- Implementation: a new handler `handleOwnersSummary` in `worker/src/admin/games.ts`, wired into the admin router alongside the other games handlers.
- Logic: load all rows from `games` (the table is ~130 rows; full scan is cheap). Aggregate in memory:
  1. Group by `owned_by` (trimmed). Treat null and empty-after-trim as the sentinel key `__unowned__`.
  2. For each group, compute:
     - `total` — number of games in the group.
     - `with_owner` — count where the (trimmed) `currently_with` is null/empty OR equals the (trimmed) `owned_by`.
     - `with_others` — count where (trimmed) `currently_with` is non-empty and differs from (trimmed) `owned_by`.
     - `holders` — frequency map of `currently_with` values that contribute to `with_others`.
  3. From `holders`, take the top 3 by count (tiebreak alphabetical), and compute `more_holders = total_distinct_holders - returned_top_holders`.
- Output sorted by `total` desc, then `owner` alphabetical for stable ordering. The Unowned bucket sorts by total like any other row (no special pinning).

### Response shape

```ts
type OwnerSummaryRow = {
  owner: string | null;          // null only for the Unowned bucket
  total: number;
  with_owner: number;
  with_others: number;
  top_holders: Array<{ name: string; count: number }>;
  more_holders: number;          // distinct holders not in top_holders
};

type OwnersSummaryResponse = {
  owners: OwnerSummaryRow[];
};
```

The frontend renders `owner === null` as the literal label `Unowned`.

### Rationale for in-memory aggregation

The games table is small and bounded by physical inventory (~130 rows currently, unlikely to exceed a few hundred). A single `select *` plus JS aggregation keeps the endpoint trivially testable, avoids Postgres-side grouping that would otherwise need a custom SQL function or view, and matches existing admin endpoints that already select all games.

## Frontend

### Files

- **Modify** `admin/src/pages/GamesList.tsx`:
  - Add tab state derived from `?tab` URL search param.
  - Render existing list when tab is `all`; render `<OwnersSummary />` when `owners`.
  - When tab is `all`, read the `owned_by` URL search param. If set, filter the loaded `games` array client-side and render the removable chip above the list.
- **Add** `admin/src/pages/OwnersSummary.tsx`:
  - Fetches `/api/admin/games/owners-summary` via `fetchAdmin`.
  - Renders `DataTable` (desktop) and `MobileCardList` (mobile) using `OwnerSummaryRow[]`.
  - Reuses `useRevalidate` for refresh-on-focus consistency.
  - Row click: `navigate('/games?owned_by=' + encodeURIComponent(row.owner ?? '__unowned__'))`.
- **Modify** `admin/src/lib/types.ts`: add `OwnerSummaryRow` type.

### URL contract summary

| URL                                | Behaviour                                                |
|------------------------------------|----------------------------------------------------------|
| `/games`                           | All games tab, no filter (default).                      |
| `/games?tab=owners`                | Owners tab.                                              |
| `/games?owned_by=Alice`            | All games tab filtered to `owned_by = "Alice"`.          |
| `/games?owned_by=__unowned__`      | All games tab filtered to rows where `owned_by` is null/empty. |

`tab` and `owned_by` are independent params. `owned_by` is honoured only on the All games tab — switching to Owners drops it from the URL.

## Tests

### Worker

Extend an existing test file or add `worker/src/admin/games.test.ts` covering the owners-summary handler with seeded fixtures:

- A normal owner with multiple games, some at home, some loaned out.
- An owner whose games are all at home (`with_others = 0`, empty `top_holders`).
- A game whose `currently_with` differs from `owned_by` — counted in `with_others` and surfaces in `top_holders`.
- Null/empty `owned_by` bucketed as a single Unowned row with the right counts.
- More than 3 distinct holders → `top_holders` truncated to 3 by count, remainder reported via `more_holders`.
- Whitespace handling: `owned_by = " Alice "` and `owned_by = "Alice"` collapse to one row.

### Admin

- `admin/src/pages/OwnersSummary.test.tsx`:
  - Renders rows from a mocked `fetchAdmin` response.
  - Click on a row navigates to `/games?owned_by=<encoded owner>`.
  - Unowned row navigates to `/games?owned_by=__unowned__`.
- `admin/src/pages/GamesList.test.tsx` (extend if exists, otherwise add):
  - With `?owned_by=Alice` in the URL, only Alice's games render and the filter chip is visible.
  - Clicking the chip's × clears the param and shows all games.
  - With `?tab=owners`, the OwnersSummary view renders instead of the all-games list.

## Open questions

None — design is approved as of 2026-05-08.
