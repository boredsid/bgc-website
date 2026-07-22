# Leads Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture partial event-registration attempts (phone + name + event-of-interest) as leads in a new table, auto-convert on successful registration, and expose them in a `/leads` page in the admin tool with one-tap WhatsApp.

**Architecture:** Three layers. (1) Postgres `leads` table with `(phone, event_id)` upsert key. (2) Cloudflare Worker public endpoint `POST /api/lead` for fire-and-forget capture from the form, plus a side-effect in `register.ts` that marks matching leads converted, plus three admin endpoints under `/api/admin/leads`. (3) A `useLeadCapture` React hook wired into `RegistrationForm.tsx`, and a new `Leads.tsx` page in the admin SPA with WhatsApp deep-links and CSV export.

**Tech Stack:** Postgres (Supabase) + RLS, Cloudflare Workers (TypeScript) + Vitest, React 19 + Astro, Vite + React + shadcn (admin), `@supabase/supabase-js`.

**Spec reference:** `docs/superpowers/specs/2026-05-15-leads-capture-design.md`

---

## File Structure

**Will create:**
- `supabase/migrations/010_leads.sql` — new `leads` table
- `worker/src/lead.ts` — public `POST /api/lead` handler
- `worker/src/lead.test.ts` — Vitest tests for the handler
- `worker/src/admin/leads.ts` — admin list / patch / export handlers
- `worker/src/admin/leads.test.ts` — Vitest tests for admin handlers
- `admin/src/pages/Leads.tsx` — admin leads list page

**Will modify:**
- `worker/src/index.ts` — wire `/api/lead` and `/api/admin/leads*` routes
- `worker/src/register.ts` — add post-insert side-effect that marks matching leads as converted
- `worker/src/register.test.ts` (or new file if absent) — assert conversion side-effect
- `src/components/RegistrationForm.tsx` — wire `useLeadCapture` hook + new file `src/lib/use-lead-capture.ts`
- `src/lib/source.ts` — no change; reuse `getSource()` as-is
- `admin/src/App.tsx` — add `/leads` route
- `admin/src/components/Sidebar.tsx` — add Leads nav item
- `admin/src/components/BottomTabBar.tsx` — add Leads to "More" sheet
- `AGENTS.md` — document the new table + endpoints

---

## Task 1: Create the `leads` table migration

**Files:**
- Create: `supabase/migrations/010_leads.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 010_leads.sql
-- Captures partial registration attempts. Created when a visitor types a valid
-- phone in the registration form; updated as they progress; marked converted
-- when a matching registration succeeds. Admin can soft-delete via junk_at.

create table leads (
  id uuid primary key default uuid_generate_v4(),
  phone text not null,
  name text,
  event_id uuid not null references events(id) on delete cascade,
  last_step text not null check (last_step in (
    'phone_entered',
    'name_entered',
    'details_entered'
  )),
  source jsonb,
  user_agent text,
  converted_at timestamptz,
  registration_id uuid references registrations(id) on delete set null,
  junk_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (phone, event_id)
);

create index leads_created_at_idx on leads (created_at desc);
create index leads_open_idx on leads (created_at desc)
  where converted_at is null and junk_at is null;

alter table leads enable row level security;
-- No public policies — Worker (service role) only.
```

- [ ] **Step 2: Apply via Supabase MCP**

Apply through `mcp__claude_ai_Supabase__apply_migration` with name `010_leads` and the SQL above. Confirm via `mcp__claude_ai_Supabase__list_tables` that `leads` exists with the expected columns.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/010_leads.sql
git commit -m "feat: add leads table for partial registration capture"
```

---

## Task 2: Worker — `POST /api/lead` handler (failing test first)

**Files:**
- Create: `worker/src/lead.test.ts`
- Create: `worker/src/lead.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// worker/src/lead.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

function mockEnv() {
  return {
    SUPABASE_URL: 'x', SUPABASE_SERVICE_KEY: 'x',
    UPI_ID: 'x', APPS_SCRIPT_URL: '', APPS_SCRIPT_SECRET: '', BGC_SITE_URL: '',
    CF_ACCESS_TEAM_DOMAIN: 'x', CF_ACCESS_AUD: 'x', ADMIN_EMAILS: '', ENVIRONMENT: 'production',
  } as any;
}

vi.mock('./supabase', () => ({ getSupabase: vi.fn() }));

import { getSupabase } from './supabase';
import { handleLead, _resetLeadRateLimit } from './lead';

interface LeadRow {
  id: string;
  phone: string;
  name: string | null;
  event_id: string;
  last_step: string;
  converted_at: string | null;
  junk_at: string | null;
}

function buildSupabaseMock(initialRow: LeadRow | null, capture: { upsertArg: any; upsertOnConflict: string | null }) {
  let row = initialRow;
  return {
    from: (table: string) => {
      if (table !== 'leads') throw new Error('unexpected table ' + table);
      return {
        select: () => ({
          eq: (_c1: string, _v1: string) => ({
            eq: (_c2: string, _v2: string) => ({
              maybeSingle: async () => ({ data: row, error: null }),
            }),
          }),
        }),
        upsert: (arg: any, opts: any) => {
          capture.upsertArg = arg;
          capture.upsertOnConflict = opts?.onConflict ?? null;
          row = { ...(row || ({} as LeadRow)), ...arg, id: row?.id ?? 'new-id' };
          return { error: null };
        },
      };
    },
  };
}

beforeEach(() => {
  _resetLeadRateLimit();
});

describe('handleLead', () => {
  it('rejects invalid phone with 400', async () => {
    (getSupabase as any).mockReturnValue(buildSupabaseMock(null, { upsertArg: null, upsertOnConflict: null }));
    const req = new Request('http://localhost/api/lead', {
      method: 'POST',
      body: JSON.stringify({ phone: '123', event_id: 'e1', last_step: 'phone_entered' }),
    });
    const res = await handleLead(req, mockEnv());
    expect(res.status).toBe(400);
  });

  it('rejects missing event_id with 400', async () => {
    (getSupabase as any).mockReturnValue(buildSupabaseMock(null, { upsertArg: null, upsertOnConflict: null }));
    const req = new Request('http://localhost/api/lead', {
      method: 'POST',
      body: JSON.stringify({ phone: '9876543210', last_step: 'phone_entered' }),
    });
    const res = await handleLead(req, mockEnv());
    expect(res.status).toBe(400);
  });

  it('rejects bad last_step with 400', async () => {
    (getSupabase as any).mockReturnValue(buildSupabaseMock(null, { upsertArg: null, upsertOnConflict: null }));
    const req = new Request('http://localhost/api/lead', {
      method: 'POST',
      body: JSON.stringify({ phone: '9876543210', event_id: 'e1', last_step: 'bogus' }),
    });
    const res = await handleLead(req, mockEnv());
    expect(res.status).toBe(400);
  });

  it('upserts a new lead with onConflict on (phone,event_id)', async () => {
    const capture = { upsertArg: null as any, upsertOnConflict: null as any };
    (getSupabase as any).mockReturnValue(buildSupabaseMock(null, capture));
    const req = new Request('http://localhost/api/lead', {
      method: 'POST',
      body: JSON.stringify({
        phone: '9876543210',
        name: 'Asha',
        event_id: '11111111-1111-1111-1111-111111111111',
        last_step: 'name_entered',
        source: { utm_source: 'ig' },
        user_agent: 'jest',
      }),
    });
    const res = await handleLead(req, mockEnv());
    expect(res.status).toBe(200);
    expect(capture.upsertOnConflict).toBe('phone,event_id');
    expect(capture.upsertArg.phone).toBe('9876543210');
    expect(capture.upsertArg.name).toBe('Asha');
    expect(capture.upsertArg.event_id).toBe('11111111-1111-1111-1111-111111111111');
    expect(capture.upsertArg.last_step).toBe('name_entered');
    expect(capture.upsertArg.source).toEqual({ utm_source: 'ig' });
  });

  it('skips writes when existing row is converted', async () => {
    const capture = { upsertArg: null as any, upsertOnConflict: null as any };
    (getSupabase as any).mockReturnValue(buildSupabaseMock(
      {
        id: 'L1', phone: '9876543210', name: 'Asha',
        event_id: '11111111-1111-1111-1111-111111111111',
        last_step: 'details_entered',
        converted_at: '2026-05-15T00:00:00Z',
        junk_at: null,
      },
      capture,
    ));
    const req = new Request('http://localhost/api/lead', {
      method: 'POST',
      body: JSON.stringify({
        phone: '9876543210',
        event_id: '11111111-1111-1111-1111-111111111111',
        last_step: 'phone_entered',
      }),
    });
    const res = await handleLead(req, mockEnv());
    expect(res.status).toBe(200);
    expect(capture.upsertArg).toBeNull();
  });

  it('rate-limit: drops second call within 2s without writing', async () => {
    const capture = { upsertArg: null as any, upsertOnConflict: null as any };
    (getSupabase as any).mockReturnValue(buildSupabaseMock(null, capture));
    const body = JSON.stringify({
      phone: '9876543210',
      event_id: '11111111-1111-1111-1111-111111111111',
      last_step: 'phone_entered',
    });
    await handleLead(new Request('http://localhost/api/lead', { method: 'POST', body }), mockEnv());
    expect(capture.upsertArg).not.toBeNull();
    capture.upsertArg = null;
    const res2 = await handleLead(new Request('http://localhost/api/lead', { method: 'POST', body }), mockEnv());
    expect(res2.status).toBe(200);
    expect(capture.upsertArg).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd worker && npm test -- lead
```

Expected: FAIL with "Cannot find module './lead'" or similar.

- [ ] **Step 3: Implement `lead.ts`**

```typescript
// worker/src/lead.ts
import type { Env } from './index';
import { getSupabase } from './supabase';
import { sanitizePhone, jsonResponse } from './validation';

const VALID_STEPS = new Set(['phone_entered', 'name_entered', 'details_entered']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Best-effort, per-isolate dedup of debounce-storms. Map(`${phone}|${event_id}` -> last ms).
const RATE_LIMIT_MS = 2000;
const lastSeen = new Map<string, number>();

export function _resetLeadRateLimit(): void {
  lastSeen.clear();
}

interface LeadBody {
  phone?: string;
  name?: string | null;
  event_id?: string;
  last_step?: string;
  source?: unknown;
  user_agent?: string | null;
}

export async function handleLead(request: Request, env: Env): Promise<Response> {
  let body: LeadBody;
  try {
    body = (await request.json()) as LeadBody;
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400);
  }

  const phone = sanitizePhone(body.phone || '');
  if (!phone) return jsonResponse({ error: 'Invalid phone number' }, 400);

  const eventId = (body.event_id || '').trim();
  if (!UUID_RE.test(eventId)) return jsonResponse({ error: 'Invalid event id' }, 400);

  const lastStep = body.last_step || '';
  if (!VALID_STEPS.has(lastStep)) return jsonResponse({ error: 'Invalid last_step' }, 400);

  // Rate-limit drop
  const key = `${phone}|${eventId}`;
  const now = Date.now();
  const prev = lastSeen.get(key);
  if (prev && now - prev < RATE_LIMIT_MS) {
    return jsonResponse({ ok: true });
  }
  lastSeen.set(key, now);

  const supabase = getSupabase(env);

  // Skip if already converted.
  const { data: existing } = await supabase
    .from('leads')
    .select('converted_at')
    .eq('phone', phone)
    .eq('event_id', eventId)
    .maybeSingle();

  if (existing && existing.converted_at) {
    return jsonResponse({ ok: true });
  }

  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 200) : null;
  const source = body.source && typeof body.source === 'object' ? body.source : null;
  const userAgent = typeof body.user_agent === 'string' ? body.user_agent.slice(0, 500) : null;

  // Upsert. PostgREST treats undefined-ish empty strings as values; we send only set fields.
  const row: Record<string, unknown> = {
    phone,
    event_id: eventId,
    last_step: lastStep,
    updated_at: new Date().toISOString(),
  };
  if (name) row.name = name;
  if (source) row.source = source;
  if (userAgent) row.user_agent = userAgent;

  const { error } = await supabase
    .from('leads')
    .upsert(row, { onConflict: 'phone,event_id', ignoreDuplicates: false });

  if (error) {
    return jsonResponse({ ok: true });
  }
  return jsonResponse({ ok: true });
}
```

Note on the upsert: PostgREST `upsert(..., { onConflict, ignoreDuplicates: false })` will overwrite columns we send. We deliberately omit `name` from `row` when it's empty so existing names are preserved. That's the "never null out an existing name" behaviour.

- [ ] **Step 4: Run tests and verify pass**

```bash
cd worker && npm test -- lead
```

Expected: all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add worker/src/lead.ts worker/src/lead.test.ts
git commit -m "feat: worker handler for partial-registration leads"
```

---

## Task 3: Wire `/api/lead` route in `worker/src/index.ts`

**Files:**
- Modify: `worker/src/index.ts`

- [ ] **Step 1: Add the import**

Find the existing import block at the top of `worker/src/index.ts`. Add this line near the other public-handler imports (e.g. right after the `handleGuildPurchase` import):

```typescript
import { handleLead } from './lead';
```

- [ ] **Step 2: Add the route**

Find the public route block — the `if/else if` chain that includes `/api/lookup-phone`, `/api/register`, etc. Add a new branch right after `/api/guild-purchase`:

```typescript
} else if (url.pathname === '/api/lead' && request.method === 'POST') {
  response = await handleLead(request, env);
```

The branch must come **before** the `} else if (url.pathname.startsWith('/api/admin/'))` branch.

- [ ] **Step 3: Verify TS compiles**

```bash
cd worker && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add worker/src/index.ts
git commit -m "feat: route POST /api/lead in worker"
```

---

## Task 4: Worker — auto-convert leads on successful registration (failing test first)

**Files:**
- Modify: `worker/src/register.ts`
- Create: `worker/src/register.test.ts` (or extend if it already exists — check first with `ls worker/src/register.test.ts`)

- [ ] **Step 1: Write the failing test**

If `worker/src/register.test.ts` does not exist, create it. If it does, add the new test inside the existing `describe`.

```typescript
// worker/src/register.test.ts (full file if creating)
import { describe, expect, it, vi } from 'vitest';

function mockEnv() {
  return {
    SUPABASE_URL: 'x', SUPABASE_SERVICE_KEY: 'x',
    UPI_ID: 'x', APPS_SCRIPT_URL: '', APPS_SCRIPT_SECRET: '', BGC_SITE_URL: '',
    CF_ACCESS_TEAM_DOMAIN: 'x', CF_ACCESS_AUD: 'x', ADMIN_EMAILS: '', ENVIRONMENT: 'production',
  } as any;
}

vi.mock('./supabase', () => ({ getSupabase: vi.fn() }));
vi.mock('./email', () => ({ sendEventRegistrationEmail: vi.fn(async () => undefined) }));
vi.mock('./credits', () => ({
  applyCreditsToTotal: vi.fn(async (_s: any, _u: string, total: number) => ({ creditsApplied: 0, finalAmount: total })),
  recordCreditEvent: vi.fn(async () => undefined),
}));

import { getSupabase } from './supabase';
import { handleRegister } from './register';

function buildSupabaseMock(capture: { leadUpdate: any }) {
  return {
    from: (table: string) => {
      if (table === 'events') {
        return {
          select: () => ({ eq: () => ({ eq: () => ({ single: async () => ({ data: {
            id: 'E1', name: 'Test', date: '2026-06-01', venue_name: 'V', venue_area: null,
            price: 500, capacity: 10, custom_questions: [], price_includes: null, is_published: true,
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
          select: () => ({ eq: () => ({ eq: () => ({ gte: () => ({ order: () => ({ limit: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) }) }) }),
        };
      }
      if (table === 'leads') {
        return {
          update: (arg: any) => {
            capture.leadUpdate = { ...capture.leadUpdate, set: arg };
            return {
              eq: (c1: string, v1: string) => {
                capture.leadUpdate = { ...capture.leadUpdate, [c1]: v1 };
                return {
                  eq: (c2: string, v2: string) => {
                    capture.leadUpdate = { ...capture.leadUpdate, [c2]: v2 };
                    return {
                      is: (c3: string, v3: any) => {
                        capture.leadUpdate = { ...capture.leadUpdate, [`${c3}_is`]: v3 };
                        return {
                          is: async (c4: string, v4: any) => {
                            capture.leadUpdate = { ...capture.leadUpdate, [`${c4}_is`]: v4 };
                            return { error: null };
                          },
                        };
                      },
                    };
                  },
                };
              },
            };
          },
        };
      }
      return null;
    },
  };
}

describe('handleRegister lead conversion', () => {
  it('marks matching open lead as converted after successful registration', async () => {
    const capture = { leadUpdate: null as any };
    (getSupabase as any).mockReturnValue(buildSupabaseMock(capture));

    const req = new Request('http://localhost/api/register', {
      method: 'POST',
      body: JSON.stringify({
        event_id: 'E1',
        name: 'Asha',
        phone: '9876543210',
        email: 'a@b.com',
        seats: 1,
        custom_answers: {},
        payment_status: 'pending',
      }),
    });
    const ctx = { waitUntil: (p: Promise<unknown>) => p } as any;

    const res = await handleRegister(req, mockEnv(), ctx);
    expect(res.status).toBe(200);

    expect(capture.leadUpdate).not.toBeNull();
    expect(capture.leadUpdate.set.converted_at).toBeTruthy();
    expect(capture.leadUpdate.set.registration_id).toBe('R1');
    expect(capture.leadUpdate.phone).toBe('9876543210');
    expect(capture.leadUpdate.event_id).toBe('E1');
    expect(capture.leadUpdate.converted_at_is).toBeNull();
    expect(capture.leadUpdate.junk_at_is).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd worker && npm test -- register
```

Expected: FAIL — `capture.leadUpdate` is `null` because `register.ts` doesn't touch `leads` yet.

- [ ] **Step 3: Add the lead-conversion side-effect to `register.ts`**

In `worker/src/register.ts`, find the block that starts immediately after the `if (regError) { return jsonResponse({ error: 'Registration failed' }, 500); }` line. Insert this block right before the `if (creditsApplied > 0) {` line:

```typescript
  // Convert any open lead matching this phone+event. Best-effort — failures here
  // must not fail the registration.
  try {
    await supabase
      .from('leads')
      .update({
        converted_at: new Date().toISOString(),
        registration_id: registration.id,
        updated_at: new Date().toISOString(),
      })
      .eq('phone', phone)
      .eq('event_id', body.event_id)
      .is('converted_at', null)
      .is('junk_at', null);
  } catch {
    // swallow
  }
```

- [ ] **Step 4: Run tests and verify pass**

```bash
cd worker && npm test
```

Expected: all tests pass (the new register test plus all prior tests).

- [ ] **Step 5: Commit**

```bash
git add worker/src/register.ts worker/src/register.test.ts
git commit -m "feat: convert matching lead on successful registration"
```

---

## Task 5: Worker — admin endpoints (list / patch / export)

**Files:**
- Create: `worker/src/admin/leads.ts`
- Create: `worker/src/admin/leads.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// worker/src/admin/leads.test.ts
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
import { handleListLeads, handleUpdateLead, handleExportLeads } from './leads';

interface QueryCapture {
  filters: Array<{ op: string; col: string; val: any }>;
}

function buildListMock(rows: any[], capture: QueryCapture) {
  const builder: any = {
    select: () => builder,
    is: (col: string, val: any) => { capture.filters.push({ op: 'is', col, val }); return builder; },
    eq: (col: string, val: any) => { capture.filters.push({ op: 'eq', col, val }); return builder; },
    not: (col: string, op: string, val: any) => { capture.filters.push({ op: `not.${op}`, col, val }); return builder; },
    gte: (col: string, val: any) => { capture.filters.push({ op: 'gte', col, val }); return builder; },
    order: () => builder,
    limit: async () => ({ data: rows, error: null }),
  };
  return { from: (t: string) => { if (t !== 'leads') throw new Error('bad table ' + t); return builder; } };
}

describe('handleListLeads', () => {
  it('default filters: open + non-junk + last 30 days', async () => {
    const capture: QueryCapture = { filters: [] };
    (getSupabase as any).mockReturnValue(buildListMock([], capture));
    const req = new Request('http://localhost/api/admin/leads');
    const res = await handleListLeads(req, mockEnv());
    expect(res.status).toBe(200);
    expect(capture.filters).toContainEqual({ op: 'is', col: 'converted_at', val: null });
    expect(capture.filters).toContainEqual({ op: 'is', col: 'junk_at', val: null });
    expect(capture.filters.some((f) => f.op === 'gte' && f.col === 'created_at')).toBe(true);
  });

  it('include_converted=1 drops the converted_at filter', async () => {
    const capture: QueryCapture = { filters: [] };
    (getSupabase as any).mockReturnValue(buildListMock([], capture));
    const req = new Request('http://localhost/api/admin/leads?include_converted=1');
    await handleListLeads(req, mockEnv());
    expect(capture.filters.find((f) => f.col === 'converted_at')).toBeUndefined();
  });

  it('event_id filter is applied', async () => {
    const capture: QueryCapture = { filters: [] };
    (getSupabase as any).mockReturnValue(buildListMock([], capture));
    const req = new Request('http://localhost/api/admin/leads?event_id=E1');
    await handleListLeads(req, mockEnv());
    expect(capture.filters).toContainEqual({ op: 'eq', col: 'event_id', val: 'E1' });
  });

  it('has_name=yes uses not.is.null', async () => {
    const capture: QueryCapture = { filters: [] };
    (getSupabase as any).mockReturnValue(buildListMock([], capture));
    const req = new Request('http://localhost/api/admin/leads?has_name=yes');
    await handleListLeads(req, mockEnv());
    expect(capture.filters).toContainEqual({ op: 'not.is', col: 'name', val: null });
  });
});

describe('handleUpdateLead', () => {
  it('PATCH { junk: true } sets junk_at', async () => {
    const captured: { update: any; eq: { col: string; val: any } | null } = { update: null, eq: null };
    (getSupabase as any).mockReturnValue({
      from: () => ({
        update: (arg: any) => { captured.update = arg; return {
          eq: async (col: string, val: any) => { captured.eq = { col, val }; return { error: null }; },
        }; },
      }),
    });
    const req = new Request('http://localhost/api/admin/leads/L1', {
      method: 'PATCH',
      body: JSON.stringify({ junk: true }),
    });
    const res = await handleUpdateLead('L1', req, mockEnv());
    expect(res.status).toBe(200);
    expect(captured.update.junk_at).toBeTruthy();
    expect(captured.eq).toEqual({ col: 'id', val: 'L1' });
  });

  it('PATCH with no recognised fields returns 400', async () => {
    (getSupabase as any).mockReturnValue({ from: () => ({}) });
    const req = new Request('http://localhost/api/admin/leads/L1', {
      method: 'PATCH',
      body: JSON.stringify({ foo: 'bar' }),
    });
    const res = await handleUpdateLead('L1', req, mockEnv());
    expect(res.status).toBe(400);
  });
});

describe('handleExportLeads', () => {
  it('returns CSV with header + one data row', async () => {
    const capture: QueryCapture = { filters: [] };
    (getSupabase as any).mockReturnValue(buildListMock([
      {
        id: 'L1', phone: '9876543210', name: 'Asha', event_id: 'E1',
        last_step: 'name_entered', source: { utm_source: 'ig' },
        converted_at: null, junk_at: null, created_at: '2026-05-15T00:00:00Z',
        events: { name: 'Game Night' },
      },
    ], capture));
    const req = new Request('http://localhost/api/admin/leads/export');
    const res = await handleExportLeads(req, mockEnv());
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/csv');
    const body = await res.text();
    const lines = body.trim().split('\n');
    expect(lines[0]).toContain('phone');
    expect(lines.length).toBe(2);
    expect(lines[1]).toContain('9876543210');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd worker && npm test -- admin/leads
```

Expected: FAIL — `Cannot find module './leads'`.

- [ ] **Step 3: Implement `worker/src/admin/leads.ts`**

```typescript
// worker/src/admin/leads.ts
import type { Env } from '../index';
import { getSupabase } from '../supabase';
import { jsonResponse } from '../validation';

const DEFAULT_WINDOW_DAYS = 30;
const LIST_LIMIT = 500;

function applyListFilters(query: any, url: URL) {
  const includeConverted = url.searchParams.get('include_converted') === '1';
  const includeJunk = url.searchParams.get('include_junk') === '1';
  const eventId = url.searchParams.get('event_id');
  const hasName = url.searchParams.get('has_name'); // 'yes' | 'no' | null
  const sinceParam = url.searchParams.get('since');

  if (!includeConverted) query = query.is('converted_at', null);
  if (!includeJunk) query = query.is('junk_at', null);
  if (eventId) query = query.eq('event_id', eventId);
  if (hasName === 'yes') query = query.not('name', 'is', null);
  if (hasName === 'no') query = query.is('name', null);

  const since = sinceParam
    ? new Date(sinceParam)
    : new Date(Date.now() - DEFAULT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  if (!isNaN(since.getTime())) query = query.gte('created_at', since.toISOString());

  return query;
}

export async function handleListLeads(request: Request, env: Env): Promise<Response> {
  const supabase = getSupabase(env);
  const url = new URL(request.url);

  let query = supabase
    .from('leads')
    .select('id, phone, name, event_id, last_step, source, user_agent, converted_at, registration_id, junk_at, created_at, updated_at, events(name, date)');

  query = applyListFilters(query, url);

  const { data, error } = await query.order('created_at', { ascending: false }).limit(LIST_LIMIT);
  if (error) return jsonResponse({ error: 'Failed to load leads' }, 500);
  return jsonResponse({ leads: data || [] });
}

export async function handleUpdateLead(id: string, request: Request, env: Env): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { junk?: boolean } | null;
  if (!body) return jsonResponse({ error: 'Invalid request body' }, 400);

  const update: Record<string, unknown> = {};
  if (body.junk === true) update.junk_at = new Date().toISOString();

  if (Object.keys(update).length === 0) {
    return jsonResponse({ error: 'No recognised fields to update' }, 400);
  }
  update.updated_at = new Date().toISOString();

  const supabase = getSupabase(env);
  const { error } = await supabase.from('leads').update(update).eq('id', id);
  if (error) return jsonResponse({ error: 'Failed to update lead' }, 500);
  return jsonResponse({ ok: true });
}

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export async function handleExportLeads(request: Request, env: Env): Promise<Response> {
  const supabase = getSupabase(env);
  const url = new URL(request.url);

  let query = supabase
    .from('leads')
    .select('id, phone, name, event_id, last_step, source, converted_at, junk_at, created_at, events(name)');

  query = applyListFilters(query, url);
  const { data, error } = await query.order('created_at', { ascending: false }).limit(LIST_LIMIT);
  if (error) return new Response('Failed', { status: 500 });

  const header = ['created_at', 'phone', 'name', 'event', 'last_step', 'source', 'converted_at', 'junk_at'];
  const rows = (data || []).map((r: any) => [
    r.created_at, r.phone, r.name, r.events?.name ?? '',
    r.last_step, r.source, r.converted_at, r.junk_at,
  ].map(csvEscape).join(','));

  const csv = [header.join(','), ...rows].join('\n');
  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="leads.csv"',
      'Cache-Control': 'no-store',
    },
  });
}
```

- [ ] **Step 4: Run tests and verify pass**

```bash
cd worker && npm test -- admin/leads
```

Expected: all 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add worker/src/admin/leads.ts worker/src/admin/leads.test.ts
git commit -m "feat: admin endpoints for leads (list, patch, export)"
```

---

## Task 6: Wire admin lead routes in `worker/src/index.ts`

**Files:**
- Modify: `worker/src/index.ts`

- [ ] **Step 1: Add the import**

Add near the other `./admin/*` imports at the top of `worker/src/index.ts`:

```typescript
import { handleListLeads, handleUpdateLead, handleExportLeads } from './admin/leads';
```

- [ ] **Step 2: Add the routes**

Inside the `if (url.pathname.startsWith('/api/admin/'))` block, add these branches before the final fallthrough. Place them adjacent to the `guild-members` block to mirror existing structure:

```typescript
if (!adminResponse && url.pathname === '/api/admin/leads/export' && request.method === 'GET') {
  adminResponse = await handleExportLeads(request, env);
}

if (!adminResponse) {
  const leadsMatch = url.pathname.match(/^\/api\/admin\/leads(?:\/([^/]+))?$/);
  if (leadsMatch) {
    const leadId = leadsMatch[1];
    if (!leadId && request.method === 'GET') adminResponse = await handleListLeads(request, env);
    else if (leadId && leadId !== 'export' && request.method === 'PATCH') adminResponse = await handleUpdateLead(leadId, request, env);
    else adminResponse = new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }
}
```

- [ ] **Step 3: TS check**

```bash
cd worker && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add worker/src/index.ts
git commit -m "feat: route admin leads endpoints in worker"
```

---

## Task 7: Frontend — `useLeadCapture` hook

**Files:**
- Create: `src/lib/use-lead-capture.ts`

- [ ] **Step 1: Implement the hook**

```typescript
// src/lib/use-lead-capture.ts
import { useEffect, useRef } from 'react';

const WORKER_URL = import.meta.env.PUBLIC_WORKER_URL as string | undefined;
const DEBOUNCE_MS = 1500;

export type LeadStep = 'phone_entered' | 'name_entered' | 'details_entered';

interface Args {
  phone: string;
  name: string;
  eventId: string | null;
  detailsTouched: boolean;
}

function sanitizePhone(raw: string): string | null {
  const cleaned = raw.replace(/[\s\-\(\)]/g, '');
  const m = cleaned.match(/^(?:\+?91)?(\d{10})$/);
  return m ? m[1] : null;
}

function deriveStep(name: string, detailsTouched: boolean): LeadStep {
  if (detailsTouched) return 'details_entered';
  if (name.trim().length > 0) return 'name_entered';
  return 'phone_entered';
}

function readSource(): unknown {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem('bgc_source');
    return raw ? { utm_source: raw } : null;
  } catch {
    return null;
  }
}

function send(payload: Record<string, unknown>): void {
  if (!WORKER_URL) return;
  try {
    fetch(`${WORKER_URL}/api/lead`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // swallow — fire-and-forget
  }
}

export function useLeadCapture({ phone, name, eventId, detailsTouched }: Args): void {
  const lastPayloadRef = useRef<string>('');
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestRef = useRef<Record<string, unknown> | null>(null);

  useEffect(() => {
    if (!eventId) return;
    const cleanedPhone = sanitizePhone(phone);
    if (!cleanedPhone) return;

    const payload: Record<string, unknown> = {
      phone: cleanedPhone,
      event_id: eventId,
      last_step: deriveStep(name, detailsTouched),
      source: readSource(),
      user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
    };
    const trimmedName = name.trim();
    if (trimmedName) payload.name = trimmedName;

    latestRef.current = payload;
    const serialised = JSON.stringify(payload);
    if (serialised === lastPayloadRef.current) return;

    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      lastPayloadRef.current = serialised;
      send(payload);
    }, DEBOUNCE_MS);

    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, [phone, name, eventId, detailsTouched]);

  // Flush on tab close.
  useEffect(() => {
    function flush() {
      if (latestRef.current) send(latestRef.current);
    }
    window.addEventListener('beforeunload', flush);
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('beforeunload', flush);
      window.removeEventListener('pagehide', flush);
    };
  }, []);
}
```

- [ ] **Step 2: TS check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/use-lead-capture.ts
git commit -m "feat: useLeadCapture hook for partial-registration capture"
```

---

## Task 8: Wire `useLeadCapture` into `RegistrationForm.tsx`

**Files:**
- Modify: `src/components/RegistrationForm.tsx`

- [ ] **Step 1: Import the hook**

At the top of `src/components/RegistrationForm.tsx`, add to the existing import block:

```typescript
import { useLeadCapture } from '../lib/use-lead-capture';
```

- [ ] **Step 2: Track whether custom-question fields were touched**

Inside the `RegistrationForm` component, near the other `useState` calls (e.g. right after `customAnswers`), add:

```typescript
const [detailsTouched, setDetailsTouched] = useState(false);
```

Find the `setCustomAnswers` callsite(s). Where the form sets a custom answer (the handler that wraps `setCustomAnswers`), also call `setDetailsTouched(true)`. If the existing code uses an inline updater like `setCustomAnswers((prev) => ({ ...prev, [id]: value }))`, wrap it:

```typescript
const updateCustomAnswer = useCallback((id: string, value: string | boolean) => {
  setCustomAnswers((prev) => ({ ...prev, [id]: value }));
  setDetailsTouched(true);
}, []);
```

…and use `updateCustomAnswer` everywhere that previously called `setCustomAnswers` directly for individual answers. If `setCustomAnswers` is used for bulk reset (e.g. on success), leave those callsites alone.

- [ ] **Step 3: Call the hook**

After the existing `useEffect`/`useCallback` block in the component body but before the `return` statement, add:

```typescript
useLeadCapture({ phone, name, eventId, detailsTouched });
```

- [ ] **Step 4: Manual smoke test**

```bash
npm run dev
```

In a second terminal:

```bash
cd worker && npm run dev
```

In a browser, open `http://localhost:4321/register?event=<an-event-id>`. Fill the phone with a 10-digit number, wait 2s. In the worker terminal, you should see a `POST /api/lead` log line. Add a name, wait 2s, see another. Open the Supabase dashboard or run:

```sql
select id, phone, name, event_id, last_step, created_at, updated_at
from leads
order by created_at desc
limit 5;
```

Expected: one row per phone+event pair, `last_step` advancing from `phone_entered` → `name_entered`.

- [ ] **Step 5: Commit**

```bash
git add src/components/RegistrationForm.tsx
git commit -m "feat: capture leads from registration form"
```

---

## Task 9: Admin SPA — `Leads.tsx` page

**Files:**
- Create: `admin/src/pages/Leads.tsx`

- [ ] **Step 1: Build the page**

```tsx
// admin/src/pages/Leads.tsx
import { useEffect, useMemo, useState } from 'react';
import { fetchAdmin, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';

interface Lead {
  id: string;
  phone: string;
  name: string | null;
  event_id: string;
  last_step: 'phone_entered' | 'name_entered' | 'details_entered';
  source: Record<string, unknown> | null;
  converted_at: string | null;
  junk_at: string | null;
  created_at: string;
  events: { name: string; date: string } | null;
}

interface EventOption { id: string; name: string }

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  return `${d}d ago`;
}

function whatsappUrl(phone: string, eventName: string | null): string {
  const text = eventName
    ? `Hi! Saw you started signing up for ${eventName} at BGC — anything I can help with?`
    : `Hi! Saw you started signing up at BGC — anything I can help with?`;
  return `https://wa.me/91${phone}?text=${encodeURIComponent(text)}`;
}

export default function Leads() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<EventOption[]>([]);

  const [eventId, setEventId] = useState<string>('all');
  const [hasName, setHasName] = useState<'any' | 'yes' | 'no'>('any');
  const [includeConverted, setIncludeConverted] = useState(false);
  const [includeJunk, setIncludeJunk] = useState(false);
  const [sinceDays, setSinceDays] = useState<string>('30');

  const queryString = useMemo(() => {
    const p = new URLSearchParams();
    if (eventId !== 'all') p.set('event_id', eventId);
    if (hasName !== 'any') p.set('has_name', hasName);
    if (includeConverted) p.set('include_converted', '1');
    if (includeJunk) p.set('include_junk', '1');
    if (sinceDays) {
      const d = parseInt(sinceDays, 10);
      if (!Number.isNaN(d)) {
        const since = new Date(Date.now() - d * 86400_000).toISOString();
        p.set('since', since);
      }
    }
    return p.toString();
  }, [eventId, hasName, includeConverted, includeJunk, sinceDays]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchAdmin<{ leads: Lead[] }>(`/api/admin/leads?${queryString}`);
      setLeads(data.leads);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [queryString]);

  useEffect(() => {
    fetchAdmin<{ events: Array<{ id: string; name: string }> }>('/api/admin/events')
      .then((d) => setEvents(d.events))
      .catch(() => undefined);
  }, []);

  async function markJunk(id: string) {
    try {
      await fetchAdmin(`/api/admin/leads/${id}`, { method: 'PATCH', body: JSON.stringify({ junk: true }) });
      setLeads((cur) => cur.filter((l) => l.id !== id));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed');
    }
  }

  function copyPhone(p: string) {
    navigator.clipboard?.writeText(p).then(() => toast.success('Copied'));
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <h1 className="text-2xl font-heading font-semibold">Leads</h1>
        <a
          className="ml-auto text-sm underline"
          href={`${import.meta.env.VITE_API_BASE ?? ''}/api/admin/leads/export?${queryString}`}
        >Export CSV</a>
      </div>

      <div className="flex flex-wrap gap-3 items-end">
        <div className="flex flex-col gap-1">
          <Label>Event</Label>
          <Select value={eventId} onValueChange={setEventId}>
            <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All events</SelectItem>
              {events.map((e) => (
                <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label>Has name</Label>
          <Select value={hasName} onValueChange={(v) => setHasName(v as 'any' | 'yes' | 'no')}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Any</SelectItem>
              <SelectItem value="yes">Yes</SelectItem>
              <SelectItem value="no">No</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label>Last N days</Label>
          <Input className="w-24" inputMode="numeric" value={sinceDays} onChange={(e) => setSinceDays(e.target.value)} />
        </div>
        <div className="flex items-center gap-2">
          <Switch id="conv" checked={includeConverted} onCheckedChange={setIncludeConverted} />
          <Label htmlFor="conv">Show converted</Label>
        </div>
        <div className="flex items-center gap-2">
          <Switch id="junk" checked={includeJunk} onCheckedChange={setIncludeJunk} />
          <Label htmlFor="junk">Show junk</Label>
        </div>
      </div>

      {loading && <div className="text-sm text-muted-foreground">Loading…</div>}
      {error && <div className="text-sm text-destructive">{error}</div>}

      {!loading && leads.length === 0 && (
        <div className="text-sm text-muted-foreground">No leads match these filters.</div>
      )}

      {!loading && leads.length > 0 && (
        <div className="overflow-x-auto rounded border">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr className="text-left">
                <th className="p-2">Age</th>
                <th className="p-2">Phone</th>
                <th className="p-2">Name</th>
                <th className="p-2">Event</th>
                <th className="p-2">Step</th>
                <th className="p-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((l) => (
                <tr key={l.id} className="border-t">
                  <td className="p-2 whitespace-nowrap">{relativeTime(l.created_at)}</td>
                  <td className="p-2">
                    <button onClick={() => copyPhone(l.phone)} className="underline" title="Click to copy">
                      {l.phone}
                    </button>
                  </td>
                  <td className="p-2">{l.name ?? '—'}</td>
                  <td className="p-2">{l.events?.name ?? '—'}</td>
                  <td className="p-2"><Badge variant="secondary">{l.last_step.replace('_entered', '')}</Badge></td>
                  <td className="p-2 text-right whitespace-nowrap">
                    <a
                      href={whatsappUrl(l.phone, l.events?.name ?? null)}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-block px-2 py-1 mr-2 rounded bg-primary text-primary-foreground text-xs"
                    >WhatsApp</a>
                    <Button variant="ghost" size="sm" onClick={() => markJunk(l.id)}>Junk</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: TS check**

```bash
cd admin && npx tsc --noEmit
```

Expected: no errors. If shadcn `Switch` or `Select` aren't already in the project, the import will fail — check `admin/src/components/ui/`. If missing, install via the existing shadcn pattern (`npx shadcn@latest add switch select`).

- [ ] **Step 3: Commit**

```bash
git add admin/src/pages/Leads.tsx
git commit -m "feat: admin leads page with filters and WhatsApp link"
```

---

## Task 10: Wire the Leads route + nav in the admin SPA

**Files:**
- Modify: `admin/src/App.tsx`
- Modify: `admin/src/components/Sidebar.tsx`
- Modify: `admin/src/components/BottomTabBar.tsx`

- [ ] **Step 1: Add the route**

In `admin/src/App.tsx`, add:

```typescript
import Leads from './pages/Leads';
```

…and inside the `<Routes><Route element={<Layout />}>` block, add a new route adjacent to `/users`:

```tsx
<Route path="/leads" element={<Leads />} />
```

- [ ] **Step 2: Add to sidebar**

In `admin/src/components/Sidebar.tsx`, add to the imports:

```typescript
import { LayoutDashboard, Calendar, Library, Users, ShieldCheck, UserCircle, Inbox } from 'lucide-react';
```

…and to the `items` array, insert between Registrations and Users:

```typescript
{ to: '/leads', label: 'Leads', icon: Inbox, end: false, countKey: null },
```

- [ ] **Step 3: Add to mobile More sheet**

In `admin/src/components/BottomTabBar.tsx`, add `Inbox` to the lucide import line, and add a `NavLink` inside the More sheet, mirroring the existing Games/Users entries:

```tsx
<NavLink
  to="/leads"
  onClick={() => setMoreOpen(false)}
  className={({ isActive }) =>
    cn(
      'flex items-center gap-3 px-3 py-3 rounded-md text-sm min-h-11',
      isActive ? 'bg-primary text-primary-foreground' : 'hover:bg-muted',
    )
  }
>
  <Inbox className="h-5 w-5" />
  Leads
</NavLink>
```

- [ ] **Step 4: TS check + dev smoke**

```bash
cd admin && npx tsc --noEmit && npm run dev
```

Open `http://localhost:5173/leads`. Expected: page renders, filter controls show, table is empty (no leads yet) or shows the rows you created in Task 8.

- [ ] **Step 5: Commit**

```bash
git add admin/src/App.tsx admin/src/components/Sidebar.tsx admin/src/components/BottomTabBar.tsx
git commit -m "feat: route and nav entry for admin Leads page"
```

---

## Task 11: Update AGENTS.md

**Files:**
- Modify: `AGENTS.md`

- [ ] **Step 1: Add the table row**

In the `## Supabase tables` section, add a new row to the table after `user_credits`:

```markdown
| `leads` | no | Partial registration capture (phone+event); auto-converted on registration; admin-managed via `/api/admin/leads*` |
```

- [ ] **Step 2: Update worker endpoints list**

In the `## Worker endpoints` section, append `POST /api/lead` to the **Public** line. Append `leads` (list/patch + `export`) to the **Admin** list.

- [ ] **Step 3: Commit**

```bash
git add AGENTS.md
git commit -m "docs: note leads table and endpoints in AGENTS.md"
```

---

## Task 12: Full test pass + deploy gate

- [ ] **Step 1: Run all worker tests**

```bash
cd worker && npm test
```

Expected: green.

- [ ] **Step 2: Run all admin tests**

```bash
cd admin && npm test
```

Expected: green (no admin tests added in this plan; existing tests should still pass).

- [ ] **Step 3: Site type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Site build**

```bash
npm run build
```

Expected: build succeeds.

- [ ] **Step 5: Worker deploy (manual gate — only when ready)**

```bash
cd worker && npx wrangler deploy
```

Note: deploy the worker **before** merging the frontend changes to `main`, so the `/api/lead` endpoint exists before the form starts calling it. Once the worker is live, push the frontend commits to `main`; Cloudflare Pages will auto-deploy site + admin.

---

## Spec Coverage Check

| Spec section | Tasks |
|---|---|
| Data model + migration | Task 1 |
| Worker `POST /api/lead` (validate, rate-limit, upsert, skip-converted) | Task 2 |
| Wire public route | Task 3 |
| Auto-conversion in `register.ts` | Task 4 |
| Admin endpoints (list, patch junk, export) | Task 5 |
| Wire admin routes | Task 6 |
| Frontend hook + `keepalive` + `beforeunload` flush | Task 7 |
| Wire hook into RegistrationForm | Task 8 |
| Admin `/leads` page (filters, WhatsApp, junk) | Task 9 |
| Admin nav (sidebar + mobile More) | Task 10 |
| Docs | Task 11 |
| Test + deploy order | Task 12 |
