# Event Price-Includes Banner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a nullable `events.price_includes` text column and surface its value as a small yellow banner on calendar event cards (`EventList.tsx` → `EventCard`) and in the registration page header (`RegistrationForm.tsx`), per `docs/superpowers/specs/2026-04-30-event-price-includes.md`.

**Architecture:** Browser-only feature. Events are read directly from Supabase via the anon key + RLS, so `select('*')` automatically returns the new column once the migration runs — no Worker changes needed. The banner is inlined in two places (no new component yet) since it's only ~6 lines of JSX.

**Tech Stack:** Astro 5 · React 19 islands · Tailwind 4 · Supabase JS · Supabase MCP for the migration

**Verification approach:** This codebase has no unit-test framework. Tasks verify with: (1) `npx astro check` for type errors, (2) `npm run dev` + browser inspection at `/calendar` and `/register?event=<id>`, and (3) toggling the column in Supabase Studio between a string value and NULL to confirm both render states.

---

## File Map

**New:**
- `supabase/migrations/005_event_price_includes.sql` — adds nullable `price_includes` column to `events`

**Modified:**
- `src/lib/types.ts` — adds `price_includes: string | null` to the `Event` interface
- `src/components/EventList.tsx` — adds banner inside `EventCard`, between the price/spots row and the action button
- `src/components/RegistrationForm.tsx` — adds banner inside the event header wrapper, after the price/spots row

---

## Task 1: Apply the database migration

**Why first:** The frontend type and consumers all reference the new column. Adding it first means the rest of the work can land without coordination.

**Files:**
- Create: `supabase/migrations/005_event_price_includes.sql`

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/005_event_price_includes.sql`:

```sql
-- Optional inclusion text shown on calendar cards and the registration page header.
alter table events add column price_includes text;
```

- [ ] **Step 2: Apply the migration via Supabase MCP**

Use the Supabase MCP `apply_migration` tool with project ref `yhgtwqdsnrslcgdvmunz`, name `event_price_includes`, and the SQL from Step 1. Do NOT use psql or Supabase Studio — use the MCP tool so the migration is recorded.

- [ ] **Step 3: Verify the column exists**

Run via Supabase MCP `execute_sql`:

```sql
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'events'
  and column_name = 'price_includes';
```

Expected: 1 row, `data_type = text`, `is_nullable = YES`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/005_event_price_includes.sql
git commit -m "feat(db): add price_includes column to events"
```

---

## Task 2: Update the `Event` type

**Why second:** Both `EventList.tsx` and `RegistrationForm.tsx` import this interface. Updating it first means the consumer edits won't trigger spurious type errors.

**Files:**
- Modify: `src/lib/types.ts`

- [ ] **Step 1: Add the field to the `Event` interface**

In `src/lib/types.ts`, find the `Event` interface (lines 14–26). Add `price_includes: string | null;` immediately after `custom_questions`:

```ts
export interface Event {
  id: string;
  name: string;
  description: string;
  date: string;
  venue_name: string;
  venue_area: string;
  price: number;
  capacity: number;
  custom_questions: CustomQuestion[] | null;
  price_includes: string | null;
  is_published: boolean;
  created_at: string;
}
```

- [ ] **Step 2: Verify types**

Run: `npx astro check`

Expected: 0 NEW errors. (The 3 pre-existing Worker errors about `request.json<T>()` are unrelated and present from before this task.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/types.ts
git commit -m "feat: add price_includes to Event type"
```

---

## Task 3: Render the banner on calendar event cards

**Files:**
- Modify: `src/components/EventList.tsx`

- [ ] **Step 1: Add the banner inside `EventCard`**

In `src/components/EventList.tsx`, find the `EventCard` function. Locate the price/spots-left row (around lines 121–128):

```tsx
<div className="flex items-center gap-3 mt-2">
  <span className="font-heading font-bold text-xl">₹{event.price}</span>
  {event.remaining !== null && !soldOut && (
    <span className="text-xs text-[#1A1A1A]/60">
      {event.remaining} spot{event.remaining !== 1 ? 's' : ''} left
    </span>
  )}
</div>
<div className="mt-3">
```

Add the banner immediately after the closing `</div>` of the price row and BEFORE the `<div className="mt-3">` wrapper that holds the Sold Out / Register button:

```tsx
<div className="flex items-center gap-3 mt-2">
  <span className="font-heading font-bold text-xl">₹{event.price}</span>
  {event.remaining !== null && !soldOut && (
    <span className="text-xs text-[#1A1A1A]/60">
      {event.remaining} spot{event.remaining !== 1 ? 's' : ''} left
    </span>
  )}
</div>
{event.price_includes && (
  <div className="card-brutal px-3 py-2 text-sm mt-2" style={{ background: '#FFD166', boxShadow: '3px 3px 0 #1A1A1A' }}>
    <span className="font-heading font-semibold">✨ {event.price_includes}</span>
  </div>
)}
<div className="mt-3">
```

The truthy check `event.price_includes && ...` covers both NULL and empty-string cases (renders nothing).

- [ ] **Step 2: Verify types**

Run: `npx astro check`

Expected: 0 NEW errors.

- [ ] **Step 3: Manually verify in browser**

In a separate terminal, ensure dev server is running: `npm run dev`

Set `price_includes` to a test value on one published event via Supabase MCP `execute_sql`:

```sql
update events set price_includes = 'Includes ₹500 bar credit + welcome tea'
where id = (select id from events where is_published = true and date >= now() order by date asc limit 1)
returning id, name, price_includes;
```

Visit `http://localhost:4321/calendar`. Expected:
- The event whose row was updated shows the yellow banner under its price.
- All OTHER event cards (price_includes still NULL) show no banner.

- [ ] **Step 4: Commit**

```bash
git add src/components/EventList.tsx
git commit -m "feat(calendar): show price-includes banner on event cards"
```

---

## Task 4: Render the banner on the registration page header

**Files:**
- Modify: `src/components/RegistrationForm.tsx`

- [ ] **Step 1: Add the banner inside the event header wrapper**

In `src/components/RegistrationForm.tsx`, find the event header block (around lines 232–258). The relevant region is:

```tsx
<div className="mb-6 pb-6" style={{ borderBottom: '3px solid #1A1A1A' }}>
  <h1 className="font-heading text-2xl font-bold">{event.name}</h1>
  <p className="text-[#1A1A1A]/70 text-sm mt-1">
    {/* date + time + venue */}
  </p>
  <div className="flex items-center gap-3 mt-3">
    <span className="font-heading font-bold text-lg">₹{event.price} / person</span>
    {spots && (
      <span className="text-xs text-[#1A1A1A]/60">
        {spots.remaining} spot{spots.remaining !== 1 ? 's' : ''} remaining
      </span>
    )}
  </div>
</div>
```

Add the banner immediately after the closing `</div>` of the price/spots row (line ~257) but BEFORE the wrapper `</div>` (line ~258) — so the banner sits inside the bordered header block:

```tsx
  <div className="flex items-center gap-3 mt-3">
    <span className="font-heading font-bold text-lg">₹{event.price} / person</span>
    {spots && (
      <span className="text-xs text-[#1A1A1A]/60">
        {spots.remaining} spot{spots.remaining !== 1 ? 's' : ''} remaining
      </span>
    )}
  </div>
  {event.price_includes && (
    <div className="card-brutal px-3 py-2 text-sm mt-3" style={{ background: '#FFD166', boxShadow: '3px 3px 0 #1A1A1A' }}>
      <span className="font-heading font-semibold">✨ {event.price_includes}</span>
    </div>
  )}
</div>
```

Note `mt-3` here (vs `mt-2` in `EventList.tsx`) because the registration header has more vertical breathing room. The element styling is otherwise identical.

- [ ] **Step 2: Verify types**

Run: `npx astro check`

Expected: 0 NEW errors.

- [ ] **Step 3: Manually verify in browser**

Visit `http://localhost:4321/register?event=<the_id_set_in_task_3>` (use the same event id you updated in Task 3 step 3).

Expected: The yellow banner appears in the header block, between the price line and the form fields. Visit `/register?event=<some_other_event_id>` and confirm no banner.

- [ ] **Step 4: Reset the test value (cleanup)**

Reset the test event's `price_includes` to NULL via Supabase MCP `execute_sql`:

```sql
update events set price_includes = null where id = '<event_id_from_task_3>';
```

Refresh both `/calendar` and `/register?event=<that_id>` — both banners should disappear.

- [ ] **Step 5: Commit**

```bash
git add src/components/RegistrationForm.tsx
git commit -m "feat(register): show price-includes banner in event header"
```
