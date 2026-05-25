# Guest Admins Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give collaboration partners temporary, event-scoped admin access that auto-expires 2 days after the event — they can manage only that event's registrations and nothing else.

**Architecture:** A guest's request never enters the existing admin `if/else` chain or the existing admin SPA shell. The worker resolves a role (`admin`/`guest`/`none`); guests route into an isolated `handleGuestRequest` module exposing a small set of event-scoped endpoints. The frontend branches on role into a minimal `<GuestApp>` shell that reuses the registration components with the event locked. Guest emails are auto-synced into a dedicated Cloudflare Access Group so they pass the edge gate; the worker re-checks expiry on every request, so the CF group is only a coarse gate.

**Tech Stack:** Cloudflare Workers (TypeScript, Vitest), Supabase Postgres, Astro/React 19 admin SPA (Vite + shadcn, Vitest + RTL).

**Spec:** `docs/superpowers/specs/2026-05-25-guest-admins-design.md`

---

## File Structure

**Worker (`worker/src/`)**
- `access-auth.ts` — MODIFY: `verifyAccessJwt` stops checking `ADMIN_EMAILS`; returns email for any validly-signed token.
- `access-auth.test.ts` — MODIFY: allowlist test becomes "accepts any valid token".
- `index.ts` — MODIFY: `Env` gains CF secrets; `AdminContext` becomes a role union; `gateAdmin` resolves role; routing branches guests to `handleGuestRequest`; `scheduled` triggers CF sync.
- `guest/auth.ts` — CREATE: `resolveRole()` + `GUEST_EXPIRY_BUFFER_DAYS`.
- `guest/auth.test.ts` — CREATE.
- `guest/index.ts` — CREATE: `handleGuestRequest()` — the entire guest endpoint surface.
- `guest/index.test.ts` — CREATE.
- `guest/lookup-phone.ts` — CREATE: scoped phone lookup.
- `guest/lookup-phone.test.ts` — CREATE.
- `guest/cf-access.ts` — CREATE: `activeGuestEmails()` + `syncCfAccessGroup()`.
- `guest/cf-access.test.ts` — CREATE.
- `admin/events.ts` — MODIFY: accept `is_collaboration` + `guest_admins`; return `guest_admins` on GET; trigger CF sync.
- `admin/events.test.ts` — CREATE.

**Database (`supabase/migrations/`)**
- `014_event_guest_admins.sql` — CREATE.

**Admin SPA (`admin/src/`)**
- `lib/whoami.tsx` — CREATE: whoami context + provider.
- `lib/types.ts` — MODIFY: `Event.is_collaboration`.
- `App.tsx` — MODIFY: wrap in provider; branch admin vs guest.
- `GuestApp.tsx` — CREATE: guest route table.
- `components/GuestLayout.tsx` — CREATE: minimal guest shell.
- `pages/RegistrationsList.tsx` — MODIFY: guest-aware event source + locked filter.
- `pages/ManualRegistrationDrawer.tsx` — MODIFY: guest-aware event source; tolerate scoped lookup.
- `pages/EventDrawer.tsx` — MODIFY: collaboration toggle + guest email editor.
- `lib/whoami.test.tsx` — CREATE.

---

## Phase 1 — Database

### Task 1: Migration for collaboration flag + guest table

**Files:**
- Create: `supabase/migrations/014_event_guest_admins.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 014_event_guest_admins.sql
-- Guest admins: event-scoped, time-bound admin access for collaboration partners.

alter table events
  add column if not exists is_collaboration boolean not null default false;

create table if not exists event_guest_admins (
  id uuid primary key default uuid_generate_v4(),
  event_id uuid not null references events(id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now(),
  created_by text,
  unique (event_id, email)
);

create index if not exists event_guest_admins_email_idx on event_guest_admins (email);

-- Service-role only (worker holds the service key). No public/anon policies.
alter table event_guest_admins enable row level security;
```

- [ ] **Step 2: Apply the migration**

Apply via the Supabase MCP `apply_migration` tool (name `014_event_guest_admins`) or the SQL editor against project ref `yhgtwqdsnrslcgdvmunz`. Confirm `events.is_collaboration` exists and `event_guest_admins` is listed via `list_tables`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/014_event_guest_admins.sql
git commit -m "feat: add is_collaboration flag + event_guest_admins table"
```

---

## Phase 2 — Worker auth split & role resolution

### Task 2: Strip the allowlist check out of `verifyAccessJwt`

**Files:**
- Modify: `worker/src/access-auth.ts:92-96`
- Modify: `worker/src/access-auth.test.ts:107-116`

- [ ] **Step 1: Update the allowlist test to expect acceptance**

In `worker/src/access-auth.test.ts`, replace the `rejects when email is not in allowlist` test (lines 107-116) with:

```ts
  it('accepts any validly-signed token regardless of allowlist (allowlist moved to gateAdmin)', async () => {
    const token = await signJwt(keyPair.privateKey, {
      iss: 'https://boardgamecompany.cloudflareaccess.com',
      aud: 'test-aud-tag',
      email: 'stranger@x.com',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const result = await verifyAccessJwt(token, baseEnv());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.email).toBe('stranger@x.com');
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd worker && npx vitest run src/access-auth.test.ts`
Expected: FAIL — the new test expects `ok: true` but current code returns `ok: false` (`email not allowed`).

- [ ] **Step 3: Remove the allowlist check from `verifyAccessJwt`**

In `worker/src/access-auth.ts`, replace lines 92-96:

```ts
  const email = (payload.email || '').toLowerCase();
  const allowed = env.ADMIN_EMAILS.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (!allowed.includes(email)) return { ok: false, reason: 'email not allowed' };

  return { ok: true, email };
```

with:

```ts
  const email = (payload.email || '').toLowerCase();
  return { ok: true, email };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd worker && npx vitest run src/access-auth.test.ts`
Expected: PASS (all 7 tests).

- [ ] **Step 5: Commit**

```bash
git add worker/src/access-auth.ts worker/src/access-auth.test.ts
git commit -m "refactor: verifyAccessJwt verifies token only, allowlist moves to gateAdmin"
```

### Task 3: `resolveRole` — admin/guest/none from email

**Files:**
- Create: `worker/src/guest/auth.ts`
- Create: `worker/src/guest/auth.test.ts`
- Modify: `worker/src/index.ts:50-52` (AdminContext type)

- [ ] **Step 1: Replace the `AdminContext` interface with a role union**

In `worker/src/index.ts`, replace lines 50-52:

```ts
export interface AdminContext {
  email: string;
}
```

with:

```ts
export type AdminContext =
  | { email: string; role: 'admin' }
  | { email: string; role: 'guest'; eventIds: string[] }
  | { email: string; role: 'none' };
```

- [ ] **Step 2: Write the failing test**

Create `worker/src/guest/auth.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';

function mockEnv(adminEmails = 'admin@bgc.in') {
  return {
    SUPABASE_URL: 'x', SUPABASE_SERVICE_KEY: 'x',
    UPI_ID: 'x', APPS_SCRIPT_URL: '', APPS_SCRIPT_SECRET: '', BGC_SITE_URL: '',
    CF_ACCESS_TEAM_DOMAIN: 'x', CF_ACCESS_AUD: 'x', ADMIN_EMAILS: adminEmails, ENVIRONMENT: 'production',
  } as any;
}

vi.mock('../supabase', () => ({ getSupabase: vi.fn() }));
import { getSupabase } from '../supabase';
import { resolveRole } from './auth';

// guestRows: rows in event_guest_admins for the queried email.
// activeEvents: rows returned by the events query (already filtered by the mock to satisfy in/eq/gte).
function mockSupabase(guestRows: { event_id: string }[], activeEvents: { id: string }[]) {
  return {
    from: (table: string) => {
      if (table === 'event_guest_admins') {
        return { select: () => ({ eq: async () => ({ data: guestRows, error: null }) }) };
      }
      if (table === 'events') {
        return {
          select: () => ({
            in: () => ({
              eq: () => ({ gte: async () => ({ data: activeEvents, error: null }) }),
            }),
          }),
        };
      }
      return null;
    },
  };
}

describe('resolveRole', () => {
  it('returns admin for an allowlisted email without touching the DB', async () => {
    (getSupabase as any).mockReturnValue(mockSupabase([], []));
    const ctx = await resolveRole('admin@bgc.in', mockEnv());
    expect(ctx).toEqual({ email: 'admin@bgc.in', role: 'admin' });
  });

  it('returns guest with active event ids', async () => {
    (getSupabase as any).mockReturnValue(mockSupabase([{ event_id: 'e1' }, { event_id: 'e2' }], [{ id: 'e1' }]));
    const ctx = await resolveRole('guest@partner.in', mockEnv());
    expect(ctx).toEqual({ email: 'guest@partner.in', role: 'guest', eventIds: ['e1'] });
  });

  it('returns none when the email has no guest rows', async () => {
    (getSupabase as any).mockReturnValue(mockSupabase([], []));
    const ctx = await resolveRole('stranger@x.com', mockEnv());
    expect(ctx).toEqual({ email: 'stranger@x.com', role: 'none' });
  });

  it('returns none when guest rows exist but no event is active (expired / not collaboration)', async () => {
    (getSupabase as any).mockReturnValue(mockSupabase([{ event_id: 'eOld' }], []));
    const ctx = await resolveRole('guest@partner.in', mockEnv());
    expect(ctx).toEqual({ email: 'guest@partner.in', role: 'none' });
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd worker && npx vitest run src/guest/auth.test.ts`
Expected: FAIL — `Cannot find module './auth'`.

- [ ] **Step 4: Implement `resolveRole`**

Create `worker/src/guest/auth.ts`:

```ts
import type { Env, AdminContext } from '../index';
import { getSupabase } from '../supabase';

export const GUEST_EXPIRY_BUFFER_DAYS = 2;

export async function resolveRole(email: string, env: Env): Promise<AdminContext> {
  const allowed = env.ADMIN_EMAILS.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (allowed.includes(email)) return { email, role: 'admin' };

  const supabase = getSupabase(env);

  const { data: rows } = await supabase
    .from('event_guest_admins')
    .select('event_id')
    .eq('email', email);
  const eventIds = (rows || []).map((r: { event_id: string }) => r.event_id);
  if (eventIds.length === 0) return { email, role: 'none' };

  // Active = is_collaboration AND now < event.date + buffer  ⇔  event.date >= now - buffer.
  const cutoff = new Date(Date.now() - GUEST_EXPIRY_BUFFER_DAYS * 86400000).toISOString();
  const { data: events } = await supabase
    .from('events')
    .select('id')
    .in('id', eventIds)
    .eq('is_collaboration', true)
    .gte('date', cutoff);
  const activeIds = (events || []).map((e: { id: string }) => e.id);
  if (activeIds.length === 0) return { email, role: 'none' };

  return { email, role: 'guest', eventIds: activeIds };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd worker && npx vitest run src/guest/auth.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add worker/src/guest/auth.ts worker/src/guest/auth.test.ts worker/src/index.ts
git commit -m "feat: resolveRole resolves admin/guest/none from CF Access email"
```

### Task 4: Wire role resolution into `gateAdmin`

**Files:**
- Modify: `worker/src/index.ts:63-85` (gateAdmin)

- [ ] **Step 1: Update `gateAdmin` to resolve role and reject `none`**

In `worker/src/index.ts`, add the import near the other imports (after line 33):

```ts
import { resolveRole } from './guest/auth';
```

Replace the body of `gateAdmin` (lines 63-85) with:

```ts
async function gateAdmin(request: Request, env: Env): Promise<{ ok: true; admin: AdminContext } | { ok: false; response: Response }> {
  // Local dev escape hatch: when ENVIRONMENT=development, accept the
  // first email from ADMIN_EMAILS as a full admin without verifying a JWT.
  if (env.ENVIRONMENT === 'development') {
    const fallback = env.ADMIN_EMAILS.split(',')[0]?.trim();
    if (fallback) return { ok: true, admin: { email: fallback, role: 'admin' } };
  }

  const token = request.headers.get('Cf-Access-Jwt-Assertion') || '';
  const result = await verifyAccessJwt(token, env);
  if (!result.ok) {
    return {
      ok: false,
      response: new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    };
  }

  const admin = await resolveRole(result.email, env);
  if (admin.role === 'none') {
    return {
      ok: false,
      response: new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }),
    };
  }
  return { ok: true, admin };
}
```

- [ ] **Step 2: Update the whoami handler to include role**

In `worker/src/index.ts`, replace the whoami block (lines 157-162):

```ts
          if (!adminResponse && url.pathname === '/api/admin/whoami' && request.method === 'GET') {
            adminResponse = new Response(JSON.stringify({ email: gate.admin.email }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }
```

with (this block is only reached by full admins after Task 5's guest branch):

```ts
          if (!adminResponse && url.pathname === '/api/admin/whoami' && request.method === 'GET') {
            adminResponse = new Response(JSON.stringify({ email: gate.admin.email, role: 'admin' }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }
```

- [ ] **Step 3: Verify the worker still type-checks and tests pass**

Run: `cd worker && npx tsc --noEmit && npx vitest run`
Expected: PASS — no type errors, all existing tests green. (`gate.admin.email` is valid on every union member.)

- [ ] **Step 4: Commit**

```bash
git add worker/src/index.ts
git commit -m "feat: gateAdmin resolves role, rejects unknown emails with 403"
```

---

## Phase 3 — Worker guest endpoint surface

### Task 5: Scoped phone lookup

**Files:**
- Create: `worker/src/guest/lookup-phone.ts`
- Create: `worker/src/guest/lookup-phone.test.ts`

- [ ] **Step 1: Write the failing test**

Create `worker/src/guest/lookup-phone.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';

function mockEnv() {
  return {
    SUPABASE_URL: 'x', SUPABASE_SERVICE_KEY: 'x',
    UPI_ID: 'x', APPS_SCRIPT_URL: '', APPS_SCRIPT_SECRET: '', BGC_SITE_URL: '',
    CF_ACCESS_TEAM_DOMAIN: 'x', CF_ACCESS_AUD: 'x', ADMIN_EMAILS: '', ENVIRONMENT: 'production',
  } as any;
}

vi.mock('../supabase', () => ({ getSupabase: vi.fn() }));
import { getSupabase } from '../supabase';
import { handleGuestLookupPhone } from './lookup-phone';

function mockSupabase(user: { id: string; name: string; email: string } | null, seats: { seats: number }[]) {
  return {
    from: (table: string) => {
      if (table === 'users') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: user, error: null }) }) }) };
      }
      if (table === 'registrations') {
        return { select: () => ({ eq: () => ({ eq: () => ({ neq: async () => ({ data: seats, error: null }) }) }) }) };
      }
      return null;
    },
  };
}

function req(body: unknown) {
  return new Request('http://localhost/api/admin/lookup-phone', { method: 'POST', body: JSON.stringify(body) });
}

describe('handleGuestLookupPhone', () => {
  it('returns only name/email + seats, never membership/credit/promo', async () => {
    (getSupabase as any).mockReturnValue(mockSupabase({ id: 'u1', name: 'Asha', email: 'a@x.com' }, [{ seats: 2 }]));
    const res = await handleGuestLookupPhone(req({ phone: '9876543210', event_id: 'e1' }), mockEnv(), new Set(['e1']));
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toEqual({
      user: { found: true, name: 'Asha', email: 'a@x.com' },
      existing_seats_for_event: 2,
    });
    expect(body).not.toHaveProperty('membership');
    expect(body).not.toHaveProperty('credit_balance');
    expect(body).not.toHaveProperty('active_promo');
  });

  it('403s when event_id is outside the guest scope', async () => {
    (getSupabase as any).mockReturnValue(mockSupabase(null, []));
    const res = await handleGuestLookupPhone(req({ phone: '9876543210', event_id: 'other' }), mockEnv(), new Set(['e1']));
    expect(res.status).toBe(403);
  });

  it('400s on an invalid phone', async () => {
    (getSupabase as any).mockReturnValue(mockSupabase(null, []));
    const res = await handleGuestLookupPhone(req({ phone: 'abc' }), mockEnv(), new Set(['e1']));
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd worker && npx vitest run src/guest/lookup-phone.test.ts`
Expected: FAIL — `Cannot find module './lookup-phone'`.

- [ ] **Step 3: Implement the scoped lookup**

Create `worker/src/guest/lookup-phone.ts`:

```ts
import type { Env } from '../index';
import { getSupabase } from '../supabase';
import { sanitizePhone, jsonResponse } from '../validation';

export async function handleGuestLookupPhone(
  request: Request,
  env: Env,
  allowedEvents: Set<string>,
): Promise<Response> {
  const body = await request.json<{ phone?: string; event_id?: string }>().catch(() => null);
  const phone = sanitizePhone(body?.phone || '');
  if (!phone) return jsonResponse({ error: 'Invalid phone number' }, 400);
  if (body?.event_id && !allowedEvents.has(body.event_id)) {
    return jsonResponse({ error: 'Forbidden' }, 403);
  }

  const supabase = getSupabase(env);
  const { data: user } = await supabase
    .from('users')
    .select('id, name, email')
    .eq('phone', phone)
    .maybeSingle();

  let existingSeats = 0;
  if (user && body?.event_id) {
    const { data: priorRegs } = await supabase
      .from('registrations')
      .select('seats')
      .eq('event_id', body.event_id)
      .eq('user_id', user.id)
      .neq('payment_status', 'cancelled');
    existingSeats = (priorRegs || []).reduce((sum: number, r: { seats: number }) => sum + r.seats, 0);
  }

  return jsonResponse({
    user: { found: !!user, name: user?.name || null, email: user?.email || null },
    existing_seats_for_event: existingSeats,
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd worker && npx vitest run src/guest/lookup-phone.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add worker/src/guest/lookup-phone.ts worker/src/guest/lookup-phone.test.ts
git commit -m "feat: scoped guest phone lookup (no membership/credit/promo leak)"
```

### Task 6: `handleGuestRequest` router

**Files:**
- Create: `worker/src/guest/index.ts`
- Create: `worker/src/guest/index.test.ts`

- [ ] **Step 1: Write the failing test**

Create `worker/src/guest/index.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';

function mockEnv() {
  return {
    SUPABASE_URL: 'x', SUPABASE_SERVICE_KEY: 'x',
    UPI_ID: 'x', APPS_SCRIPT_URL: '', APPS_SCRIPT_SECRET: '', BGC_SITE_URL: '',
    CF_ACCESS_TEAM_DOMAIN: 'x', CF_ACCESS_AUD: 'x', ADMIN_EMAILS: '', ENVIRONMENT: 'production',
  } as any;
}
const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as any;

// Mock every downstream handler so we test ONLY routing + scope enforcement.
vi.mock('../admin/registrations', () => ({
  handleListRegistrations: vi.fn(async (url: URL) => new Response(JSON.stringify({ event_id: url.searchParams.get('event_id') }), { status: 200 })),
  handleGetRegistration: vi.fn(async () => new Response('{}', { status: 200 })),
  handleUpdateRegistration: vi.fn(async () => new Response('{}', { status: 200 })),
}));
vi.mock('../admin/register-manual', () => ({ handleManualRegister: vi.fn(async () => new Response('{}', { status: 200 })) }));
vi.mock('../cancel', () => ({ handleCancelRegistration: vi.fn(async () => new Response('{}', { status: 200 })) }));
vi.mock('../admin/events', () => ({ handleGetEvent: vi.fn(async () => new Response('{}', { status: 200 })) }));
vi.mock('../admin/log', () => ({ handleLog: vi.fn(async () => new Response('{}', { status: 200 })) }));
vi.mock('./lookup-phone', () => ({ handleGuestLookupPhone: vi.fn(async () => new Response('{}', { status: 200 })) }));
vi.mock('../supabase', () => ({ getSupabase: vi.fn() }));

import { getSupabase } from '../supabase';
import { handleGuestRequest } from './index';

const guest = { email: 'g@partner.in', eventIds: ['e1'] };

function mockRegLookup(eventId: string | null) {
  (getSupabase as any).mockReturnValue({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: eventId ? { event_id: eventId } : null, error: null }) }) }) }),
  });
}
function mockWhoamiEvents(events: { id: string; name: string; date: string }[]) {
  (getSupabase as any).mockReturnValue({
    from: () => ({ select: () => ({ in: async () => ({ data: events, error: null }) }) }),
  });
}
function r(method: string, path: string, body?: unknown) {
  return new Request(`http://localhost${path}`, { method, body: body ? JSON.stringify(body) : undefined });
}

describe('handleGuestRequest', () => {
  it('whoami returns role guest + scoped events', async () => {
    mockWhoamiEvents([{ id: 'e1', name: 'Collab', date: '2026-06-01T10:00:00Z' }]);
    const res = await handleGuestRequest(new URL('http://localhost/api/admin/whoami'), r('GET', '/api/admin/whoami'), mockEnv(), ctx, guest);
    const body = await res.json() as any;
    expect(body).toEqual({ email: 'g@partner.in', role: 'guest', events: [{ id: 'e1', name: 'Collab', date: '2026-06-01T10:00:00Z' }] });
  });

  it('registrations list with no event_id and one allowed event injects that event_id', async () => {
    const url = new URL('http://localhost/api/admin/registrations');
    const res = await handleGuestRequest(url, r('GET', '/api/admin/registrations'), mockEnv(), ctx, guest);
    const body = await res.json() as any;
    expect(body.event_id).toBe('e1');
  });

  it('registrations list with a foreign event_id is 403', async () => {
    const url = new URL('http://localhost/api/admin/registrations?event_id=other');
    const res = await handleGuestRequest(url, r('GET', '/api/admin/registrations?event_id=other'), mockEnv(), ctx, guest);
    expect(res.status).toBe(403);
  });

  it('GET registration belonging to a foreign event is 403', async () => {
    mockRegLookup('other');
    const url = new URL('http://localhost/api/admin/registrations/reg1');
    const res = await handleGuestRequest(url, r('GET', '/api/admin/registrations/reg1'), mockEnv(), ctx, guest);
    expect(res.status).toBe(403);
  });

  it('PATCH registration belonging to an allowed event passes through', async () => {
    mockRegLookup('e1');
    const url = new URL('http://localhost/api/admin/registrations/reg1');
    const res = await handleGuestRequest(url, r('PATCH', '/api/admin/registrations/reg1', { payment_status: 'confirmed' }), mockEnv(), ctx, guest);
    expect(res.status).toBe(200);
  });

  it('manual register with a foreign event_id is 403', async () => {
    const url = new URL('http://localhost/api/admin/registrations/manual');
    const res = await handleGuestRequest(url, r('POST', '/api/admin/registrations/manual', { event_id: 'other' }), mockEnv(), ctx, guest);
    expect(res.status).toBe(403);
  });

  it('cancel for a foreign registration is 403', async () => {
    mockRegLookup('other');
    const url = new URL('http://localhost/api/admin/cancel-registration');
    const res = await handleGuestRequest(url, r('POST', '/api/admin/cancel-registration', { registration_id: 'reg1' }), mockEnv(), ctx, guest);
    expect(res.status).toBe(403);
  });

  it('blocks an admin-only path with 403', async () => {
    const url = new URL('http://localhost/api/admin/users');
    const res = await handleGuestRequest(url, r('GET', '/api/admin/users'), mockEnv(), ctx, guest);
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd worker && npx vitest run src/guest/index.test.ts`
Expected: FAIL — `Cannot find module './index'` (the guest index).

- [ ] **Step 3: Implement `handleGuestRequest`**

Create `worker/src/guest/index.ts`:

```ts
import type { Env } from '../index';
import { getSupabase } from '../supabase';
import { jsonResponse } from '../validation';
import { handleListRegistrations, handleGetRegistration, handleUpdateRegistration } from '../admin/registrations';
import { handleManualRegister } from '../admin/register-manual';
import { handleCancelRegistration } from '../cancel';
import { handleGetEvent } from '../admin/events';
import { handleLog } from '../admin/log';
import { handleGuestLookupPhone } from './lookup-phone';

export interface GuestCtx {
  email: string;
  eventIds: string[];
}

async function registrationEventId(id: string, env: Env): Promise<string | null> {
  const supabase = getSupabase(env);
  const { data } = await supabase.from('registrations').select('event_id').eq('id', id).maybeSingle();
  return (data as { event_id: string } | null)?.event_id ?? null;
}

async function guestWhoami(env: Env, guest: GuestCtx): Promise<Response> {
  const supabase = getSupabase(env);
  const { data } = await supabase.from('events').select('id, name, date').in('id', guest.eventIds);
  return jsonResponse({ email: guest.email, role: 'guest', events: data || [] });
}

export async function handleGuestRequest(
  url: URL,
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  guest: GuestCtx,
): Promise<Response> {
  const p = url.pathname;
  const allowed = new Set(guest.eventIds);

  if (p === '/api/admin/whoami' && request.method === 'GET') {
    return guestWhoami(env, guest);
  }

  if (p === '/api/admin/log' && request.method === 'POST') {
    return handleLog(request, env, guest.email);
  }

  if (p === '/api/admin/lookup-phone' && request.method === 'POST') {
    return handleGuestLookupPhone(request, env, allowed);
  }

  if (p === '/api/admin/registrations' && request.method === 'GET') {
    const ev = url.searchParams.get('event_id');
    if (ev) {
      if (!allowed.has(ev)) return jsonResponse({ error: 'Forbidden' }, 403);
    } else if (guest.eventIds.length === 1) {
      url.searchParams.set('event_id', guest.eventIds[0]);
    } else {
      return jsonResponse({ error: 'event_id required' }, 400);
    }
    return handleListRegistrations(url, env);
  }

  if (p === '/api/admin/registrations/manual' && request.method === 'POST') {
    const body = (await request.clone().json().catch(() => null)) as { event_id?: string } | null;
    if (!body?.event_id || !allowed.has(body.event_id)) return jsonResponse({ error: 'Forbidden' }, 403);
    return handleManualRegister(request, env, ctx);
  }

  if (p === '/api/admin/cancel-registration' && request.method === 'POST') {
    const body = (await request.clone().json().catch(() => null)) as { registration_id?: string } | null;
    if (!body?.registration_id) return jsonResponse({ error: 'registration_id required' }, 400);
    const evId = await registrationEventId(body.registration_id, env);
    if (!evId || !allowed.has(evId)) return jsonResponse({ error: 'Forbidden' }, 403);
    return handleCancelRegistration(request, env);
  }

  const regMatch = p.match(/^\/api\/admin\/registrations\/([^/]+)$/);
  if (regMatch && regMatch[1] !== 'manual' && regMatch[1] !== 'export') {
    const id = regMatch[1];
    const evId = await registrationEventId(id, env);
    if (!evId || !allowed.has(evId)) return jsonResponse({ error: 'Forbidden' }, 403);
    if (request.method === 'GET') return handleGetRegistration(id, env);
    if (request.method === 'PATCH') return handleUpdateRegistration(id, request, env);
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const evMatch = p.match(/^\/api\/admin\/events\/([^/]+)$/);
  if (evMatch && request.method === 'GET') {
    if (!allowed.has(evMatch[1])) return jsonResponse({ error: 'Forbidden' }, 403);
    return handleGetEvent(evMatch[1], env);
  }

  return jsonResponse({ error: 'Forbidden' }, 403);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd worker && npx vitest run src/guest/index.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add worker/src/guest/index.ts worker/src/guest/index.test.ts
git commit -m "feat: handleGuestRequest — isolated, event-scoped guest endpoint surface"
```

### Task 7: Route guests into `handleGuestRequest` from `index.ts`

**Files:**
- Modify: `worker/src/index.ts:113-118` (admin branch entry)

- [ ] **Step 1: Add the import**

In `worker/src/index.ts`, after the `resolveRole` import added in Task 4:

```ts
import { handleGuestRequest } from './guest';
```

- [ ] **Step 2: Branch guests before the admin chain**

In `worker/src/index.ts`, replace lines 113-118:

```ts
      } else if (url.pathname.startsWith('/api/admin/')) {
        const gate = await gateAdmin(request, env);
        if (!gate.ok) {
          response = gate.response;
        } else {
          let adminResponse: Response | null = null;
```

with:

```ts
      } else if (url.pathname.startsWith('/api/admin/')) {
        const gate = await gateAdmin(request, env);
        if (!gate.ok) {
          response = gate.response;
        } else if (gate.admin.role === 'guest') {
          response = await handleGuestRequest(url, request, env, ctx, gate.admin);
        } else {
          let adminResponse: Response | null = null;
```

(The closing braces of the existing `else` block are unchanged — the new `else if` slots in before it.)

- [ ] **Step 3: Type-check and run the full worker suite**

Run: `cd worker && npx tsc --noEmit && npx vitest run`
Expected: PASS. In the admin `else` branch, `gate.admin` narrows to `{role:'admin'} | {role:'none'}`; `gate.admin.email` remains valid.

- [ ] **Step 4: Commit**

```bash
git add worker/src/index.ts
git commit -m "feat: route guest-role requests to the isolated guest surface"
```

---

## Phase 4 — Event collaboration settings + CF Access sync

### Task 8: CF Access group sync helpers

**Files:**
- Create: `worker/src/guest/cf-access.ts`
- Create: `worker/src/guest/cf-access.test.ts`
- Modify: `worker/src/index.ts:35-48` (Env)

- [ ] **Step 1: Add the CF secrets to `Env`**

In `worker/src/index.ts`, inside the `Env` interface (after line 47 `REPLAY_TO_BGC_SECRET: string;`), add:

```ts
  CF_API_TOKEN?: string;
  CF_ACCOUNT_ID?: string;
  CF_ACCESS_GROUP_ID?: string;
```

- [ ] **Step 2: Write the failing test**

Create `worker/src/guest/cf-access.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

function mockEnv(extra: Record<string, string> = {}) {
  return {
    SUPABASE_URL: 'x', SUPABASE_SERVICE_KEY: 'x',
    UPI_ID: 'x', APPS_SCRIPT_URL: '', APPS_SCRIPT_SECRET: '', BGC_SITE_URL: '',
    CF_ACCESS_TEAM_DOMAIN: 'x', CF_ACCESS_AUD: 'x', ADMIN_EMAILS: '', ENVIRONMENT: 'production',
    ...extra,
  } as any;
}

vi.mock('../supabase', () => ({ getSupabase: vi.fn() }));
import { getSupabase } from '../supabase';
import { activeGuestEmails, syncCfAccessGroup } from './cf-access';

function mockSupabase(activeEvents: { id: string }[], guestRows: { email: string }[]) {
  return {
    from: (table: string) => {
      if (table === 'events') {
        return { select: () => ({ eq: () => ({ gte: async () => ({ data: activeEvents, error: null }) }) }) };
      }
      if (table === 'event_guest_admins') {
        return { select: () => ({ in: async () => ({ data: guestRows, error: null }) }) };
      }
      return null;
    },
  };
}

describe('activeGuestEmails', () => {
  it('returns the de-duped set of guest emails across active collaboration events', async () => {
    (getSupabase as any).mockReturnValue(mockSupabase([{ id: 'e1' }, { id: 'e2' }], [{ email: 'a@x.com' }, { email: 'a@x.com' }, { email: 'b@x.com' }]));
    const emails = await activeGuestEmails(mockEnv());
    expect(emails.sort()).toEqual(['a@x.com', 'b@x.com']);
  });

  it('returns [] when no events are active', async () => {
    (getSupabase as any).mockReturnValue(mockSupabase([], []));
    expect(await activeGuestEmails(mockEnv())).toEqual([]);
  });
});

describe('syncCfAccessGroup', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('skips (no fetch) when CF secrets are missing', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    (getSupabase as any).mockReturnValue(mockSupabase([{ id: 'e1' }], [{ email: 'a@x.com' }]));
    await syncCfAccessGroup(mockEnv());
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('PUTs the active email set to the CF group when secrets are present', async () => {
    const fetchSpy = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    (getSupabase as any).mockReturnValue(mockSupabase([{ id: 'e1' }], [{ email: 'a@x.com' }]));
    await syncCfAccessGroup(mockEnv({ CF_API_TOKEN: 't', CF_ACCOUNT_ID: 'acc', CF_ACCESS_GROUP_ID: 'grp' }));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = fetchSpy.mock.calls[0];
    expect(calledUrl).toBe('https://api.cloudflare.com/client/v4/accounts/acc/access/groups/grp');
    expect(init.method).toBe('PUT');
    const sent = JSON.parse(init.body);
    expect(sent.include).toEqual([{ email: { email: 'a@x.com' } }]);
  });

  it('sends a non-matching placeholder include when there are no active guests', async () => {
    const fetchSpy = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    (getSupabase as any).mockReturnValue(mockSupabase([], []));
    await syncCfAccessGroup(mockEnv({ CF_API_TOKEN: 't', CF_ACCOUNT_ID: 'acc', CF_ACCESS_GROUP_ID: 'grp' }));
    const sent = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(sent.include).toEqual([{ email: { email: 'no-guests@invalid.bgc' } }]);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd worker && npx vitest run src/guest/cf-access.test.ts`
Expected: FAIL — `Cannot find module './cf-access'`.

- [ ] **Step 4: Implement the sync helpers**

Create `worker/src/guest/cf-access.ts`:

```ts
import type { Env } from '../index';
import { getSupabase } from '../supabase';
import { GUEST_EXPIRY_BUFFER_DAYS } from './auth';

export async function activeGuestEmails(env: Env): Promise<string[]> {
  const supabase = getSupabase(env);
  const cutoff = new Date(Date.now() - GUEST_EXPIRY_BUFFER_DAYS * 86400000).toISOString();
  const { data: events } = await supabase
    .from('events')
    .select('id')
    .eq('is_collaboration', true)
    .gte('date', cutoff);
  const ids = (events || []).map((e: { id: string }) => e.id);
  if (ids.length === 0) return [];

  const { data: rows } = await supabase
    .from('event_guest_admins')
    .select('email')
    .in('event_id', ids);
  return [...new Set((rows || []).map((r: { email: string }) => r.email))];
}

export async function syncCfAccessGroup(env: Env): Promise<void> {
  if (!env.CF_API_TOKEN || !env.CF_ACCOUNT_ID || !env.CF_ACCESS_GROUP_ID) {
    console.warn('[cf-access] sync skipped: CF_API_TOKEN / CF_ACCOUNT_ID / CF_ACCESS_GROUP_ID not set');
    return;
  }

  const emails = await activeGuestEmails(env);
  // CF Access groups require a non-empty include. When there are no guests, use a
  // placeholder that can never match a real login so the group grants nobody.
  const include =
    emails.length > 0
      ? emails.map((email) => ({ email: { email } }))
      : [{ email: { email: 'no-guests@invalid.bgc' } }];

  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/access/groups/${env.CF_ACCESS_GROUP_ID}`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${env.CF_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'BGC Guest Admins', include }),
    },
  );
  if (!res.ok) {
    console.error('[cf-access] sync failed', res.status, await res.text());
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd worker && npx vitest run src/guest/cf-access.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add worker/src/guest/cf-access.ts worker/src/guest/cf-access.test.ts worker/src/index.ts
git commit -m "feat: CF Access group sync for active guest admin emails"
```

### Task 9: Events handlers accept `is_collaboration` + `guest_admins`

**Files:**
- Modify: `worker/src/admin/events.ts`
- Create: `worker/src/admin/events.test.ts`
- Modify: `worker/src/index.ts:129-133` (events call sites)

- [ ] **Step 1: Write the failing test**

Create `worker/src/admin/events.test.ts`:

```ts
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

function mockSupabase(existingGuests: { email: string }[], capture: Capture) {
  return {
    from: (table: string) => {
      if (table === 'events') {
        return {
          update: (row: any) => { capture.eventUpdate = row; return { eq: () => ({ select: () => ({ maybeSingle: async () => ({ data: { id: 'e1', ...row }, error: null }) }) }) }; },
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
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd worker && npx vitest run src/admin/events.test.ts`
Expected: FAIL — `handleUpdateEvent` currently takes 3 args and ignores `is_collaboration`/`guest_admins`.

- [ ] **Step 3: Implement the events changes**

In `worker/src/admin/events.ts`:

(a) Add imports at the top (after line 3):

```ts
import type { ExecutionContext } from '@cloudflare/workers-types';
import { syncCfAccessGroup } from '../guest/cf-access';
```

> Note: if `@cloudflare/workers-types` is not already the source of `ExecutionContext`, drop the explicit import and type the param as `ExecutionContext` (the global is in scope in this project, as in `register-manual.ts`). Verify with the type-check in Step 4.

(b) Add `is_collaboration` to `EVENT_FIELDS` (line 27-31):

```ts
const EVENT_FIELDS = [
  'name', 'description', 'date', 'venue_name', 'venue_area',
  'price', 'capacity', 'custom_questions', 'price_includes', 'llm_notes', 'is_published',
  'guild_path_exclusive', 'is_collaboration',
] as const;
```

(c) Add a guest-sync helper and update `handleGetEvent` to include guest emails. Replace `handleGetEvent` (lines 15-25) with:

```ts
export async function handleGetEvent(id: string, env: Env): Promise<Response> {
  const supabase = getSupabase(env);
  const { data, error } = await supabase
    .from('events')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) return jsonResponse({ error: 'Failed to load event' }, 500);
  if (!data) return jsonResponse({ error: 'Event not found' }, 404);

  const { data: guests } = await supabase
    .from('event_guest_admins')
    .select('email')
    .eq('event_id', id);
  return jsonResponse({ event: { ...data, guest_admins: (guests || []).map((g: { email: string }) => g.email) } });
}

function normalizeEmails(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out = new Set<string>();
  for (const raw of input) {
    if (typeof raw !== 'string') continue;
    const email = raw.trim().toLowerCase();
    if (email.includes('@') && email.length <= 254) out.add(email);
  }
  return [...out];
}

async function syncEventGuests(
  supabase: ReturnType<typeof getSupabase>,
  eventId: string,
  emails: string[],
  createdBy: string,
): Promise<void> {
  const { data: existing } = await supabase
    .from('event_guest_admins')
    .select('email')
    .eq('event_id', eventId);
  const existingEmails = (existing || []).map((r: { email: string }) => r.email);

  const toAdd = emails.filter((e) => !existingEmails.includes(e));
  const toRemove = existingEmails.filter((e) => !emails.includes(e));

  if (toRemove.length > 0) {
    await supabase.from('event_guest_admins').delete().eq('event_id', eventId).in('email', toRemove);
  }
  if (toAdd.length > 0) {
    await supabase.from('event_guest_admins').upsert(
      toAdd.map((email) => ({ event_id: eventId, email, created_by: createdBy })),
    );
  }
}
```

(d) Replace `handleUpdateEvent` (lines 71-89) with a version that takes `ctx` + `adminEmail` and handles guests:

```ts
export async function handleUpdateEvent(
  id: string,
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  adminEmail: string,
): Promise<Response> {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return jsonResponse({ error: 'Invalid request body' }, 400);
  const payload = pickEventFields(body);
  const hasGuests = 'guest_admins' in body;
  if (Object.keys(payload).length === 0 && !hasGuests) return jsonResponse({ error: 'No fields to update' }, 400);
  const err = validateEventPayload(payload, false);
  if (err) return jsonResponse({ error: err }, 400);

  const supabase = getSupabase(env);

  let data: Record<string, unknown> | null = null;
  if (Object.keys(payload).length > 0) {
    const result = await supabase.from('events').update(payload).eq('id', id).select('*').maybeSingle();
    if (result.error) return jsonResponse({ error: 'Failed to update event' }, 500);
    if (!result.data) return jsonResponse({ error: 'Event not found' }, 404);
    data = result.data;
  } else {
    const result = await supabase.from('events').select('*').eq('id', id).maybeSingle();
    if (!result.data) return jsonResponse({ error: 'Event not found' }, 404);
    data = result.data;
  }

  if (hasGuests) {
    await syncEventGuests(supabase, id, normalizeEmails(body.guest_admins), adminEmail);
    ctx.waitUntil(syncCfAccessGroup(env));
  }

  return jsonResponse({ event: data });
}
```

- [ ] **Step 4: Update the call site in `index.ts`**

In `worker/src/index.ts`, in the events routing block (lines 126-134), update the PATCH branch to pass `ctx` and the admin email:

```ts
              else if (eventId && request.method === 'PATCH') adminResponse = await handleUpdateEvent(eventId, request, env, ctx, gate.admin.email);
```

(Leave `handleCreateEvent`, `handleGetEvent`, `handleListEvents` calls unchanged. Collaboration is configured by editing an event, so create needs no guest handling.)

- [ ] **Step 5: Run the tests and type-check**

Run: `cd worker && npx tsc --noEmit && npx vitest run src/admin/events.test.ts`
Expected: PASS (3 tests), no type errors.

- [ ] **Step 6: Commit**

```bash
git add worker/src/admin/events.ts worker/src/admin/events.test.ts worker/src/index.ts
git commit -m "feat: event collaboration toggle + guest admin list with CF sync"
```

### Task 10: Daily CF Access sync in the scheduled handler

**Files:**
- Modify: `worker/src/index.ts:281+` (scheduled handler)

- [ ] **Step 1: Add the import**

In `worker/src/index.ts`, after the `handleGuestRequest` import:

```ts
import { syncCfAccessGroup } from './guest/cf-access';
```

- [ ] **Step 2: Trigger the sync from `scheduled`**

In `worker/src/index.ts`, inside the `scheduled` handler (starting line 281), add at the top of the function body (before the existing `PAGES_DEPLOY_HOOK` logic):

```ts
    ctx.waitUntil(syncCfAccessGroup(env));
```

- [ ] **Step 3: Type-check**

Run: `cd worker && npx tsc --noEmit && npx vitest run`
Expected: PASS — full worker suite green.

- [ ] **Step 4: Commit**

```bash
git add worker/src/index.ts
git commit -m "feat: prune CF Access guest group daily via scheduled handler"
```

---

## Phase 5 — Admin SPA: whoami provider + guest shell

### Task 11: whoami context provider

**Files:**
- Create: `admin/src/lib/whoami.tsx`
- Create: `admin/src/lib/whoami.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `admin/src/lib/whoami.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

vi.mock('./api', () => ({ fetchAdmin: vi.fn() }));
import { fetchAdmin } from './api';
import { WhoAmIProvider, useWhoAmI } from './whoami';

function Probe() {
  const who = useWhoAmI();
  return <div>role:{who?.role}</div>;
}

describe('WhoAmIProvider', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows the fallback until whoami resolves, then renders children with the role', async () => {
    (fetchAdmin as any).mockResolvedValue({ email: 'g@x.com', role: 'guest', events: [] });
    render(
      <WhoAmIProvider fallback={<div>loading</div>}>
        {() => <Probe />}
      </WhoAmIProvider>,
    );
    expect(screen.getByText('loading')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('role:guest')).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd admin && npx vitest run src/lib/whoami.test.tsx`
Expected: FAIL — `Cannot find module './whoami'`.

- [ ] **Step 3: Implement the provider**

Create `admin/src/lib/whoami.tsx`:

```tsx
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { fetchAdmin } from './api';

export interface GuestEvent {
  id: string;
  name: string;
  date: string;
}

export interface WhoAmI {
  email: string;
  role: 'admin' | 'guest';
  events?: GuestEvent[];
}

const WhoAmIContext = createContext<WhoAmI | null>(null);

export function useWhoAmI(): WhoAmI | null {
  return useContext(WhoAmIContext);
}

export function WhoAmIProvider({
  children,
  fallback,
}: {
  children: (who: WhoAmI) => ReactNode;
  fallback: ReactNode;
}) {
  const [who, setWho] = useState<WhoAmI | null>(null);

  useEffect(() => {
    fetchAdmin<WhoAmI>('/api/admin/whoami')
      .then(setWho)
      .catch(() => setWho({ email: '', role: 'admin' }));
  }, []);

  if (!who) return <>{fallback}</>;
  return <WhoAmIContext.Provider value={who}>{children(who)}</WhoAmIContext.Provider>;
}
```

> Rationale for the `.catch` default: a transient whoami failure should not lock a real admin out of the tool. The worker still enforces the true gate on every endpoint, so defaulting to the (more restricted-by-the-server) admin UI is safe — a guest whose whoami failed simply can't load admin data and the api client reloads on 401/403.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd admin && npx vitest run src/lib/whoami.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add admin/src/lib/whoami.tsx admin/src/lib/whoami.test.tsx
git commit -m "feat: whoami context provider for the admin SPA"
```

### Task 12: Guest shell + route branch

**Files:**
- Create: `admin/src/components/GuestLayout.tsx`
- Create: `admin/src/GuestApp.tsx`
- Modify: `admin/src/App.tsx`

- [ ] **Step 1: Create the guest layout**

Create `admin/src/components/GuestLayout.tsx`:

```tsx
import { Outlet } from 'react-router-dom';
import { OfflineBanner } from './OfflineBanner';
import { useWhoAmI } from '@/lib/whoami';

export default function GuestLayout() {
  const who = useWhoAmI();
  const events = who?.events ?? [];
  const title = events.length === 1 ? events[0].name : 'Collaboration registrations';

  return (
    <div className="flex flex-col h-full">
      <OfflineBanner />
      <header className="border-b px-4 py-3 flex items-center justify-between">
        <div className="min-w-0">
          <div className="font-semibold truncate">{title}</div>
          <div className="text-xs text-muted-foreground truncate">Guest access · {who?.email}</div>
        </div>
        <a href="/cdn-cgi/access/logout" className="text-sm text-muted-foreground underline shrink-0 ml-3">
          Sign out
        </a>
      </header>
      <main
        className="flex-1 overflow-auto bg-muted/30 p-4"
        style={{ paddingBottom: 'calc(2rem + env(safe-area-inset-bottom))' }}
      >
        <Outlet />
      </main>
    </div>
  );
}
```

- [ ] **Step 2: Create the guest route table**

Create `admin/src/GuestApp.tsx`:

```tsx
import { Routes, Route, Navigate } from 'react-router-dom';
import GuestLayout from './components/GuestLayout';
import RegistrationsList from './pages/RegistrationsList';
import RegistrationDrawer from './pages/RegistrationDrawer';
import ManualRegistrationDrawer from './pages/ManualRegistrationDrawer';

export default function GuestApp() {
  return (
    <Routes>
      <Route element={<GuestLayout />}>
        <Route path="/registrations" element={<RegistrationsList />} />
        <Route path="/registrations/new" element={<><RegistrationsList /><ManualRegistrationDrawer /></>} />
        <Route path="/registrations/:id" element={<><RegistrationsList /><RegistrationDrawer /></>} />
        <Route path="*" element={<Navigate to="/registrations" replace />} />
      </Route>
    </Routes>
  );
}
```

- [ ] **Step 3: Branch `App.tsx` on role**

Replace `admin/src/App.tsx` entirely with:

```tsx
import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import EventsList from './pages/EventsList';
import EventDrawer from './pages/EventDrawer';
import GamesList from './pages/GamesList';
import GameDrawer from './pages/GameDrawer';
import RegistrationsList from './pages/RegistrationsList';
import RegistrationDrawer from './pages/RegistrationDrawer';
import ManualRegistrationDrawer from './pages/ManualRegistrationDrawer';
import GuildList from './pages/GuildList';
import GuildDrawer from './pages/GuildDrawer';
import UsersList from './pages/UsersList';
import UserDrawer from './pages/UserDrawer';
import Leads from './pages/Leads';
import Giveaways from './pages/Giveaways';
import GuestApp from './GuestApp';
import { WhoAmIProvider } from './lib/whoami';
import { Loading } from './components/Loading';
import { Toaster } from '@/components/ui/sonner';

function AdminRoutes() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/events" element={<EventsList />} />
        <Route path="/events/new" element={<><EventsList /><EventDrawer mode="create" /></>} />
        <Route path="/events/:id" element={<><EventsList /><EventDrawer mode="edit" /></>} />
        <Route path="/games" element={<GamesList />} />
        <Route path="/games/new" element={<><GamesList /><GameDrawer mode="create" /></>} />
        <Route path="/games/:id" element={<><GamesList /><GameDrawer mode="edit" /></>} />
        <Route path="/registrations" element={<RegistrationsList />} />
        <Route path="/registrations/new" element={<><RegistrationsList /><ManualRegistrationDrawer /></>} />
        <Route path="/registrations/:id" element={<><RegistrationsList /><RegistrationDrawer /></>} />
        <Route path="/leads" element={<Leads />} />
        <Route path="/giveaways" element={<Giveaways />} />
        <Route path="/guild" element={<GuildList />} />
        <Route path="/guild/:id" element={<><GuildList /><GuildDrawer /></>} />
        <Route path="/guild/:id/user" element={<><GuildList /><GuildDrawer /><UserDrawer /></>} />
        <Route path="/users" element={<UsersList />} />
        <Route path="/users/:id" element={<><UsersList /><UserDrawer /></>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <>
      <WhoAmIProvider fallback={<div className="p-8"><Loading /></div>}>
        {(who) => (who.role === 'guest' ? <GuestApp /> : <AdminRoutes />)}
      </WhoAmIProvider>
      <Toaster />
    </>
  );
}
```

> Confirm the `Loading` import shape: `admin/src/components/Loading.tsx` is imported elsewhere — match its actual export (named `Loading` vs default). Adjust the import line if the type-check flags it.

- [ ] **Step 4: Type-check and run admin tests**

Run: `cd admin && npx tsc --noEmit && npx vitest run`
Expected: PASS — no type errors, existing tests green.

- [ ] **Step 5: Commit**

```bash
git add admin/src/App.tsx admin/src/GuestApp.tsx admin/src/components/GuestLayout.tsx
git commit -m "feat: guest SPA shell branched by whoami role"
```

---

## Phase 6 — Admin SPA: guest-aware components + collaboration UI

### Task 13: Make `RegistrationsList` guest-aware

**Files:**
- Modify: `admin/src/pages/RegistrationsList.tsx`

- [ ] **Step 1: Import the whoami hook**

In `admin/src/pages/RegistrationsList.tsx`, add after line 25 (`import type { Registration, Event }...`):

```ts
import { useWhoAmI } from '@/lib/whoami';
```

- [ ] **Step 2: Derive guest state and source events from whoami**

Replace the `loadEvents` definition (lines 43-47):

```ts
  const loadEvents = useCallback(() => {
    fetchAdmin<{ events: Event[] }>('/api/admin/events').then((r) => setEvents(r.events)).catch(showApiError);
  }, []);

  useEffect(() => { loadEvents(); }, [loadEvents]);
```

with:

```ts
  const who = useWhoAmI();
  const isGuest = who?.role === 'guest';
  const guestEvents = who?.events ?? [];

  const loadEvents = useCallback(() => {
    if (isGuest) {
      // Guests cannot call /api/admin/events (admin-only). Use the scoped list from whoami.
      setEvents(guestEvents as unknown as Event[]);
      return;
    }
    fetchAdmin<{ events: Event[] }>('/api/admin/events').then((r) => setEvents(r.events)).catch(showApiError);
  }, [isGuest, guestEvents]);

  useEffect(() => { loadEvents(); }, [loadEvents]);

  // A guest must always have an event selected (the API requires event_id and never returns "all").
  useEffect(() => {
    if (isGuest && !eventFilter && guestEvents.length >= 1) {
      setEventFilter(guestEvents[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGuest, guestEvents.length]);
```

> `setEventFilter` is defined later in the component (function declaration, hoisted) — referencing it from this effect is safe.

- [ ] **Step 3: Lock the event dropdown for guests**

Replace the event `Select` block (lines 290-298):

```tsx
        <Select value={eventFilter || 'all'} onValueChange={(v) => setEventFilter(v === 'all' ? '' : v)}>
          <SelectTrigger className="w-72"><SelectValue placeholder="All events" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All events</SelectItem>
            {upcoming.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
            {past.length > 0 && <SelectItem value="__sep" disabled>── past ──</SelectItem>}
            {past.map((e) => <SelectItem key={e.id} value={e.id}>{e.name} (past)</SelectItem>)}
          </SelectContent>
        </Select>
```

with:

```tsx
        {isGuest ? (
          guestEvents.length > 1 ? (
            <Select value={eventFilter} onValueChange={(v) => setEventFilter(v)}>
              <SelectTrigger className="w-72"><SelectValue placeholder="Pick an event" /></SelectTrigger>
              <SelectContent>
                {guestEvents.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
              </SelectContent>
            </Select>
          ) : null
        ) : (
          <Select value={eventFilter || 'all'} onValueChange={(v) => setEventFilter(v === 'all' ? '' : v)}>
            <SelectTrigger className="w-72"><SelectValue placeholder="All events" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All events</SelectItem>
              {upcoming.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
              {past.length > 0 && <SelectItem value="__sep" disabled>── past ──</SelectItem>}
              {past.map((e) => <SelectItem key={e.id} value={e.id}>{e.name} (past)</SelectItem>)}
            </SelectContent>
          </Select>
        )}
```

- [ ] **Step 4: Hide the Saved views menu for guests (depends on cross-event params)**

In the same JSX, wrap the `DropdownMenu` (Saved views, lines 334-354) so it only renders for non-guests. Change the opening line from:

```tsx
        <DropdownMenu>
```

to:

```tsx
        {!isGuest && <DropdownMenu>
```

and the closing `</DropdownMenu>` (line 354) to:

```tsx
        </DropdownMenu>}
```

- [ ] **Step 5: Type-check and verify in the browser**

Run: `cd admin && npx tsc --noEmit && npx vitest run`
Expected: PASS.

Manual: with the worker running in dev and `ENVIRONMENT=development`, you act as a full admin (the dev escape hatch). Guest UI is best verified after deploy with a real guest email; at minimum confirm the admin registrations page still behaves (event dropdown, filters, bulk actions) — i.e. no regression. State explicitly in your report that true guest-mode rendering needs a deployed environment to test.

- [ ] **Step 6: Commit**

```bash
git add admin/src/pages/RegistrationsList.tsx
git commit -m "feat: registrations list locks to scoped event in guest mode"
```

### Task 14: Make `ManualRegistrationDrawer` guest-aware

**Files:**
- Modify: `admin/src/pages/ManualRegistrationDrawer.tsx`

- [ ] **Step 1: Make the lookup fields optional and import whoami**

In `admin/src/pages/ManualRegistrationDrawer.tsx`, replace the `PhoneLookup` interface (lines 14-19):

```ts
interface PhoneLookup {
  user: { found: boolean; name: string | null; email: string | null };
  membership: { isMember: boolean; tier: string | null; discount: string | null; plus_ones_remaining: number };
  existing_seats_for_event: number;
  credit_balance: number;
}
```

with:

```ts
interface PhoneLookup {
  user: { found: boolean; name: string | null; email: string | null };
  membership?: { isMember: boolean; tier: string | null; discount: string | null; plus_ones_remaining: number };
  existing_seats_for_event: number;
  credit_balance?: number;
}
```

Add after line 12 (`import type { Event, CustomQuestion }...`):

```ts
import { useWhoAmI } from '@/lib/whoami';
import { useSearchParams } from 'react-router-dom';
```

- [ ] **Step 2: Source events from whoami for guests**

Replace the events-loading effect (lines 47-73) with a guest-aware version:

```tsx
  const who = useWhoAmI();
  const isGuest = who?.role === 'guest';
  const guestEvents = who?.events ?? [];
  const [searchParams] = useSearchParams();

  useEffect(() => {
    if (isGuest) {
      const evts = guestEvents as unknown as Event[];
      setEvents(evts);
      const fromUrl = searchParams.get('event');
      const startEventId = (fromUrl && evts.some((e) => e.id === fromUrl) ? fromUrl : evts[0]?.id) ?? '';
      setEventId(startEventId);
      setInitial({ eventId: startEventId, name: '', phone: '', email: '', seats: 1, paymentStatus: 'confirmed', customAnswers: {} });
      return;
    }
    fetchAdmin<{ events: Event[] }>('/api/admin/events')
      .then((r) => {
        setEvents(r.events);
        const remembered = typeof window !== 'undefined' ? localStorage.getItem(LAST_EVENT_KEY) : null;
        let startEventId = '';
        if (remembered && r.events.some((e) => e.id === remembered)) {
          startEventId = remembered;
        } else {
          const upcoming = r.events
            .filter((e) => Date.parse(e.date) >= Date.now())
            .sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
          startEventId = upcoming[0]?.id ?? '';
        }
        setEventId(startEventId);
        setInitial({ eventId: startEventId, name: '', phone: '', email: '', seats: 1, paymentStatus: 'confirmed', customAnswers: {} });
      })
      .catch(showApiError);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGuest, guestEvents.length]);
```

> For guests, `event.custom_questions` is absent on the lite whoami event, so the custom-questions section simply renders nothing — acceptable. If a collaboration event needs custom questions captured by guests, that is a follow-up (out of scope here).

- [ ] **Step 3: Guard the membership/credit render against the optional fields**

Replace the membership/credit/exclusive banner block (lines 198-213) with `?.`-guarded versions:

```tsx
        {lookup && lookup.membership?.isMember && (
          <div className="text-xs rounded-md bg-emerald-50 text-emerald-900 p-2">
            Active {lookup.membership.tier} member · {lookup.membership.plus_ones_remaining} plus-ones remaining
          </div>
        )}
        {lookup && (lookup.credit_balance ?? 0) > 0 && (
          <div className="text-xs rounded-md bg-amber-50 text-amber-900 p-2">
            ₹{lookup.credit_balance} credit available — will auto-apply against this registration's total.
          </div>
        )}
        {lookup && !lookup.membership?.isMember && event?.guild_path_exclusive && (
          <div className="text-xs rounded-md bg-yellow-50 text-yellow-900 border border-yellow-200 p-2">
            ⚠️ This event is Guild Path Exclusive and this user isn't a current member.
            You can still register them, but consider adding them to Guild Path first.
          </div>
        )}
```

- [ ] **Step 4: Lock the event picker for guests**

Replace the event `field(...)` block (lines 178-189) with:

```tsx
        {field('event_id', 'Event', (
          <Select value={eventId} onValueChange={pickEvent} disabled={isGuest && guestEvents.length <= 1}>
            <SelectTrigger><SelectValue placeholder="Pick an event" /></SelectTrigger>
            <SelectContent>
              {events.map((e) => (
                <SelectItem key={e.id} value={e.id}>
                  {e.name} — {new Date(e.date).toLocaleDateString()}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ))}
```

- [ ] **Step 5: Type-check and run admin tests**

Run: `cd admin && npx tsc --noEmit && npx vitest run`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add admin/src/pages/ManualRegistrationDrawer.tsx
git commit -m "feat: manual registration drawer guest-aware (scoped events + lookup)"
```

### Task 15: Collaboration toggle + guest email editor in `EventDrawer`

**Files:**
- Modify: `admin/src/lib/types.ts:14-29` (Event)
- Modify: `admin/src/pages/EventDrawer.tsx`

- [ ] **Step 1: Add `is_collaboration` to the `Event` type**

In `admin/src/lib/types.ts`, in the `Event` interface (after line 27 `guild_path_exclusive: boolean;`), add:

```ts
  is_collaboration: boolean;
```

- [ ] **Step 2: Add collaboration state to `EventDrawer`**

In `admin/src/pages/EventDrawer.tsx`:

(a) Add `is_collaboration: false` to the `empty` object (line 18-22), so it reads:

```ts
const empty: Partial<Event> = {
  name: '', description: '', date: '', venue_name: '', venue_area: '',
  price: 0, capacity: 0, custom_questions: [], price_includes: '', llm_notes: '',
  is_published: false, guild_path_exclusive: false, is_collaboration: false,
};
```

(b) Add guest-email state after line 33 (`const [venueSuggestions...]`):

```ts
  const [guestAdmins, setGuestAdmins] = useState<string[]>([]);
  const [guestInput, setGuestInput] = useState('');
```

(c) In the edit-load `.then` (line 38), capture guest emails. Replace:

```ts
        .then((r) => { setForm(r.event); setInitial(r.event); })
```

with:

```ts
        .then((r) => {
          setForm(r.event);
          setInitial(r.event);
          setGuestAdmins(((r.event as Event & { guest_admins?: string[] }).guest_admins) ?? []);
        })
```

- [ ] **Step 3: Include guest data in the save payload**

In the `save()` function, replace the `payload` construction (lines 96-100):

```ts
      const payload = {
        ...form,
        date: form.date ? new Date(form.date).toISOString() : '',
        custom_questions: form.custom_questions || [],
      };
```

with:

```ts
      const payload = {
        ...form,
        date: form.date ? new Date(form.date).toISOString() : '',
        custom_questions: form.custom_questions || [],
        ...(mode === 'edit' ? { guest_admins: form.is_collaboration ? guestAdmins : [] } : {}),
      };
```

> Guest emails are only persisted on edit (the worker's `handleUpdateEvent` handles `guest_admins`; create does not). The drawer flow is: create the event, then edit it to mark it a collaboration and add guests. When collaboration is turned off, an empty `guest_admins` is sent, which removes all guests and re-syncs CF Access.

- [ ] **Step 4: Add the dirty-check for guest emails**

Replace the `dirty` definition (line 80):

```ts
  const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(initial), [form, initial]);
```

with:

```ts
  const dirty = useMemo(
    () => JSON.stringify(form) !== JSON.stringify(initial) || JSON.stringify(guestAdmins) !== JSON.stringify(initialGuests),
    [form, initial, guestAdmins, initialGuests],
  );
```

and add an `initialGuests` ref/state. After the `guestInput` state (Step 2b), add:

```ts
  const [initialGuests, setInitialGuests] = useState<string[]>([]);
```

and in the edit-load `.then` from Step 2c, also set it:

```ts
          setGuestAdmins(loaded);
          setInitialGuests(loaded);
```

where you compute `const loaded = ((r.event as Event & { guest_admins?: string[] }).guest_admins) ?? [];` once and use it for both. Final `.then`:

```ts
        .then((r) => {
          setForm(r.event);
          setInitial(r.event);
          const loaded = ((r.event as Event & { guest_admins?: string[] }).guest_admins) ?? [];
          setGuestAdmins(loaded);
          setInitialGuests(loaded);
        })
```

- [ ] **Step 5: Render the collaboration toggle + email chips**

In the JSX, after the Guild Path Exclusive block (ends line 196 `</div>`), insert:

```tsx
          <div className="flex items-start gap-2">
            <Switch
              checked={!!form.is_collaboration}
              onCheckedChange={(c) => set('is_collaboration', c)}
            />
            <div className="flex-1">
              <Label>Collaboration event</Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Lets guest admins from a partner community manage this event's registrations only.
                Access auto-expires 2 days after the event date.
              </p>
            </div>
          </div>
          {form.is_collaboration && mode === 'edit' && (
            <div className="rounded-md border p-3 space-y-2">
              <Label className="block">Guest admin emails</Label>
              <div className="flex flex-wrap gap-1">
                {guestAdmins.map((email) => (
                  <span key={email} className="inline-flex items-center gap-1 text-xs bg-muted rounded px-2 py-1">
                    {email}
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => setGuestAdmins((list) => list.filter((e) => e !== email))}
                      aria-label={`Remove ${email}`}
                    >
                      ×
                    </button>
                  </span>
                ))}
                {guestAdmins.length === 0 && <span className="text-xs text-muted-foreground">No guests yet.</span>}
              </div>
              <div className="flex gap-2">
                <Input
                  value={guestInput}
                  placeholder="partner@community.in"
                  onChange={(e) => setGuestInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      const email = guestInput.trim().toLowerCase();
                      if (email.includes('@') && !guestAdmins.includes(email)) {
                        setGuestAdmins((list) => [...list, email]);
                      }
                      setGuestInput('');
                    }
                  }}
                />
              </div>
              <p className="text-xs text-muted-foreground">Press Enter to add. They log in at this admin URL with the email you list.</p>
            </div>
          )}
```

- [ ] **Step 6: Type-check and run admin tests**

Run: `cd admin && npx tsc --noEmit && npx vitest run`
Expected: PASS.

Manual (dev acts as admin via escape hatch): open an event drawer, toggle "Collaboration event", add an email chip, save, reopen — confirm the chip persists (requires the worker dev server + migration applied locally or against the project).

- [ ] **Step 7: Commit**

```bash
git add admin/src/lib/types.ts admin/src/pages/EventDrawer.tsx
git commit -m "feat: collaboration toggle + guest email editor in event drawer"
```

---

## Phase 7 — Integration verification & operational setup

### Task 16: Full type-check + test sweep

- [ ] **Step 1: Worker**

Run: `cd worker && npx tsc --noEmit && npx vitest run`
Expected: PASS — all suites including the new guest tests.

- [ ] **Step 2: Admin**

Run: `cd admin && npx tsc --noEmit && npx vitest run && npm run build`
Expected: PASS — type-check, tests, and production build all succeed.

- [ ] **Step 3: Astro build sanity (no changes expected, but verify nothing broke)**

Run: `npm run build`
Expected: Astro site builds clean.

### Task 17: Operational setup (manual, document in the PR)

These steps are performed by the maintainer (Siddhant), not the implementing agent. Record them in the PR description as a release checklist:

- [ ] In the Cloudflare dashboard → Zero Trust → Access → **Groups**, create a group named **"BGC Guest Admins"** with an empty/placeholder include. Note its **Group ID**.
- [ ] Edit the admin app's Access policy to **include** this group (add an OR rule "is in group: BGC Guest Admins") so guest emails synced into the group can reach `admin.boardgamecompany.in`.
- [ ] Create a Cloudflare **API token** scoped to **Access: Organizations, Identity Providers, and Groups → Edit** for the account. Note the token and **Account ID**.
- [ ] Set the worker secrets:
  ```bash
  cd worker
  npx wrangler secret put CF_API_TOKEN
  npx wrangler secret put CF_ACCOUNT_ID
  npx wrangler secret put CF_ACCESS_GROUP_ID
  ```
- [ ] Confirm migration `014_event_guest_admins.sql` is applied to the production Supabase project.
- [ ] Deploy the worker: `cd worker && npx wrangler deploy`.
- [ ] Push to `main` to deploy the site + admin (Cloudflare Pages).
- [ ] Smoke test: mark a test event as a collaboration, add a non-admin email, log in as that email in an incognito window, confirm the guest sees only that event's registrations and can edit/cancel/manual-add; confirm every admin nav target is unreachable.

---

## Self-Review

**Spec coverage:**
- Mark event as collaboration → Task 1 (`is_collaboration` column), Task 9 (worker), Task 15 (UI toggle). ✓
- Attach guest emails → Task 1 (`event_guest_admins`), Task 9 (upsert/delete), Task 15 (chip editor). ✓
- Guest login like admin → Tasks 2-4 (auth split + role), Task 17 (CF Access group). ✓
- Guest sees only their event's registrations → Task 6 (`handleGuestRequest` scoping), Task 13 (locked UI). ✓
- Full powers (view/edit/manual/cancel) → Task 6 routes all four, scoped. ✓
- Auto-expire 2 days after event → Task 3 (`GUEST_EXPIRY_BUFFER_DAYS`, date cutoff), enforced every request. ✓
- CF Access auto-sync → Task 8 (helpers), Task 9 (on save), Task 10 (daily cron). ✓
- Scoped phone lookup → Task 5, wired in Task 6. ✓

**Placeholder scan:** No TBD/TODO. Two explicit "verify the import shape" notes (Loading export, ExecutionContext type) are guarded by an immediate type-check step, not deferred work.

**Type consistency:** `AdminContext` union defined in Task 3 and consumed in Tasks 4/6/7/9. `GUEST_EXPIRY_BUFFER_DAYS` defined in Task 3, reused in Task 8. `WhoAmI`/`GuestEvent` defined in Task 11, consumed in Tasks 12-14. `handleUpdateEvent` new 5-arg signature defined in Task 9 and called with 5 args in the same task's Step 4. `guest_admins` request field handled in Task 9 and sent in Task 15. Consistent throughout.
