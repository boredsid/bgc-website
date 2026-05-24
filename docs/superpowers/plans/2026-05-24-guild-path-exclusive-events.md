# Guild Path Exclusive Events Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-event "Guild Path Exclusive" flag, surfaced as an admin toggle, a badge on public event listings, and a gate on the registration flow that blocks non-members and routes them to `/guild-path`. Enforced server-side in the worker register handler.

**Architecture:** Adds one boolean column on `events` (migration 013). Admin toggle in `EventDrawer.tsx`; worker `events.ts` passes the field through. Public site reads the field from Supabase, shows a badge on cards and the register-page header, and after the existing `/api/lookup-phone` call replaces the rest of the form with a Guild Path CTA when the user isn't a current member. Worker `POST /api/register` enforces with a 403 — defense in depth. Admin manual-registration bypasses the gate with a yellow warning.

**Tech Stack:** Supabase (Postgres + RLS), Astro 5 + React 19, Cloudflare Worker (Vitest), Tailwind CSS 4, shadcn/ui (admin), TypeScript.

---

## Spec

See `docs/superpowers/specs/2026-05-24-guild-path-exclusive-events-design.md`.

---

## File touch list

- **Create:** `supabase/migrations/013_event_guild_exclusive.sql`
- **Modify:** `src/lib/types.ts` (extend `Event` interface)
- **Modify:** `admin/src/lib/types.ts` (extend `Event` interface)
- **Modify:** `worker/src/admin/events.ts` (add `guild_path_exclusive` to allowed fields)
- **Modify:** `worker/src/register.ts` (add gate check between membership lookup and pricing)
- **Modify:** `worker/src/register.test.ts` (new cases + update existing event mock)
- **Modify:** `admin/src/pages/EventDrawer.tsx` (new toggle + initial state)
- **Modify:** `admin/src/pages/ManualRegistrationDrawer.tsx` (warning banner when non-member + exclusive event)
- **Modify:** `src/components/EventList.tsx` (badge on `EventCard`)
- **Modify:** `src/components/RegistrationForm.tsx` (header badge + gate UI replacing the form when blocked)

---

## Task 1: Migration — add `guild_path_exclusive` column

**Files:**
- Create: `supabase/migrations/013_event_guild_exclusive.sql`

- [ ] **Step 1: Write the migration SQL**

Create `supabase/migrations/013_event_guild_exclusive.sql`:

```sql
-- Guild Path Exclusive events: when true, only active Guild Path members
-- can register via the public site. Server-enforced in the worker.
alter table events
  add column guild_path_exclusive boolean not null default false;
```

- [ ] **Step 2: Apply the migration to Supabase**

Apply via the Supabase MCP `apply_migration` tool against project `yhgtwqdsnrslcgdvmunz`. Migration name: `013_event_guild_exclusive`. Query: the full SQL block above.

After applying, sanity-check by querying:

```sql
select column_name, data_type, column_default, is_nullable
from information_schema.columns
where table_name = 'events' and column_name = 'guild_path_exclusive';
```

Expected: one row, `boolean`, default `false`, `is_nullable = NO`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/013_event_guild_exclusive.sql
git commit -m "migration: add events.guild_path_exclusive"
```

---

## Task 2: Extend `Event` types in site and admin

**Files:**
- Modify: `src/lib/types.ts`
- Modify: `admin/src/lib/types.ts`

- [ ] **Step 1: Add field to public-site `Event`**

In `src/lib/types.ts`, find the `Event` interface and add `guild_path_exclusive: boolean;` just before `created_at`:

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
  llm_notes: string | null;
  is_published: boolean;
  guild_path_exclusive: boolean;
  created_at: string;
}
```

- [ ] **Step 2: Add field to admin `Event`**

In `admin/src/lib/types.ts`, add the same field to the admin `Event` interface:

```ts
export interface Event {
  id: string;
  name: string;
  description: string | null;
  date: string;
  venue_name: string | null;
  venue_area: string | null;
  price: number;
  capacity: number;
  custom_questions: CustomQuestion[] | null;
  price_includes: string | null;
  llm_notes: string | null;
  is_published: boolean;
  guild_path_exclusive: boolean;
  created_at: string;
}
```

- [ ] **Step 3: Type-check both projects**

Run from repo root:

```bash
npm run astro -- check 2>&1 | tail -20
```

Expected: no new errors related to `Event` (pre-existing errors elsewhere are OK).

Then:

```bash
cd admin && npx tsc --noEmit 2>&1 | tail -20
```

Expected: no errors. If `tsc` reports the field missing somewhere, fix that consumer in the relevant later task — note it.

- [ ] **Step 4: Commit**

```bash
git add src/lib/types.ts admin/src/lib/types.ts
git commit -m "types: add guild_path_exclusive to Event"
```

---

## Task 3: Admin worker — accept `guild_path_exclusive` in events payload

**Files:**
- Modify: `worker/src/admin/events.ts:27-30`

- [ ] **Step 1: Add field to `EVENT_FIELDS`**

In `worker/src/admin/events.ts`, edit the `EVENT_FIELDS` array (around line 27):

```ts
const EVENT_FIELDS = [
  'name', 'description', 'date', 'venue_name', 'venue_area',
  'price', 'capacity', 'custom_questions', 'price_includes', 'llm_notes', 'is_published',
  'guild_path_exclusive',
] as const;
```

No additional validator branch is needed — boolean coercion through Supabase is fine, and the field's NOT NULL DEFAULT FALSE in the DB makes omission safe.

- [ ] **Step 2: Run worker tests**

```bash
cd worker && npm test 2>&1 | tail -20
```

Expected: all tests still pass (no test asserts the exact field list).

- [ ] **Step 3: Commit**

```bash
git add worker/src/admin/events.ts
git commit -m "admin: accept guild_path_exclusive in events payload"
```

---

## Task 4: Worker register — gate non-members from exclusive events (TDD)

**Files:**
- Modify: `worker/src/register.test.ts`
- Modify: `worker/src/register.ts:135-145`

The existing register handler already loads the event and the user's active guild membership (lines 43-50 and 135-143). The gate lives between the membership lookup and the pricing logic.

- [ ] **Step 1: Update the shared event mock to include `guild_path_exclusive`**

In `worker/src/register.test.ts`, the `events` mock object literal appears twice. Edit both occurrences so the event object includes `guild_path_exclusive: false`:

```ts
id: 'E1', name: 'Test', date: '2026-06-01', venue_name: 'V', venue_area: null,
price: 500, capacity: 10, custom_questions: [], price_includes: null, is_published: true,
guild_path_exclusive: false,
```

- [ ] **Step 2: Write the failing test for non-member blocked**

Append this to `worker/src/register.test.ts` (after the existing `describe`):

```ts
describe('handleRegister guild-path exclusive gate', () => {
  function buildSupabaseMock(opts: {
    eventExclusive: boolean;
    isMember: boolean;
  }) {
    const member = opts.isMember
      ? { id: 'M1', tier: 'adventurer', expires_at: '2099-01-01', plus_ones_used: 0 }
      : null;
    return {
      from: (table: string) => {
        if (table === 'events') {
          return {
            select: () => ({ eq: () => ({ eq: () => ({ single: async () => ({ data: {
              id: 'E1', name: 'Test', date: '2026-06-01', venue_name: 'V', venue_area: null,
              price: 500, capacity: 10, custom_questions: [], price_includes: null,
              is_published: true, guild_path_exclusive: opts.eventExclusive,
            }, error: null }) }) }) }),
          };
        }
        if (table === 'registrations') {
          return {
            select: () => ({ eq: () => ({ neq: async () => ({ data: [], error: null }) }) }),
            insert: () => ({ select: () => ({ single: async () => ({ data: { id: 'R1' }, error: null }) }) }),
          };
        }
        if (table === 'users') {
          return {
            select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
            insert: () => ({ select: () => ({ single: async () => ({ data: { id: 'U1' }, error: null }) }) }),
          };
        }
        if (table === 'guild_path_members') {
          return {
            select: () => ({ eq: () => ({ eq: () => ({ gte: () => ({ order: () => ({ limit: () => ({ maybeSingle: async () => ({ data: member, error: null }) }) }) }) }) }) }),
          };
        }
        if (table === 'leads') {
          return {
            update: () => ({ eq: () => ({ eq: () => ({ is: () => ({ is: async () => ({ error: null }) }) }) }) }),
          };
        }
        return null;
      },
    };
  }

  function makeReq() {
    return new Request('http://localhost/api/register', {
      method: 'POST',
      body: JSON.stringify({
        event_id: 'E1', name: 'Asha', phone: '9876543210', email: 'a@b.com',
        seats: 1, custom_answers: {}, payment_status: 'pending',
      }),
    });
  }

  const ctx = { waitUntil: (p: Promise<unknown>) => p } as any;

  it('blocks non-member from registering for guild-exclusive event', async () => {
    (getSupabase as any).mockReturnValue(buildSupabaseMock({ eventExclusive: true, isMember: false }));
    const res = await handleRegister(makeReq(), mockEnv(), ctx);
    expect(res.status).toBe(403);
    const body = await res.json() as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toBe('guild_path_required');
  });

  it('allows active member to register for guild-exclusive event', async () => {
    (getSupabase as any).mockReturnValue(buildSupabaseMock({ eventExclusive: true, isMember: true }));
    const res = await handleRegister(makeReq(), mockEnv(), ctx);
    expect(res.status).toBe(200);
  });

  it('allows non-member to register for non-exclusive event', async () => {
    (getSupabase as any).mockReturnValue(buildSupabaseMock({ eventExclusive: false, isMember: false }));
    const res = await handleRegister(makeReq(), mockEnv(), ctx);
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 3: Run the new tests and confirm they fail**

```bash
cd worker && npx vitest run src/register.test.ts 2>&1 | tail -30
```

Expected: the blocking test fails (gets 200 instead of 403). The other two should pass already.

- [ ] **Step 4: Add the gate in `register.ts`**

In `worker/src/register.ts`, find the block at lines 135-143 that fetches `member`. Immediately after the `maybeSingle()` call assigning `member`, insert the gate:

```ts
  if (event.guild_path_exclusive && !member) {
    return jsonResponse({ success: false, error: 'guild_path_required' }, 403);
  }
```

Concretely, the diff is just after the `.maybeSingle();` that produces `{ data: member }` (around line 143), before `let totalAmount = event.price * seats;` (line 145).

- [ ] **Step 5: Run all worker tests**

```bash
cd worker && npm test 2>&1 | tail -30
```

Expected: all tests pass, including the three new ones.

- [ ] **Step 6: Commit**

```bash
git add worker/src/register.ts worker/src/register.test.ts
git commit -m "worker: gate non-members from guild-exclusive events"
```

---

## Task 5: Admin EventDrawer — toggle for `guild_path_exclusive`

**Files:**
- Modify: `admin/src/pages/EventDrawer.tsx:18-22, 180-183`

- [ ] **Step 1: Add field to the `empty` default**

In `admin/src/pages/EventDrawer.tsx`, edit the `empty` constant (lines 18-21):

```ts
const empty: Partial<Event> = {
  name: '', description: '', date: '', venue_name: '', venue_area: '',
  price: 0, capacity: 0, custom_questions: [], price_includes: '', llm_notes: '',
  is_published: false, guild_path_exclusive: false,
};
```

- [ ] **Step 2: Add the toggle in the form**

In the same file, locate the `Published` switch block (around lines 180-183). Add a sibling switch for `guild_path_exclusive` directly below it:

```tsx
          <div className="flex items-center gap-2">
            <Switch checked={!!form.is_published} onCheckedChange={(c) => set('is_published', c)} />
            <Label>Published</Label>
          </div>
          <div className="flex items-start gap-2">
            <Switch
              checked={!!form.guild_path_exclusive}
              onCheckedChange={(c) => set('guild_path_exclusive', c)}
            />
            <div>
              <Label>Guild Path Exclusive</Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Only current Guild Path members can register on the public site.
              </p>
            </div>
          </div>
```

- [ ] **Step 3: Verify the admin builds**

```bash
cd admin && npx tsc --noEmit 2>&1 | tail -10 && npm run build 2>&1 | tail -10
```

Expected: clean build.

- [ ] **Step 4: Commit**

```bash
git add admin/src/pages/EventDrawer.tsx
git commit -m "admin: toggle for guild_path_exclusive in EventDrawer"
```

---

## Task 6: Admin ManualRegistrationDrawer — warning when registering non-member for exclusive event

**Files:**
- Modify: `admin/src/pages/ManualRegistrationDrawer.tsx:198-207`

- [ ] **Step 1: Add the warning banner**

In `admin/src/pages/ManualRegistrationDrawer.tsx`, locate the `lookup && lookup.membership.isMember` banner (around line 198) — it sits right after the phone field. Add a new yellow warning banner immediately below the existing membership/credit banners (after the credit balance banner at ~line 207, before the `name` field):

```tsx
        {lookup && !lookup.membership.isMember && event?.guild_path_exclusive && (
          <div className="text-xs rounded-md bg-yellow-50 text-yellow-900 border border-yellow-200 p-2">
            ⚠️ This event is Guild Path Exclusive and this user isn't a current member.
            You can still register them, but consider adding them to Guild Path first.
          </div>
        )}
```

`event` is already in scope (defined at line 75 as `events.find((e) => e.id === eventId)`). Because `event?.guild_path_exclusive` reads the field added in Task 2, no additional changes are needed.

- [ ] **Step 2: Confirm admin builds**

```bash
cd admin && npx tsc --noEmit 2>&1 | tail -10
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add admin/src/pages/ManualRegistrationDrawer.tsx
git commit -m "admin: warn when manually registering non-member for exclusive event"
```

---

## Task 7: Public event card — badge for guild-exclusive events

**Files:**
- Modify: `src/components/EventList.tsx:168-175`

- [ ] **Step 1: Add badge in the card header**

In `src/components/EventList.tsx`, the `EventCard` component has a header row (lines 168-175) containing date plus `Featured` / `Past` pills. Add a `Guild Path Exclusive` badge next to those — visible whether the event is past or upcoming, so guild-only past events are still labelled:

```tsx
      <div
        className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5"
        style={{ background: featured ? '#FFD166' : past ? '#F5F1EA' : '#FFFFFF', borderBottom: '4px solid #1A1A1A' }}
      >
        <span className="font-heading font-bold text-base">{dateStr}</span>
        <div className="flex items-center gap-2">
          {event.guild_path_exclusive && (
            <span
              className="pill"
              style={{
                fontSize: '0.7rem',
                padding: '6px 12px',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                background: '#C3A6FF',
                color: '#1A1A1A',
                border: '2px solid #1A1A1A',
              }}
            >
              Guild Only
            </span>
          )}
          {featured && (
            <span
              className="pill pill-black"
              style={{ fontSize: '0.7rem', padding: '6px 12px', textTransform: 'uppercase', letterSpacing: '0.08em' }}
            >
              Featured
            </span>
          )}
          {past && (
            <span
              className="pill"
              style={{
                fontSize: '0.7rem',
                padding: '6px 12px',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                background: '#E5E5E5',
                color: '#1A1A1A',
                border: '2px solid #1A1A1A',
              }}
            >
              Past
            </span>
          )}
        </div>
      </div>
```

`#C3A6FF` is the same purple already used for the Guild member discount pill in `RegistrationForm.tsx`, keeping the visual association.

- [ ] **Step 2: Run dev server and visually confirm**

```bash
npm run dev
```

Visit `/calendar` and confirm the "Guild Only" pill renders on any event whose `guild_path_exclusive` is true in Supabase (toggle one via admin or `update events set guild_path_exclusive = true where id = …`). Confirm normal events look unchanged.

Stop the dev server with Ctrl+C.

- [ ] **Step 3: Commit**

```bash
git add src/components/EventList.tsx
git commit -m "site: Guild Only badge on event cards"
```

---

## Task 8: Public RegistrationForm — header badge + gate after phone lookup

**Files:**
- Modify: `src/components/RegistrationForm.tsx`

- [ ] **Step 1: Add helper that resets the lookup**

Inside the `RegistrationForm` component body (after the existing `useLeadCapture` line ~132), add a `resetLookup` callback the gate's secondary CTA can use:

```tsx
  function resetLookup() {
    setPhone('');
    setPhoneLookedUp(false);
    setMembership(null);
    setExistingSeatsForEvent(0);
    setCreditBalance(0);
    setActivePromo(null);
  }
```

- [ ] **Step 2: Add the Guild Only badge in the event header**

Find the header block (around lines 313-342) that renders event name + date + venue + price. After the existing `event.price_includes` block, but before the closing `</div>` of the header (the one at line 342 with `borderBottom: '3px solid #1A1A1A'`), insert:

```tsx
        {event.guild_path_exclusive && (
          <div className="mt-3">
            <span
              className="pill inline-block"
              style={{
                background: '#C3A6FF',
                padding: '6px 14px',
                fontSize: '0.75rem',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                border: '2px solid #1A1A1A',
              }}
            >
              👑 Guild Path Exclusive
            </span>
          </div>
        )}
```

- [ ] **Step 3: Compute the gate condition and render the gate UI**

The gate fires when the event is exclusive AND the lookup completed AND the user is not a current member. Compute it right after the existing `total` / `creditApplied` calculations (just before `const eventDate = new Date(event.date);` at ~line 219):

```tsx
  const guildGate =
    event.guild_path_exclusive && phoneLookedUp && membership?.isMember === false;
```

Then change the form branch (currently `soldOut ? <SoldOut> : <form>…</form>`) at ~line 344 to a three-way choice. Replace lines 344-498 (`{soldOut ? (` through `</form>`) with:

```tsx
      {soldOut ? (
        <div className="text-center py-8">
          <p className="font-heading font-bold text-xl text-[#1A1A1A]/60">Sold Out</p>
          <p className="text-sm text-[#1A1A1A]/60 mt-2">This event is fully booked.</p>
        </div>
      ) : (
        <form onSubmit={handleSubmit}>
          <div className="mb-5">
            <label className="label-brutal">Phone Number</label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="10-digit mobile number"
              required
              className="input-brutal"
            />
          </div>

          {guildGate ? (
            <div
              className="card-brutal p-6 mt-2"
              style={{ background: '#C3A6FF' }}
            >
              <div className="text-3xl mb-2">👑</div>
              <h2 className="font-heading text-xl font-bold mb-2">
                Guild Path Exclusive Event
              </h2>
              <p className="text-sm text-[#1A1A1A]/85 leading-relaxed mb-4">
                This session is open only to current Guild Path members. Join the
                Guild Path to register for this and other member-only events,
                plus get discounts and free seats on regular events.
              </p>
              <a
                href="/guild-path"
                className="btn btn-primary no-underline inline-block"
              >
                Join Guild Path →
              </a>
              <div className="mt-4">
                <button
                  type="button"
                  onClick={resetLookup}
                  className="text-sm underline text-[#1A1A1A]/70 bg-transparent border-0 cursor-pointer p-0"
                >
                  Try a different phone number
                </button>
              </div>
            </div>
          ) : (
            <>
              {phoneLookedUp && promoLabel && (
                <div className="mb-3">
                  <span
                    className="pill inline-block"
                    style={{ background: '#A8E6CF', padding: '8px 16px' }}
                  >
                    {promoLabel}
                  </span>
                </div>
              )}

              {phoneLookedUp && membership?.isMember && discountLabel && (
                <div className="mb-5">
                  <span
                    className="pill inline-block"
                    style={{ background: '#C3A6FF', padding: '8px 16px' }}
                  >
                    👑 {discountLabel}
                  </span>
                </div>
              )}

              {phoneLookedUp && activePromo && !promoFits && (
                <div className="mb-5 text-xs text-[#1A1A1A]/60">
                  You have a giveaway for events up to ₹{activePromo.max_event_price} — doesn't apply to this event.
                </div>
              )}

              {phoneLookedUp && promoPreserved && (
                <div className="mb-5 text-xs text-[#1A1A1A]/60">
                  🎁 Giveaway preserved — your Guild Path already covers this. {activePromo!.remaining_uses} use{activePromo!.remaining_uses === 1 ? '' : 's'} saved for later.
                </div>
              )}

              <div className="mb-5">
                <label className="label-brutal">Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your full name"
                  required
                  className="input-brutal"
                />
              </div>

              <div className="mb-5">
                <label className="label-brutal">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="your@email.com"
                  required
                  className="input-brutal"
                />
              </div>

              <div className="mb-5">
                <label className="label-brutal">Number of Seats</label>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setSeats(Math.max(1, seats - 1))}
                    className="w-10 h-10 rounded-lg font-heading font-bold text-lg cursor-pointer"
                    style={{ background: '#FFFFFF', border: '2px solid #1A1A1A', boxShadow: '3px 3px 0 #1A1A1A' }}
                  >
                    −
                  </button>
                  <span className="font-heading font-bold text-xl w-8 text-center">{seats}</span>
                  <button
                    type="button"
                    onClick={() => setSeats(Math.min(maxSeats, seats + 1))}
                    className="w-10 h-10 rounded-lg font-heading font-bold text-lg cursor-pointer"
                    style={{ background: '#FFFFFF', border: '2px solid #1A1A1A', boxShadow: '3px 3px 0 #1A1A1A' }}
                  >
                    +
                  </button>
                </div>
              </div>

              {event.custom_questions?.map((q) => (
                <CustomQuestion
                  key={q.id}
                  question={q}
                  value={customAnswers[q.id] ?? (q.type === 'checkbox' ? false : '')}
                  onChange={(val) => updateCustomAnswer(q.id, val)}
                  optionCounts={spots?.option_counts?.[q.id]}
                />
              ))}

              {creditApplied > 0 && (
                <div className="mt-6 mb-3 flex items-center justify-between text-sm font-heading">
                  <span>Credits applied (you have ₹{creditBalance})</span>
                  <span className="font-bold text-[#4A9B8E]">−₹{creditApplied}</span>
                </div>
              )}

              <div
                className={`card-brutal p-5 ${creditApplied > 0 ? 'mb-5' : 'mt-6 mb-5'} flex items-center justify-between`}
                style={{ background: '#FFD166' }}
              >
                <span className="font-heading font-bold text-sm uppercase tracking-wider">Total</span>
                <div className="text-right">
                  {grossTotal !== total && (
                    <span className="text-[#1A1A1A]/60 line-through text-sm mr-2">
                      ₹{grossTotal}
                    </span>
                  )}
                  <span className="font-heading font-bold text-3xl">₹{total}</span>
                </div>
              </div>

              {error && (
                <div
                  className="card-brutal p-4 mb-4"
                  style={{ background: '#FF6B6B' }}
                >
                  <p className="font-heading font-semibold">{error}</p>
                </div>
              )}

              <button type="submit" disabled={submitting} className="btn btn-primary w-full disabled:opacity-50 disabled:cursor-not-allowed">
                {submitting
                  ? 'Submitting...'
                  : total === 0
                    ? 'Get my spot'
                    : 'Proceed to Pay'}
              </button>
              {total > 0 && (
                <p className="text-center text-xs text-[#1A1A1A]/60 mt-3">
                  You'll be able to pay via UPI in the next step
                </p>
              )}
            </>
          )}
        </form>
      )}
```

Note: the phone input stays outside the conditional so users can re-enter a different number without losing the gate (or use the explicit "Try a different phone number" link, which clears `phone` outright).

- [ ] **Step 4: Manual verification in the browser**

```bash
npm run dev
```

In another terminal:

```bash
cd worker && npm run dev
```

In Supabase, pick a test event and `update events set guild_path_exclusive = true where id = '<id>';`. Then:

1. Visit `/register?event=<id>` and confirm the "👑 Guild Path Exclusive" badge appears in the header.
2. Enter a phone number for a non-member (e.g. a phone that's never registered before, like `9999999991`). Confirm the gate replaces the rest of the form, the "Join Guild Path →" CTA goes to `/guild-path`, and "Try a different phone number" clears the input.
3. Enter a phone number for an active guild member. Confirm the form proceeds normally.
4. Flip the flag back off and re-confirm non-members can register.

Stop both dev servers with Ctrl+C.

- [ ] **Step 5: Commit**

```bash
git add src/components/RegistrationForm.tsx
git commit -m "site: gate non-members from guild-exclusive events on register page"
```

---

## Task 9: Deploy

- [ ] **Step 1: Push site + admin (auto-deploys via Cloudflare Pages)**

```bash
git push origin main
```

- [ ] **Step 2: Deploy the worker**

```bash
cd worker && npx wrangler deploy
```

- [ ] **Step 3: Smoke test in production**

1. In admin (`admin.boardgamecompany.in`), open an event, toggle "Guild Path Exclusive", save.
2. On `boardgamecompany.in/calendar`, confirm "Guild Only" pill renders on that event's card.
3. On `/register?event=<id>`, enter a non-member's phone number and confirm the gate fires.
4. Curl-test the worker enforcement (replace IDs):
   ```bash
   curl -sX POST https://api.boardgamecompany.in/api/register \
     -H 'content-type: application/json' \
     -d '{"event_id":"<exclusive-event-id>","name":"Test","phone":"9999999991","email":"t@t.t","seats":1,"custom_answers":{},"payment_status":"pending"}' \
     | jq .
   ```
   Expected: `{ "success": false, "error": "guild_path_required" }` with HTTP 403.
5. Toggle the flag back off (or leave on for the intended event).

---

## Self-review notes

- Spec coverage: schema (Task 1), Event type (Task 2), admin toggle (Task 5), worker passthrough (Task 3), card badge (Task 7), register header badge + gate (Task 8), admin manual-register warning (Task 6), worker enforcement (Task 4). All sections of the spec map to a task.
- Placeholder scan: no TBDs, no "handle errors", no abstract "implement X" — every code-changing step has the actual code.
- Type consistency: `Event.guild_path_exclusive: boolean` is the same name in `src/lib/types.ts`, `admin/src/lib/types.ts`, the migration column, and every consumer. The worker error string `guild_path_required` is the same in the handler and the test assertions.
- Scope: single coordinated feature across one migration + worker + site + admin. Appropriately sized for one plan.
