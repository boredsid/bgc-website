# Event Waitlist Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the sold-out dead-end on the public registration form with a waitlist that captures phone/name/email/seats into the existing `leads` table, emails a confirmation, and surfaces the waitlist in admin `/leads`.

**Architecture:** A waitlist entry is a `leads` row marked by a new `waitlist_at` timestamp (also gives FIFO ordering). A new worker endpoint `POST /api/waitlist` validates input, re-checks capacity server-side, upserts the lead, and fires a confirmation email. The public form's sold-out branch becomes a waitlist form. Admin `/leads` gains a waitlist filter, badge, and seats column. Flow is manual — admins contact waitlisters via the existing WhatsApp deep-links.

**Tech Stack:** Supabase Postgres (migration SQL), Cloudflare Worker (TypeScript, Vitest), Astro + React 19 island (public form), Vite + React + shadcn (admin SPA), Google Apps Script email webhook.

---

## File Structure

- **Create** `supabase/migrations/015_leads_waitlist.sql` — add `email`, `seats`, `waitlist_at` columns + partial index to `leads`.
- **Create** `worker/src/waitlist.ts` — `handleWaitlist` endpoint.
- **Create** `worker/src/waitlist.test.ts` — endpoint unit tests.
- **Modify** `worker/src/email.ts` — add `sendWaitlistEmail` + `WaitlistEmailPayload`.
- **Modify** `worker/src/index.ts` — import + route `/api/waitlist`.
- **Modify** `worker/src/admin/leads.ts` — add `email`/`seats`/`waitlist_at` to selects, `waitlist` filter param, FIFO ordering, export columns.
- **Modify** `worker/src/admin/leads.test.ts` — test the `waitlist` filter param.
- **Modify** `admin/src/pages/Leads.tsx` — waitlist filter select, badge, seats column, new fields on the `Lead` interface.
- **Modify** `src/components/RegistrationForm.tsx` — replace sold-out card with waitlist form + success/available states.

---

## Task 1: Migration — add waitlist columns to `leads`

**Files:**
- Create: `supabase/migrations/015_leads_waitlist.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/015_leads_waitlist.sql`:

```sql
-- 015_leads_waitlist.sql
-- Extends the leads table to support event waitlists. When an event is sold out,
-- visitors join a waitlist instead of hitting a dead-end; the entry is a lead row
-- marked with waitlist_at (which also gives FIFO ordering). email + seats are
-- collected on the waitlist form. leads is an existing table, so it keeps its
-- existing grants — no new grant needed.

alter table leads add column email text;
alter table leads add column seats int;
alter table leads add column waitlist_at timestamptz;

-- Cheap lookups for the admin "waitlist only" view.
create index leads_waitlist_idx on leads (waitlist_at desc)
  where waitlist_at is not null and junk_at is null;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/015_leads_waitlist.sql
git commit -m "feat(db): add waitlist columns to leads (migration 015)"
```

> **Note for executor:** Apply this migration to Supabase before deploying the worker (via the Supabase SQL editor / migration tooling the project uses). The worker code in later tasks assumes these columns exist.

---

## Task 2: Confirmation email — `sendWaitlistEmail`

**Files:**
- Modify: `worker/src/email.ts`

- [ ] **Step 1: Add the payload type and sender**

In `worker/src/email.ts`, after the `GuildPurchaseEmailPayload` interface (line ~38), add a new payload interface:

```typescript
export interface WaitlistEmailPayload {
  to: string;
  name: string;
  seats: number;
  event: {
    name: string;
    date: string;
    venue_name: string;
    venue_area: string | null;
  };
}
```

Then, after the `sendGuildPurchaseEmail` function (end of file), add:

```typescript
export async function sendWaitlistEmail(
  payload: WaitlistEmailPayload,
  env: Env
): Promise<void> {
  await postToAppsScript({ type: 'event_waitlist', ...payload }, env);
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `cd worker && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add worker/src/email.ts
git commit -m "feat(worker): add sendWaitlistEmail"
```

> **Note for executor:** The Google Apps Script must learn to render `type: 'event_waitlist'`. Until it does, sends will log a non-success body but never fail the request (best-effort). Flag this to the user as a follow-up outside the codebase.

---

## Task 3: Worker endpoint — `POST /api/waitlist`

**Files:**
- Create: `worker/src/waitlist.ts`
- Create: `worker/src/waitlist.test.ts`
- Modify: `worker/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `worker/src/waitlist.test.ts`:

```typescript
// worker/src/waitlist.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

function mockEnv() {
  return {
    SUPABASE_URL: 'x', SUPABASE_SERVICE_KEY: 'x',
    UPI_ID: 'x', APPS_SCRIPT_URL: '', APPS_SCRIPT_SECRET: '', BGC_SITE_URL: '',
    CF_ACCESS_TEAM_DOMAIN: 'x', CF_ACCESS_AUD: 'x', ADMIN_EMAILS: '', ENVIRONMENT: 'production',
  } as any;
}

vi.mock('./supabase', () => ({ getSupabase: vi.fn() }));
vi.mock('./email', () => ({ sendWaitlistEmail: vi.fn(async () => undefined) }));

import { getSupabase } from './supabase';
import { handleWaitlist, _resetWaitlistRateLimit } from './waitlist';

const EVENT_ID = '11111111-1111-1111-1111-111111111111';
const ctx = { waitUntil: (p: Promise<unknown>) => p } as any;

interface MockOpts {
  capacity?: number;
  registeredSeats?: number;
  eventExists?: boolean;
  existingLead?: { converted_at: string | null; waitlist_at: string | null } | null;
  capture: { upsertArg: any; upsertOnConflict: string | null };
}

function buildSupabaseMock(opts: MockOpts) {
  const capacity = opts.capacity ?? 10;
  const regsData = opts.registeredSeats !== undefined ? [{ seats: opts.registeredSeats }] : [];
  const eventExists = opts.eventExists ?? true;
  const existingLead = opts.existingLead ?? null;
  const capture = opts.capture;
  return {
    from: (table: string) => {
      if (table === 'events') {
        return {
          select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({
            data: eventExists
              ? { id: 'E1', name: 'Catan Night', date: '2026-06-01', venue_name: 'V', venue_area: null, capacity }
              : null,
            error: null,
          }) }) }) }),
        };
      }
      if (table === 'registrations') {
        return { select: () => ({ eq: () => ({ neq: async () => ({ data: regsData, error: null }) }) }) };
      }
      if (table === 'leads') {
        return {
          select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: existingLead, error: null }) }) }) }),
          upsert: (arg: any, o: any) => {
            capture.upsertArg = arg;
            capture.upsertOnConflict = o?.onConflict ?? null;
            return { error: null };
          },
        };
      }
      throw new Error('unexpected table ' + table);
    },
  };
}

function makeReq(body: Record<string, unknown>) {
  return new Request('http://localhost/api/waitlist', { method: 'POST', body: JSON.stringify(body) });
}

const validBody = {
  event_id: EVENT_ID, name: 'Asha', phone: '9876543210', email: 'a@b.com', seats: 2,
};

beforeEach(() => {
  _resetWaitlistRateLimit();
});

describe('handleWaitlist', () => {
  it('rejects invalid phone with 400', async () => {
    const capture = { upsertArg: null as any, upsertOnConflict: null as any };
    (getSupabase as any).mockReturnValue(buildSupabaseMock({ capture }));
    const res = await handleWaitlist(makeReq({ ...validBody, phone: '123' }), mockEnv(), ctx);
    expect(res.status).toBe(400);
    expect(capture.upsertArg).toBeNull();
  });

  it('rejects invalid email with 400', async () => {
    const capture = { upsertArg: null as any, upsertOnConflict: null as any };
    (getSupabase as any).mockReturnValue(buildSupabaseMock({ capture }));
    const res = await handleWaitlist(makeReq({ ...validBody, email: 'nope' }), mockEnv(), ctx);
    expect(res.status).toBe(400);
    expect(capture.upsertArg).toBeNull();
  });

  it('rejects invalid seats with 400', async () => {
    const capture = { upsertArg: null as any, upsertOnConflict: null as any };
    (getSupabase as any).mockReturnValue(buildSupabaseMock({ capture }));
    const res = await handleWaitlist(makeReq({ ...validBody, seats: 0 }), mockEnv(), ctx);
    expect(res.status).toBe(400);
    expect(capture.upsertArg).toBeNull();
  });

  it('returns 404 when event missing', async () => {
    const capture = { upsertArg: null as any, upsertOnConflict: null as any };
    (getSupabase as any).mockReturnValue(buildSupabaseMock({ eventExists: false, capture }));
    const res = await handleWaitlist(makeReq(validBody), mockEnv(), ctx);
    expect(res.status).toBe(404);
    expect(capture.upsertArg).toBeNull();
  });

  it('returns available:true when the event is not full (no write)', async () => {
    const capture = { upsertArg: null as any, upsertOnConflict: null as any };
    (getSupabase as any).mockReturnValue(buildSupabaseMock({ capacity: 10, registeredSeats: 5, capture }));
    const res = await handleWaitlist(makeReq(validBody), mockEnv(), ctx);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({ available: true });
    expect(capture.upsertArg).toBeNull();
  });

  it('upserts a waitlist row when full', async () => {
    const capture = { upsertArg: null as any, upsertOnConflict: null as any };
    (getSupabase as any).mockReturnValue(buildSupabaseMock({ capacity: 10, registeredSeats: 10, capture }));
    const res = await handleWaitlist(makeReq(validBody), mockEnv(), ctx);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({ success: true });
    expect(capture.upsertOnConflict).toBe('phone,event_id');
    expect(capture.upsertArg.phone).toBe('9876543210');
    expect(capture.upsertArg.name).toBe('Asha');
    expect(capture.upsertArg.email).toBe('a@b.com');
    expect(capture.upsertArg.seats).toBe(2);
    expect(capture.upsertArg.event_id).toBe(EVENT_ID);
    expect(capture.upsertArg.last_step).toBe('details_entered');
    expect(capture.upsertArg.waitlist_at).toBeTruthy();
  });

  it('preserves existing waitlist_at on re-submit (keeps FIFO position)', async () => {
    const capture = { upsertArg: null as any, upsertOnConflict: null as any };
    (getSupabase as any).mockReturnValue(buildSupabaseMock({
      capacity: 10, registeredSeats: 10,
      existingLead: { converted_at: null, waitlist_at: '2026-05-01T00:00:00.000Z' },
      capture,
    }));
    const res = await handleWaitlist(makeReq(validBody), mockEnv(), ctx);
    expect(res.status).toBe(200);
    expect(capture.upsertArg.waitlist_at).toBe('2026-05-01T00:00:00.000Z');
  });

  it('skips writes when the existing lead is already converted', async () => {
    const capture = { upsertArg: null as any, upsertOnConflict: null as any };
    (getSupabase as any).mockReturnValue(buildSupabaseMock({
      capacity: 10, registeredSeats: 10,
      existingLead: { converted_at: '2026-05-15T00:00:00Z', waitlist_at: null },
      capture,
    }));
    const res = await handleWaitlist(makeReq(validBody), mockEnv(), ctx);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({ success: true });
    expect(capture.upsertArg).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd worker && npx vitest run src/waitlist.test.ts`
Expected: FAIL — cannot find module `./waitlist`.

- [ ] **Step 3: Write the implementation**

Create `worker/src/waitlist.ts`:

```typescript
// worker/src/waitlist.ts
import type { Env } from './index';
import { getSupabase } from './supabase';
import { sanitizePhone, sanitizeEmail, sanitizeName, sanitizeSource, jsonResponse } from './validation';
import { sendWaitlistEmail } from './email';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Best-effort, per-isolate dedup of double-submits. Map(`${phone}|${event_id}` -> last ms).
const RATE_LIMIT_MS = 2000;
const lastSeen = new Map<string, number>();

export function _resetWaitlistRateLimit(): void {
  lastSeen.clear();
}

interface WaitlistBody {
  event_id?: string;
  name?: string;
  phone?: string;
  email?: string;
  seats?: number;
  source?: unknown;
  user_agent?: string | null;
}

export async function handleWaitlist(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  let body: WaitlistBody;
  try {
    body = (await request.json()) as WaitlistBody;
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400);
  }

  const phone = sanitizePhone(body.phone || '');
  if (!phone) return jsonResponse({ error: 'Invalid phone number' }, 400);

  const name = sanitizeName(body.name || '');
  if (!name) return jsonResponse({ error: 'Invalid name' }, 400);

  const email = sanitizeEmail(body.email || '');
  if (!email) return jsonResponse({ error: 'Invalid email' }, 400);

  const seats = Math.floor(Number(body.seats));
  if (!Number.isFinite(seats) || seats < 1 || seats > 20) {
    return jsonResponse({ error: 'Invalid seat count' }, 400);
  }

  const eventId = (body.event_id || '').trim();
  if (!UUID_RE.test(eventId)) return jsonResponse({ error: 'Invalid event id' }, 400);

  // Per-isolate rate-limit drop (double-submit guard).
  const key = `${phone}|${eventId}`;
  const now = Date.now();
  const prev = lastSeen.get(key);
  if (prev && now - prev < RATE_LIMIT_MS) {
    return jsonResponse({ success: true });
  }
  lastSeen.set(key, now);

  const supabase = getSupabase(env);

  // Fetch the published event (covers existence + gives email content).
  const { data: event } = await supabase
    .from('events')
    .select('id, name, date, venue_name, venue_area, capacity')
    .eq('id', eventId)
    .eq('is_published', true)
    .maybeSingle();

  if (!event) return jsonResponse({ error: 'Event not found' }, 404);

  // Re-check capacity server-side (same weighting as register.ts). If the event
  // is not actually full, tell the client to refresh and register normally.
  const { data: regs } = await supabase
    .from('registrations')
    .select('seats')
    .eq('event_id', eventId)
    .neq('payment_status', 'cancelled');

  const registered = (regs || []).reduce((sum: number, r: { seats: number }) => sum + r.seats, 0);
  const remaining = event.capacity - registered;
  if (remaining >= 1) {
    return jsonResponse({ available: true });
  }

  // Don't touch a lead that already converted (they're actually registered).
  const { data: existing } = await supabase
    .from('leads')
    .select('converted_at, waitlist_at')
    .eq('phone', phone)
    .eq('event_id', eventId)
    .maybeSingle();

  if (existing && existing.converted_at) {
    return jsonResponse({ success: true });
  }

  const sourceStr = sanitizeSource(body.source);
  const source = sourceStr ? { utm_source: sourceStr } : null;
  const userAgent = typeof body.user_agent === 'string' ? body.user_agent.slice(0, 500) : null;

  const nowIso = new Date().toISOString();
  const row: Record<string, unknown> = {
    phone,
    event_id: eventId,
    name,
    email,
    seats,
    last_step: 'details_entered',
    // Preserve the original join time on re-submit so FIFO position is kept.
    waitlist_at: existing?.waitlist_at ?? nowIso,
    updated_at: nowIso,
  };
  if (source) row.source = source;
  if (userAgent) row.user_agent = userAgent;

  const { error } = await supabase
    .from('leads')
    .upsert(row, { onConflict: 'phone,event_id', ignoreDuplicates: false });

  if (error) {
    return jsonResponse({ error: 'Could not join waitlist' }, 500);
  }

  ctx.waitUntil(
    sendWaitlistEmail(
      {
        to: email,
        name,
        seats,
        event: {
          name: event.name,
          date: event.date,
          venue_name: event.venue_name,
          venue_area: event.venue_area ?? null,
        },
      },
      env
    ).catch((err) => console.error('[email] waitlist send error', err))
  );

  return jsonResponse({ success: true });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd worker && npx vitest run src/waitlist.test.ts`
Expected: PASS — all 8 tests green.

- [ ] **Step 5: Wire the route into `index.ts`**

In `worker/src/index.ts`, add the import next to the other public-handler imports (after line 5, the `handleLead` import):

```typescript
import { handleWaitlist } from './waitlist';
```

Then in the public `if/else` chain, after the `/api/lead` branch (lines 128–129), add:

```typescript
      } else if (url.pathname === '/api/waitlist' && request.method === 'POST') {
        response = await handleWaitlist(request, env, ctx);
```

- [ ] **Step 6: Verify type-check + full worker test suite**

Run: `cd worker && npx tsc --noEmit && npx vitest run`
Expected: no type errors; all tests pass.

- [ ] **Step 7: Commit**

```bash
git add worker/src/waitlist.ts worker/src/waitlist.test.ts worker/src/index.ts
git commit -m "feat(worker): add POST /api/waitlist endpoint"
```

---

## Task 4: Admin worker — waitlist filter, fields, FIFO ordering, export

**Files:**
- Modify: `worker/src/admin/leads.ts`
- Modify: `worker/src/admin/leads.test.ts`

- [ ] **Step 1: Write the failing test**

In `worker/src/admin/leads.test.ts`, add these tests inside the existing `describe('handleListLeads', ...)` block (after the `has_name=yes` test, before the closing `});` on line 69):

```typescript
  it('waitlist=only filters to rows with waitlist_at set', async () => {
    const capture: QueryCapture = { filters: [] };
    (getSupabase as any).mockReturnValue(buildListMock([], capture));
    const req = new Request('http://localhost/api/admin/leads?waitlist=only');
    await handleListLeads(req, mockEnv());
    expect(capture.filters).toContainEqual({ op: 'not.is', col: 'waitlist_at', val: null });
  });

  it('waitlist=exclude filters to rows with no waitlist_at', async () => {
    const capture: QueryCapture = { filters: [] };
    (getSupabase as any).mockReturnValue(buildListMock([], capture));
    const req = new Request('http://localhost/api/admin/leads?waitlist=exclude');
    await handleListLeads(req, mockEnv());
    expect(capture.filters).toContainEqual({ op: 'is', col: 'waitlist_at', val: null });
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd worker && npx vitest run src/admin/leads.test.ts`
Expected: FAIL — the `waitlist_at` filter is not applied yet.

- [ ] **Step 3: Implement the filter, fields, and ordering**

In `worker/src/admin/leads.ts`:

(a) In `applyListFilters`, after the `hasName` block (after line 20, `if (hasName === 'no') ...`), add:

```typescript
  const waitlist = url.searchParams.get('waitlist');
  if (waitlist === 'only') query = query.not('waitlist_at', 'is', null);
  else if (waitlist === 'exclude') query = query.is('waitlist_at', null);
```

(b) In `handleListLeads`, update the `select` string (line 36) to include the new columns:

```typescript
    .select('id, phone, name, email, seats, event_id, last_step, source, user_agent, converted_at, registration_id, junk_at, waitlist_at, created_at, updated_at, events(name, date)');
```

(c) Still in `handleListLeads`, replace the final query line (line 40) so the waitlist view is FIFO-ordered:

```typescript
  const waitlistParam = url.searchParams.get('waitlist');
  const sorted = waitlistParam === 'only'
    ? query.order('waitlist_at', { ascending: true })
    : query.order('created_at', { ascending: false });
  const { data, error } = await sorted.limit(LIST_LIMIT);
```

(d) In `handleExportLeads`, update the `select` string (line 79):

```typescript
    .select('id, phone, name, email, seats, event_id, last_step, source, converted_at, junk_at, waitlist_at, created_at, events(name)');
```

(e) In `handleExportLeads`, update the CSV `header` (line 85) and `rows` mapping (lines 86–89):

```typescript
  const header = ['created_at', 'phone', 'name', 'email', 'seats', 'event', 'last_step', 'waitlist_at', 'source', 'converted_at', 'junk_at'];
  const rows = (data || []).map((r: any) => [
    r.created_at, r.phone, r.name, r.email, r.seats, r.events?.name ?? '',
    r.last_step, r.waitlist_at, r.source, r.converted_at, r.junk_at,
  ].map(csvEscape).join(','));
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd worker && npx vitest run src/admin/leads.test.ts`
Expected: PASS — including the two new waitlist filter tests and the existing export tests (the export test asserts `lines[0]` contains `phone` and `lines[1]` contains the phone number, both still true).

- [ ] **Step 5: Commit**

```bash
git add worker/src/admin/leads.ts worker/src/admin/leads.test.ts
git commit -m "feat(worker): waitlist filter, fields and FIFO ordering in admin leads"
```

---

## Task 5: Admin UI — waitlist filter, badge, seats column

**Files:**
- Modify: `admin/src/pages/Leads.tsx`

> No unit test — admin SPA pages are verified manually. Steps below produce a working UI; verify with `cd admin && npm run build` + manual check.

- [ ] **Step 1: Extend the `Lead` interface**

In `admin/src/pages/Leads.tsx`, update the `Lead` interface (lines 12–23) to add the new fields:

```typescript
interface Lead {
  id: string;
  phone: string;
  name: string | null;
  email: string | null;
  seats: number | null;
  event_id: string;
  last_step: 'phone_entered' | 'name_entered' | 'details_entered';
  source: Record<string, unknown> | null;
  converted_at: string | null;
  junk_at: string | null;
  waitlist_at: string | null;
  created_at: string;
  events: { name: string; date: string } | null;
}
```

- [ ] **Step 2: Add the waitlist filter state**

After the `sinceDays` state declaration (line 55), add:

```typescript
  const [waitlist, setWaitlist] = useState<'any' | 'only' | 'exclude'>('any');
```

- [ ] **Step 3: Include the filter in the query string**

In the `queryString` `useMemo`, after the `hasName` line (line 60), add:

```typescript
    if (waitlist !== 'any') p.set('waitlist', waitlist);
```

And add `waitlist` to the `useMemo` dependency array (line 71): change `[eventId, hasName, includeConverted, includeJunk, sinceDays]` to `[eventId, hasName, includeConverted, includeJunk, sinceDays, waitlist]`.

- [ ] **Step 4: Add the filter control**

In the filter row, after the "Has name" `<div className="flex flex-col gap-1">…</div>` block (lines 130–140), add:

```tsx
        <div className="flex flex-col gap-1">
          <Label>Waitlist</Label>
          <Select value={waitlist} onValueChange={(v) => setWaitlist(v as 'any' | 'only' | 'exclude')}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Any</SelectItem>
              <SelectItem value="only">Waitlist only</SelectItem>
              <SelectItem value="exclude">Hide waitlist</SelectItem>
            </SelectContent>
          </Select>
        </div>
```

- [ ] **Step 5: Show the waitlist badge + seats in the table**

Replace the "Step" cell (line 186) so waitlist rows are visually distinct and show seats:

```tsx
                  <td className="p-2">
                    {l.waitlist_at ? (
                      <Badge>🎟️ Waitlist{l.seats ? ` · ${l.seats}` : ''}</Badge>
                    ) : (
                      <Badge variant="secondary">{l.last_step.replace('_entered', '')}</Badge>
                    )}
                  </td>
```

- [ ] **Step 6: Build to verify it compiles**

Run: `cd admin && npm run build`
Expected: build succeeds with no type errors.

- [ ] **Step 7: Commit**

```bash
git add admin/src/pages/Leads.tsx
git commit -m "feat(admin): waitlist filter, badge and seats in leads page"
```

---

## Task 6: Public form — waitlist form replacing the sold-out dead-end

**Files:**
- Modify: `src/components/RegistrationForm.tsx`

> No unit test — public islands are verified manually (`npm run dev`). Steps below produce a working form.

- [ ] **Step 1: Add waitlist UI state**

In `src/components/RegistrationForm.tsx`, after the `error` state (line 32), add:

```typescript
  const [waitlistJoined, setWaitlistJoined] = useState(false);
  const [waitlistSubmitting, setWaitlistSubmitting] = useState(false);
```

- [ ] **Step 2: Add the submit handler**

Add this function inside the component, right after the existing `submitRegistration` function (after its closing brace on line 284):

```typescript
  async function joinWaitlist(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setWaitlistSubmitting(true);
    try {
      const res = await fetch(`${WORKER_URL}/api/waitlist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_id: eventId,
          name,
          phone,
          email,
          seats,
          source: getSource(),
          user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
        }),
      });
      const data = await res.json();
      if (data.available) {
        // A spot opened up between page load and submit — re-fetch spots so the
        // normal registration form returns.
        try {
          const spotsRes = await fetch(`${WORKER_URL}/api/event-spots/${eventId}`);
          if (spotsRes.ok) setSpots(await spotsRes.json());
        } catch {
          // leave spots as-is
        }
        setError('Good news — a spot just opened up! You can register now.');
        setWaitlistSubmitting(false);
        return;
      }
      if (!res.ok || !data.success) {
        setError(data.error || 'Could not join the waitlist. Please try again.');
        setWaitlistSubmitting(false);
        return;
      }
      setWaitlistJoined(true);
    } catch {
      setError('Something went wrong. Please try again.');
    }
    setWaitlistSubmitting(false);
  }
```

- [ ] **Step 3: Replace the sold-out branch with the waitlist form**

Replace the entire `soldOut ? (...) : (` block opening — specifically the sold-out JSX (current lines 378–382):

```tsx
        <div className="text-center py-8">
          <p className="font-heading font-bold text-xl text-[#1A1A1A]/60">Sold Out</p>
          <p className="text-sm text-[#1A1A1A]/60 mt-2">This event is fully booked.</p>
        </div>
```

with this waitlist block:

```tsx
        waitlistJoined ? (
          <div className="card-brutal p-8 text-center" style={{ background: '#A8E6CF' }}>
            <div className="text-5xl mb-3">🎟️</div>
            <h2 className="font-heading text-2xl font-bold mb-2">You're on the waitlist!</h2>
            <p className="text-[#1A1A1A]/85">
              We'll WhatsApp or email you at <strong>{email}</strong> if a spot opens up for{' '}
              <strong>{event.name}</strong>.
            </p>
          </div>
        ) : (
          <div>
            <div className="card-brutal p-4 mb-5 text-center" style={{ background: '#FFD166' }}>
              <p className="font-heading font-bold">This event is full</p>
              <p className="text-sm text-[#1A1A1A]/75 mt-1">
                Join the waitlist and we'll reach out if a spot frees up.
              </p>
            </div>
            <form onSubmit={joinWaitlist}>
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
                    onClick={() => setSeats(Math.min(10, seats + 1))}
                    className="w-10 h-10 rounded-lg font-heading font-bold text-lg cursor-pointer"
                    style={{ background: '#FFFFFF', border: '2px solid #1A1A1A', boxShadow: '3px 3px 0 #1A1A1A' }}
                  >
                    +
                  </button>
                </div>
              </div>
              {error && (
                <div className="card-brutal p-4 mb-4" style={{ background: '#FF6B6B' }}>
                  <p className="font-heading font-semibold">{error}</p>
                </div>
              )}
              <button
                type="submit"
                disabled={waitlistSubmitting}
                className="btn btn-primary w-full disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {waitlistSubmitting ? 'Joining...' : 'Join the waitlist'}
              </button>
            </form>
          </div>
        )
```

> **Note:** `getSource` is already imported at the top of the file (line 3). `useLeadCapture` already runs on `phone`/`name` regardless of branch, so partial waitlist abandonment is still captured as an ordinary lead.

- [ ] **Step 4: Verify the build**

Run: `npm run build`
Expected: Astro build succeeds with no type errors.

- [ ] **Step 5: Manual check**

Run: `npm run dev`, open `/register?event=<a sold-out event id>` (or temporarily set an event's capacity below its registered seats in Supabase), confirm the waitlist form renders, submit, and confirm the success card appears. Check the row lands in `leads` with `waitlist_at`, `email`, `seats` set, and shows under "Waitlist only" in admin.

- [ ] **Step 6: Commit**

```bash
git add src/components/RegistrationForm.tsx
git commit -m "feat(site): waitlist form on sold-out events"
```

---

## Self-Review Notes

- **Spec coverage:** migration (Task 1), email (Task 2), endpoint with capacity re-check + FIFO preservation + converted-skip (Task 3), admin filter/fields/export/ordering (Task 4), admin UI (Task 5), public form with available/success states (Task 6). All spec sections covered.
- **Type consistency:** `handleWaitlist(request, env, ctx)` matches the test and the `index.ts` call. `WaitlistEmailPayload` (Task 2) matches the `sendWaitlistEmail` call shape in Task 3. `waitlist` query values (`only`/`exclude`) are consistent across worker (Task 4) and admin UI (Task 5).
- **Deployment order:** apply migration 015 → deploy worker (`cd worker && npx wrangler deploy`) → push site + build/push admin. The Apps Script `event_waitlist` template is an external follow-up (flagged in Task 2).
```
