# Demon's Draft Contest Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a standalone gothic-styled rules page at `boardgamecompany.in/dd` for the "Demon's Draft" BotC script contest, with an in-page submission form that stores entries in Supabase and emails them to the organizers.

**Architecture:** Astro static page (`/dd`, not in nav) renders the rules + a React island form. The form POSTs to a new public Cloudflare Worker endpoint `POST /api/dd-submit`, which validates the entry, inserts it into a new `dd_submissions` Supabase table (source of truth), and fires a best-effort notification email through the existing Google Apps Script webhook. The Apps Script gains a small `dd_submission` branch (manual paste by the user).

**Tech Stack:** Astro 5, React 19 island, Tailwind/scoped CSS, Cloudflare Worker (TypeScript), Supabase Postgres, Vitest, Google Apps Script.

**Reference files (existing patterns — read, don't modify):**
- Page/island structure & styling: `src/pages/zombie-rules.astro`, `src/pages/guild-path.astro`
- React island fetch pattern: `src/components/GuildPurchase.tsx` (uses `import.meta.env.PUBLIC_WORKER_URL`)
- Worker public endpoint pattern: `worker/src/lead.ts` + `worker/src/lead.test.ts`
- Validation helpers: `worker/src/validation.ts` (`sanitizeName`, `sanitizePhone`, `sanitizeEmail`, `jsonResponse`)
- Email helper pattern: `worker/src/email.ts` (`postToAppsScript`)
- Migration style: `supabase/migrations/010_leads.sql`, `015_leads_waitlist.sql`

---

## Task 1: Supabase migration — `dd_submissions` table

**Files:**
- Create: `supabase/migrations/016_dd_submissions.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 016_dd_submissions.sql
-- Stores Demon's Draft (BotC script contest) entries submitted via the /dd page.
-- Identity (name/phone/email) is captured separately from the script so judges
-- only ever see script_json under an organizer-assigned code_name. Worker
-- (service role) writes only; the browser never reads this table directly.

create table dd_submissions (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  phone text not null,
  email text not null,
  script_json jsonb not null,
  code_name text,            -- assigned offline by organizers before judging
  created_at timestamptz not null default now()
);

create index dd_submissions_created_at_idx on dd_submissions (created_at desc);

alter table dd_submissions enable row level security;
-- No public policies — Worker (service role) only.

-- New-table grants required from migration 014+ (Supabase stops auto-exposing
-- public tables to PostgREST; this hits service_role too). Browser never reads
-- this table, so no anon grant.
grant all on public.dd_submissions to authenticated, service_role;
```

- [ ] **Step 2: Apply the migration to Supabase**

Apply via the Supabase SQL editor / migration workflow against project ref `yhgtwqdsnrslcgdvmunz`. (No local Postgres in this repo; this is a remote apply.)

Expected: table `dd_submissions` exists, RLS enabled, grants applied.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/016_dd_submissions.sql
git commit -m "feat(db): dd_submissions table for Demon's Draft contest"
```

---

## Task 2: Worker — email helper `sendDdSubmissionEmail` + Env var

**Files:**
- Modify: `worker/src/email.ts`
- Modify: `worker/src/index.ts:40-58` (Env interface)

- [ ] **Step 1: Add the payload type + helper to `worker/src/email.ts`**

Append after the existing `sendWaitlistEmail` function (end of file):

```typescript
export interface DdSubmissionEmailPayload {
  to: string[];
  name: string;
  phone: string;
  email: string;
  script_json: unknown;
  submission_id: string;
}

export async function sendDdSubmissionEmail(
  payload: DdSubmissionEmailPayload,
  env: Env
): Promise<void> {
  await postToAppsScript({ type: 'dd_submission', ...payload }, env);
}
```

- [ ] **Step 2: Add `DD_SUBMISSION_EMAILS` to the `Env` interface**

In `worker/src/index.ts`, inside the `export interface Env { ... }` block, add after `EVENT_PHOTOS_FOLDER_ID: string;`:

```typescript
  DD_SUBMISSION_EMAILS?: string;
```

- [ ] **Step 3: Type-check**

Run: `cd worker && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add worker/src/email.ts worker/src/index.ts
git commit -m "feat(worker): dd_submission email helper + Env var"
```

---

## Task 3: Worker — `dd-submit` handler (TDD)

**Files:**
- Create: `worker/src/dd-submit.ts`
- Test: `worker/src/dd-submit.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `worker/src/dd-submit.test.ts`:

```typescript
// worker/src/dd-submit.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

function mockEnv() {
  return {
    SUPABASE_URL: 'x', SUPABASE_SERVICE_KEY: 'x',
    UPI_ID: 'x', APPS_SCRIPT_URL: '', APPS_SCRIPT_SECRET: '', BGC_SITE_URL: '',
    CF_ACCESS_TEAM_DOMAIN: 'x', CF_ACCESS_AUD: 'x', ADMIN_EMAILS: '', ENVIRONMENT: 'production',
    DD_SUBMISSION_EMAILS: 'a@example.com, b@example.com',
  } as any;
}

const ctx = { waitUntil: (_p: Promise<unknown>) => {} } as any;

vi.mock('./supabase', () => ({ getSupabase: vi.fn() }));
vi.mock('./email', () => ({ sendDdSubmissionEmail: vi.fn(async () => {}) }));

import { getSupabase } from './supabase';
import { sendDdSubmissionEmail } from './email';
import { handleDdSubmit, _resetDdSubmitRateLimit } from './dd-submit';

function buildSupabaseMock(
  capture: { insertArg: any },
  opts: { insertError?: boolean } = {},
) {
  const insertError = opts.insertError ?? false;
  return {
    from: (table: string) => {
      if (table !== 'dd_submissions') throw new Error('unexpected table ' + table);
      return {
        insert: (arg: any) => {
          capture.insertArg = arg;
          return {
            select: () => ({
              single: async () =>
                insertError
                  ? { data: null, error: { message: 'boom' } }
                  : { data: { id: 'dd-1' }, error: null },
            }),
          };
        },
      };
    },
  };
}

function req(body: unknown) {
  return new Request('http://localhost/api/dd-submit', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const VALID = {
  name: 'Asha',
  phone: '9876543210',
  email: 'Asha@Example.com',
  script_json: ['_meta', 'washerwoman', 'imp'],
};

beforeEach(() => {
  _resetDdSubmitRateLimit();
  (sendDdSubmissionEmail as any).mockClear();
});

describe('handleDdSubmit', () => {
  it('inserts a valid submission and returns the id', async () => {
    const capture = { insertArg: null as any };
    (getSupabase as any).mockReturnValue(buildSupabaseMock(capture));
    const res = await handleDdSubmit(req(VALID), mockEnv(), ctx);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true, id: 'dd-1' });
    expect(capture.insertArg.name).toBe('Asha');
    expect(capture.insertArg.phone).toBe('9876543210');
    expect(capture.insertArg.email).toBe('asha@example.com');
    expect(capture.insertArg.script_json).toEqual(['_meta', 'washerwoman', 'imp']);
  });

  it('emails the recipients from DD_SUBMISSION_EMAILS', async () => {
    (getSupabase as any).mockReturnValue(buildSupabaseMock({ insertArg: null }));
    await handleDdSubmit(req(VALID), mockEnv(), ctx);
    expect(sendDdSubmissionEmail).toHaveBeenCalledTimes(1);
    const arg = (sendDdSubmissionEmail as any).mock.calls[0][0];
    expect(arg.to).toEqual(['a@example.com', 'b@example.com']);
    expect(arg.submission_id).toBe('dd-1');
  });

  it('accepts script_json as a pasted JSON string', async () => {
    const capture = { insertArg: null as any };
    (getSupabase as any).mockReturnValue(buildSupabaseMock(capture));
    const res = await handleDdSubmit(
      req({ ...VALID, script_json: JSON.stringify(['_meta', 'imp']) }),
      mockEnv(), ctx,
    );
    expect(res.status).toBe(200);
    expect(capture.insertArg.script_json).toEqual(['_meta', 'imp']);
  });

  it('rejects invalid request JSON with 400', async () => {
    (getSupabase as any).mockReturnValue(buildSupabaseMock({ insertArg: null }));
    const res = await handleDdSubmit(req('not json'), mockEnv(), ctx);
    expect(res.status).toBe(400);
  });

  it('rejects empty name with 400', async () => {
    (getSupabase as any).mockReturnValue(buildSupabaseMock({ insertArg: null }));
    const res = await handleDdSubmit(req({ ...VALID, name: '   ' }), mockEnv(), ctx);
    expect(res.status).toBe(400);
  });

  it('rejects bad phone with 400', async () => {
    (getSupabase as any).mockReturnValue(buildSupabaseMock({ insertArg: null }));
    const res = await handleDdSubmit(req({ ...VALID, phone: '123' }), mockEnv(), ctx);
    expect(res.status).toBe(400);
  });

  it('rejects bad email with 400', async () => {
    (getSupabase as any).mockReturnValue(buildSupabaseMock({ insertArg: null }));
    const res = await handleDdSubmit(req({ ...VALID, email: 'nope' }), mockEnv(), ctx);
    expect(res.status).toBe(400);
  });

  it('rejects non-array script_json with 400', async () => {
    (getSupabase as any).mockReturnValue(buildSupabaseMock({ insertArg: null }));
    const res = await handleDdSubmit(req({ ...VALID, script_json: { id: 'imp' } }), mockEnv(), ctx);
    expect(res.status).toBe(400);
  });

  it('rejects script_json string that is not valid JSON with 400', async () => {
    (getSupabase as any).mockReturnValue(buildSupabaseMock({ insertArg: null }));
    const res = await handleDdSubmit(req({ ...VALID, script_json: '[oops' }), mockEnv(), ctx);
    expect(res.status).toBe(400);
  });

  it('rejects oversized script_json with 400', async () => {
    (getSupabase as any).mockReturnValue(buildSupabaseMock({ insertArg: null }));
    const big = new Array(60000).fill('washerwoman'); // > 256KB serialized
    const res = await handleDdSubmit(req({ ...VALID, script_json: big }), mockEnv(), ctx);
    expect(res.status).toBe(400);
  });

  it('returns 500 when the DB insert fails', async () => {
    (getSupabase as any).mockReturnValue(buildSupabaseMock({ insertArg: null }, { insertError: true }));
    const res = await handleDdSubmit(req(VALID), mockEnv(), ctx);
    expect(res.status).toBe(500);
  });

  it('rate-limits a duplicate within the window without a second insert', async () => {
    const capture = { insertArg: null as any };
    (getSupabase as any).mockReturnValue(buildSupabaseMock(capture));
    await handleDdSubmit(req(VALID), mockEnv(), ctx);
    expect(capture.insertArg).not.toBeNull();
    capture.insertArg = null;
    const res2 = await handleDdSubmit(req(VALID), mockEnv(), ctx);
    expect(res2.status).toBe(200);
    expect(capture.insertArg).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd worker && npx vitest run src/dd-submit.test.ts`
Expected: FAIL — cannot find module `./dd-submit`.

- [ ] **Step 3: Write the handler**

Create `worker/src/dd-submit.ts`:

```typescript
// worker/src/dd-submit.ts
import type { Env } from './index';
import { getSupabase } from './supabase';
import { sanitizeName, sanitizePhone, sanitizeEmail, jsonResponse } from './validation';
import { sendDdSubmissionEmail } from './email';

const MAX_JSON_BYTES = 256 * 1024;

// Best-effort, per-isolate dedup of double-clicks. Map(phone -> last ms).
const RATE_LIMIT_MS = 2000;
const lastSeen = new Map<string, number>();

export function _resetDdSubmitRateLimit(): void {
  lastSeen.clear();
}

interface DdSubmitBody {
  name?: string;
  phone?: string;
  email?: string;
  script_json?: unknown;
}

export async function handleDdSubmit(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  let body: DdSubmitBody;
  try {
    body = (await request.json()) as DdSubmitBody;
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400);
  }

  const name = sanitizeName(body.name || '');
  if (!name) return jsonResponse({ error: 'Please enter your name.' }, 400);

  const phone = sanitizePhone(body.phone || '');
  if (!phone) return jsonResponse({ error: 'Please enter a valid 10-digit phone number.' }, 400);

  const email = sanitizeEmail(body.email || '');
  if (!email) return jsonResponse({ error: 'Please enter a valid email address.' }, 400);

  // script_json may arrive as a pasted JSON string or already-parsed array.
  let script: unknown = body.script_json;
  if (typeof script === 'string') {
    try {
      script = JSON.parse(script);
    } catch {
      return jsonResponse({ error: 'Your script JSON is not valid JSON.' }, 400);
    }
  }
  if (!Array.isArray(script) || script.length === 0) {
    return jsonResponse(
      { error: 'Paste the JSON exported from the script tool (it must be a non-empty list).' },
      400,
    );
  }
  const serialized = JSON.stringify(script);
  if (serialized.length > MAX_JSON_BYTES) {
    return jsonResponse({ error: 'That script JSON is too large.' }, 400);
  }

  // Rate-limit drop (absorb double-clicks).
  const now = Date.now();
  const prev = lastSeen.get(phone);
  if (prev && now - prev < RATE_LIMIT_MS) {
    return jsonResponse({ ok: true });
  }
  lastSeen.set(phone, now);

  const supabase = getSupabase(env);
  const { data, error } = await supabase
    .from('dd_submissions')
    .insert({ name, phone, email, script_json: script })
    .select('id')
    .single();

  if (error || !data) {
    return jsonResponse({ error: 'Could not save your submission. Please try again.' }, 500);
  }

  const recipients = (env.DD_SUBMISSION_EMAILS || 'boardgamecompany2024@gmail.com')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  // Email is a best-effort notification; the row is already persisted.
  ctx.waitUntil(
    sendDdSubmissionEmail(
      { to: recipients, name, phone, email, script_json: script, submission_id: data.id },
      env,
    ).catch(() => {}),
  );

  return jsonResponse({ ok: true, id: data.id });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd worker && npx vitest run src/dd-submit.test.ts`
Expected: PASS (all 12 tests).

- [ ] **Step 5: Commit**

```bash
git add worker/src/dd-submit.ts worker/src/dd-submit.test.ts
git commit -m "feat(worker): dd-submit endpoint handler + tests"
```

---

## Task 4: Worker — wire the route + wrangler var

**Files:**
- Modify: `worker/src/index.ts` (import + route in the `if/else` chain)
- Modify: `worker/wrangler.toml` (`[vars]`)

- [ ] **Step 1: Add the import**

In `worker/src/index.ts`, after `import { handleLead } from './lead';` (line 5), add:

```typescript
import { handleDdSubmit } from './dd-submit';
```

- [ ] **Step 2: Add the route**

In `worker/src/index.ts`, in the public `if/else` chain, immediately after the `/api/lead` branch:

```typescript
      } else if (url.pathname === '/api/lead' && request.method === 'POST') {
        response = await handleLead(request, env);
      } else if (url.pathname === '/api/dd-submit' && request.method === 'POST') {
        response = await handleDdSubmit(request, env, ctx);
```

- [ ] **Step 3: Add the wrangler var**

In `worker/wrangler.toml`, inside `[vars]`, add:

```toml
DD_SUBMISSION_EMAILS = "boardgamecompany2024@gmail.com"
```

- [ ] **Step 4: Run the full worker test suite + type-check**

Run: `cd worker && npm test && npx tsc --noEmit`
Expected: all tests PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add worker/src/index.ts worker/wrangler.toml
git commit -m "feat(worker): route /api/dd-submit + DD_SUBMISSION_EMAILS var"
```

---

## Task 5: Site — `DemonsDraftForm` React island

**Files:**
- Create: `src/components/DemonsDraftForm.tsx`

- [ ] **Step 1: Write the component**

Create `src/components/DemonsDraftForm.tsx`:

```tsx
import { useState } from 'react';

const WORKER_URL = import.meta.env.PUBLIC_WORKER_URL;

type Status = 'idle' | 'submitting' | 'success' | 'error';

const RED = '#C1272D';
const PARCHMENT = '#E8E0D0';
const INK = '#14110F';

const fieldStyle: React.CSSProperties = {
  width: '100%',
  background: 'rgba(0,0,0,0.35)',
  border: '1px solid rgba(232,224,208,0.25)',
  borderRadius: 8,
  color: PARCHMENT,
  padding: '0.7rem 0.85rem',
  fontSize: '0.97rem',
  fontFamily: 'Inter, sans-serif',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '0.78rem',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: '#FFD166',
  marginBottom: '0.35rem',
  fontWeight: 600,
};

export default function DemonsDraftForm() {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [scriptJson, setScriptJson] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState('');

  // null = empty, true = valid array, false = present but not a valid array
  const jsonValid: boolean | null = (() => {
    if (!scriptJson.trim()) return null;
    try {
      const parsed = JSON.parse(scriptJson);
      return Array.isArray(parsed) && parsed.length > 0;
    } catch {
      return false;
    }
  })();

  const canSubmit =
    !!name.trim() &&
    !!phone.trim() &&
    !!email.trim() &&
    jsonValid === true &&
    status !== 'submitting';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setStatus('submitting');
    setError('');
    try {
      const res = await fetch(`${WORKER_URL}/api/dd-submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, phone, email, script_json: scriptJson }),
      });
      const data = await res.json().catch(() => ({} as { ok?: boolean; error?: string }));
      if (!res.ok || !data.ok) {
        setError(data.error || 'Something went wrong. Please try again.');
        setStatus('error');
        return;
      }
      setStatus('success');
    } catch {
      setError('Network error. Please check your connection and try again.');
      setStatus('error');
    }
  }

  if (status === 'success') {
    return (
      <div
        style={{
          background: 'rgba(193,39,45,0.12)',
          border: `1px solid ${RED}`,
          borderRadius: 12,
          padding: '2rem',
          textAlign: 'center',
          color: PARCHMENT,
        }}
      >
        <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>🕯️</div>
        <h3 style={{ fontFamily: "'Space Grotesk', sans-serif", color: '#FFD166', fontSize: '1.4rem', margin: 0 }}>
          Your script is in the draft.
        </h3>
        <p style={{ marginTop: '0.75rem', opacity: 0.85 }}>
          We've received your submission. The hosts will assign it a code name and pass it to the
          judges anonymously. Good luck.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: 'grid', gap: '1.1rem' }}>
      <div>
        <label style={labelStyle} htmlFor="dd-name">Your name</label>
        <input id="dd-name" style={fieldStyle} value={name} onChange={(e) => setName(e.target.value)}
          placeholder="Kept private — never shown to judges" autoComplete="name" />
      </div>
      <div style={{ display: 'grid', gap: '1.1rem', gridTemplateColumns: '1fr 1fr' }}>
        <div>
          <label style={labelStyle} htmlFor="dd-phone">Phone</label>
          <input id="dd-phone" style={fieldStyle} value={phone} onChange={(e) => setPhone(e.target.value)}
            placeholder="10-digit number" inputMode="tel" autoComplete="tel" />
        </div>
        <div>
          <label style={labelStyle} htmlFor="dd-email">Email</label>
          <input id="dd-email" style={fieldStyle} value={email} onChange={(e) => setEmail(e.target.value)}
            placeholder="you@email.com" inputMode="email" autoComplete="email" />
        </div>
      </div>
      <div>
        <label style={labelStyle} htmlFor="dd-json">Script JSON</label>
        <textarea id="dd-json" value={scriptJson} onChange={(e) => setScriptJson(e.target.value)}
          rows={8} placeholder='Paste the JSON exported from script.bloodontheclocktower.com (e.g. [{"id":"_meta",...}, "washerwoman", ...])'
          style={{ ...fieldStyle, fontFamily: 'ui-monospace, monospace', fontSize: '0.85rem', resize: 'vertical' }} />
        {jsonValid === false && (
          <p style={{ color: '#FF8A8A', fontSize: '0.82rem', marginTop: '0.4rem' }}>
            That doesn't look like valid exported JSON yet. Use <strong>Export → JSON</strong> in the script tool and paste the whole thing.
          </p>
        )}
        {jsonValid === true && (
          <p style={{ color: '#7FD1B9', fontSize: '0.82rem', marginTop: '0.4rem' }}>
            Valid script JSON detected.
          </p>
        )}
      </div>

      {status === 'error' && (
        <p style={{ color: '#FF8A8A', fontSize: '0.9rem', margin: 0 }}>{error}</p>
      )}

      <button type="submit" disabled={!canSubmit}
        style={{
          background: canSubmit ? RED : 'rgba(193,39,45,0.4)',
          color: PARCHMENT,
          border: 'none',
          borderRadius: 8,
          padding: '0.85rem 1.2rem',
          fontSize: '1rem',
          fontWeight: 700,
          fontFamily: "'Space Grotesk', sans-serif",
          letterSpacing: '0.03em',
          cursor: canSubmit ? 'pointer' : 'not-allowed',
          textTransform: 'uppercase',
          transition: 'background 0.15s',
        }}>
        {status === 'submitting' ? 'Submitting…' : 'Submit your script'}
      </button>
      <p style={{ fontSize: '0.8rem', opacity: 0.6, margin: 0, color: PARCHMENT }}>
        By submitting you confirm your name does not appear inside the script JSON itself.
      </p>
    </form>
  );
}
```

- [ ] **Step 2: Type-check the site build**

Run: `npx astro check`
Expected: no errors for `DemonsDraftForm.tsx`. (Pre-existing warnings elsewhere are fine.)

- [ ] **Step 3: Commit**

```bash
git add src/components/DemonsDraftForm.tsx
git commit -m "feat(site): Demon's Draft submission form island"
```

---

## Task 6: Site — `/dd` rules page

**Files:**
- Create: `src/pages/dd.astro`

- [ ] **Step 1: Write the page**

Create `src/pages/dd.astro` (mirrors the structure of `src/pages/zombie-rules.astro`, recolored to the gothic palette and embedding the form island):

```astro
---
import Layout from '../layouts/Layout.astro';
import DemonsDraftForm from '../components/DemonsDraftForm.tsx';

const deadline = '15 Jun 2026';
const sections = [
  { id: 'overview', label: 'Overview' },
  { id: 'how-to-enter', label: 'How to Enter' },
  { id: 'design-rules', label: 'Submission & Design Rules' },
  { id: 'roles', label: 'Separation of Roles' },
  { id: 'phase-1', label: 'Phase 1 — The Cut' },
  { id: 'phase-2', label: 'Phase 2 — The Gauntlet' },
  { id: 'phase-3', label: 'Phase 3 — Final Scoring' },
  { id: 'finale', label: 'The Grand Finale' },
  { id: 'submit', label: 'Submit Your Script' },
];

const rubric = [
  ['Synergy & Bluff Lines', '5', 'Do the Minions/Demons have viable, cohesive bluffs? Do the Outsiders give Evil cover or safely confirm Good?'],
  ['Homebrew Rule Integration', '5', 'Does the required homebrew rule fit naturally into the script, or does it feel forced? Is it free of game-breaking interactions?'],
  ['Mechanical Integrity', '5', 'Any setups that completely starve a team of agency, or interactions that break the game?'],
  ['Theme & Flow', '5', 'Does the script have a fun, distinct identity that makes people excited to play it?'],
];

const roles = [
  ['The Creators', 'Anyone who submits a script.', 'Cannot judge, Storytell, or play any tournament match. Strictly spectators.'],
  ['Playtesters & Storytellers', 'A fixed group of 12–15 players and 2–3 STs.', 'Cannot submit a script. Play every finalist script blind, never knowing who wrote it.'],
  ['The Judging Panel', '3–5 highly experienced players / STs.', 'Cannot submit or play in the playtests. Evaluate the raw scripts in Phase 1 only.'],
];
---

<Layout
  title="Demon's Draft — BotC Script Contest"
  description="Demon's Draft: The Bootlegger's Gambit. A Blood on the Clocktower homebrew-rule script contest by Board Game Company. Build a script around a custom rule, submit blind, get playtested. Deadline 15 Jun 2026."
>
  <div class="dd-rule-strip" aria-hidden="true"></div>

  <!-- Hero -->
  <section class="relative overflow-hidden" style="background: #14110F; color: #E8E0D0;">
    <div class="absolute inset-0 opacity-[0.06] pointer-events-none" style="background-image: radial-gradient(#C1272D 1px, transparent 1px); background-size: 22px 22px;"></div>
    <div class="max-w-[920px] mx-auto px-6 py-16 md:py-24 relative">
      <div class="flex items-center gap-3 text-xs tracking-[0.3em] uppercase mb-5" style="color: #FFD166;">
        <span class="inline-block w-2 h-2 rounded-full" style="background: #C1272D; box-shadow: 0 0 12px #C1272D;"></span>
        <span>BotC Script Contest · The Bootlegger's Gambit</span>
      </div>
      <h1 class="font-heading font-bold" style="font-size: clamp(2.8rem, 7vw, 5.4rem); letter-spacing: -2px; line-height: 0.95;">
        DEMON'S <span style="color: #C1272D;">DRAFT</span>
      </h1>
      <p class="mt-5 max-w-[640px] text-lg md:text-xl" style="color: #E8E0D0; opacity: 0.85;">
        Design a Blood on the Clocktower script built around <strong style="color: #FFD166;">your own homebrew rule</strong>.
        Submit it blind. The best scripts get played, scored, and one is crowned <strong style="color: #FFD166;">Community Script Champion</strong>.
      </p>
      <div class="mt-8 flex flex-wrap gap-3 text-sm">
        <span class="px-3 py-1.5 rounded-full" style="background: rgba(193,39,45,0.15); color: #E48; border: 1px solid rgba(193,39,45,0.4);">Deadline · {deadline}</span>
        <span class="px-3 py-1.5 rounded-full" style="background: rgba(255,209,102,0.12); color: #FFD166; border: 1px solid rgba(255,209,102,0.35);">Online playtests</span>
        <span class="px-3 py-1.5 rounded-full" style="background: rgba(244,123,32,0.15); color: #F47B20; border: 1px solid rgba(244,123,32,0.4);">Open to everyone</span>
      </div>
      <a href="#submit" class="dd-cta mt-9">Submit your script ↓</a>
    </div>
  </section>

  <!-- TOC -->
  <section style="background: #1B1714; border-bottom: 1px solid rgba(232,224,208,0.1);">
    <div class="max-w-[920px] mx-auto px-6 py-6">
      <div class="text-xs tracking-[0.25em] uppercase mb-3" style="color: #E8E0D0; opacity: 0.5;">Contents</div>
      <nav class="flex flex-wrap gap-x-4 gap-y-2 text-sm">
        {sections.map((s, i) => (
          <a href={`#${s.id}`} class="dd-toc-link">
            <span class="dd-toc-num">{String(i + 1).padStart(2, '0')}</span>{s.label}
          </a>
        ))}
      </nav>
    </div>
  </section>

  <!-- Body -->
  <section style="background: #14110F;" class="py-14">
    <div class="max-w-[760px] mx-auto px-6 prose-d">

      <h2 id="overview">Overview</h2>
      <p>
        <strong>Demon's Draft</strong> is a Blood on the Clocktower script-design contest. The theme is
        <em>The Bootlegger's Gambit</em>: every script must be built around at least one
        <strong>homebrew rule</strong> of your own design. Create your script, submit it anonymously,
        and the strongest entries are judged on paper, then playtested live online before a champion is crowned.
      </p>
      <div class="dd-callout dd-callout-accent">
        <strong>The prize:</strong> the winner is crowned <strong>Community Script Champion</strong> — and the
        winning script is run as a featured BGC event.
      </div>

      <h2 id="how-to-enter">How to Enter</h2>
      <ol>
        <li>Build your script on the official tool: <a href="https://script.bloodontheclocktower.com/" target="_blank" rel="noopener">script.bloodontheclocktower.com</a>.</li>
        <li>Add your <strong>homebrew rule</strong> using the tool's <strong>Bootlegger</strong> feature. You may add more than one, but at least one is required.</li>
        <li><strong>Do not put your name anywhere inside the script</strong> (leave the author field blank or generic) — judges only ever see the script.</li>
        <li>Use <strong>Export → JSON</strong> and copy the result.</li>
        <li>Paste it into the <a href="#submit">submission form</a> at the bottom of this page, along with your name, phone, and email (kept private, never shown to judges).</li>
      </ol>
      <p>Submissions close <strong>{deadline}</strong>.</p>

      <h2 id="design-rules">Submission & Design Rules</h2>
      <p>Every script must follow these constraints. Failure to do so means disqualification before judging.</p>
      <ul>
        <li><strong>The Bootlegger Constraint.</strong> Your script must include at least one custom <strong>homebrew rule</strong> (added via the Bootlegger feature). The script's mechanics and balance must actively revolve around or complement it. <strong>Homebrew characters are not allowed</strong> — every character must be an official one.</li>
        <li><strong>Standard Composition.</strong> Exactly <strong>13 Townsfolk, 4 Outsiders, 4 Minions, and 4 Demons</strong> — 25 official characters total.</li>
        <li><strong>Total Anonymity.</strong> Your identity is captured by the submission form, separately from the script. Keep your name out of the script itself. Organizers assign each script a random code name (e.g. <em>Script Echo</em>) before judging.</li>
      </ul>

      <h2 id="roles">Separation of Roles</h2>
      <p>To keep things fair, the community splits into three non-overlapping groups.</p>
      <div class="dd-table-wrap">
        <table class="dd-table">
          <thead><tr><th>Group</th><th>Who</th><th>Rules</th></tr></thead>
          <tbody>
            {roles.map(([group, who, rule]) => (
              <tr><td class="font-semibold whitespace-nowrap">{group}</td><td>{who}</td><td>{rule}</td></tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 id="phase-1">Phase 1 — The Blind Paper Test (The Cut)</h2>
      <p>
        After the deadline, the Head Organizer passes the anonymized scripts to the Judging Panel.
        Judges review each script on paper and score it out of <strong>20 points</strong>:
      </p>
      <div class="dd-table-wrap">
        <table class="dd-table">
          <thead><tr><th>Criterion</th><th>Pts</th><th>What it measures</th></tr></thead>
          <tbody>
            {rubric.map(([crit, pts, desc]) => (
              <tr><td class="font-semibold">{crit}</td><td><span class="dd-pts">{pts}</span></td><td>{desc}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>The <strong>Top 4 scripts</strong> by average judge score advance to the Live Playtests.</p>

      <h2 id="phase-2">Phase 2 — The Blind Playtests (The Gauntlet)</h2>
      <p>The Top 4 scripts are played online over a designated period, labelled only with their code names — no one knows who wrote them. To test how each script scales, <strong>every finalist is played exactly twice, back-to-back</strong>:</p>
      <ul>
        <li><strong>Game 1 — Small Setup (9–10 players):</strong> tests pacing, bluff tightness, and speed.</li>
        <li><strong>Game 2 — Large Setup (12–14 players):</strong> tests information clutter, mechanical chaos, and deep-game endurance.</li>
      </ul>

      <h2 id="phase-3">Phase 3 — Final Scoring</h2>
      <p>Immediately after a script finishes its second game, the Playtesters and Storytellers fill out an anonymous form rating it from <strong>1 to 10</strong> on three axes:</p>
      <ol>
        <li><strong>Fun Factor.</strong> Win or lose, did both teams have fun and a viable path to victory?</li>
        <li><strong>Information Balance.</strong> Was the information environment balanced, or did it feel one-sided (Good solved it instantly, or Evil was untouchable)?</li>
        <li><strong>ST Flow (Storytellers only).</strong> Did the script run smoothly in the Grimoire, or was it a logistical nightmare to Storytell?</li>
      </ol>
      <div class="dd-callout dd-callout-quote">
        <strong>How the score is calculated.</strong> A script's final score is the average of the three axes. Fun Factor and Information Balance average every player and ST response across both games; ST Flow averages the Storyteller responses across both games. Tie-break: higher Fun Factor, then higher Information Balance.
      </div>

      <h2 id="finale">The Grand Finale</h2>
      <p>
        Once the Head Organizer locks in the final math, the creator identities are revealed at last.
        The anonymous script with the highest overall score is crowned <strong>Community Script Champion</strong>,
        and the winning script is run as a featured BGC event.
      </p>

      <h2 id="submit">Submit Your Script</h2>
      <p>
        Built your script on <a href="https://script.bloodontheclocktower.com/" target="_blank" rel="noopener">the script tool</a>?
        Export it to JSON and paste it below. Your contact details stay private — judges only ever see the script.
      </p>
      <div class="dd-form-card">
        <DemonsDraftForm client:load />
      </div>

      <div class="dd-end-mark">
        <span>// THE DRAFT IS OPEN</span>
        <span class="opacity-60">Deadline {deadline}</span>
      </div>
    </div>
  </section>

  <div class="dd-rule-strip" aria-hidden="true"></div>

  <style is:global>
    .dd-rule-strip {
      height: 6px;
      background: linear-gradient(90deg, #14110F 0%, #C1272D 50%, #14110F 100%);
    }

    .dd-cta {
      display: inline-block;
      background: #C1272D;
      color: #E8E0D0;
      font-family: 'Space Grotesk', sans-serif;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      text-decoration: none;
      padding: 0.8rem 1.4rem;
      border-radius: 8px;
      transition: transform 0.12s, background 0.15s;
    }
    .dd-cta:hover { background: #A81F25; transform: translateY(-1px); }

    .dd-toc-link {
      display: inline-flex;
      align-items: baseline;
      gap: 0.4rem;
      color: #E8E0D0;
      text-decoration: none;
      padding: 2px 0;
      border-bottom: 1px solid transparent;
      transition: border-color 0.15s, color 0.15s;
    }
    .dd-toc-link:hover { color: #C1272D; border-bottom-color: #C1272D; }
    .dd-toc-num {
      font-family: 'Space Grotesk', sans-serif;
      font-size: 0.7rem; font-weight: 600; color: #C1272D; letter-spacing: 0.05em;
    }

    .prose-d { color: #E8E0D0; line-height: 1.75; font-size: 1rem; }
    .prose-d h2 {
      font-family: 'Space Grotesk', sans-serif;
      font-weight: 700; font-size: 1.85rem;
      margin-top: 3.5rem; margin-bottom: 1rem;
      letter-spacing: -0.8px; padding-bottom: 0.4rem;
      border-bottom: 2px solid rgba(232,224,208,0.25);
      position: relative; color: #E8E0D0;
    }
    .prose-d h2::before {
      content: ''; position: absolute; bottom: -2px; left: 0;
      width: 60px; height: 2px; background: #C1272D;
    }
    .prose-d h2:first-of-type { margin-top: 0.5rem; }
    .prose-d p { margin: 0.9rem 0; }
    .prose-d ul, .prose-d ol { margin: 0.9rem 0 0.9rem 1.4rem; padding: 0; }
    .prose-d li { margin: 0.5rem 0; }
    .prose-d a { color: #FFD166; text-decoration: underline; text-underline-offset: 3px; }
    .prose-d a:hover { color: #C1272D; }
    .prose-d strong { color: #FBF3E2; }
    .prose-d em { color: #E8E0D0; }

    .dd-table-wrap {
      overflow-x: auto; margin: 1rem 0 1.4rem;
      border: 1px solid rgba(232,224,208,0.15); border-radius: 8px;
    }
    .dd-table { width: 100%; border-collapse: collapse; font-size: 0.93rem; background: #1B1714; }
    .dd-table th {
      text-align: left; background: #0E0C0A; color: #FFD166;
      font-family: 'Space Grotesk', sans-serif; font-weight: 600;
      font-size: 0.74rem; letter-spacing: 0.08em; text-transform: uppercase;
      padding: 0.7rem 0.9rem;
    }
    .dd-table td {
      padding: 0.7rem 0.9rem; border-top: 1px solid rgba(232,224,208,0.08);
      vertical-align: top; color: #E8E0D0;
    }
    .dd-table tr:hover td { background: rgba(193,39,45,0.07); }
    .dd-pts {
      font-family: 'Space Grotesk', sans-serif; font-weight: 700; font-size: 0.85rem;
      background: #C1272D; color: #FBF3E2; padding: 2px 9px; border-radius: 999px;
    }

    .dd-callout {
      margin: 1.3rem 0; padding: 1rem 1.1rem; border-radius: 8px;
      border-left: 4px solid; font-size: 0.97rem; color: #E8E0D0;
    }
    .dd-callout-accent { background: rgba(193,39,45,0.12); border-left-color: #C1272D; }
    .dd-callout-quote { background: rgba(255,209,102,0.1); border-left-color: #FFD166; }

    .dd-form-card {
      margin: 1.5rem 0; padding: 1.6rem; border-radius: 12px;
      background: #1B1714; border: 1px solid rgba(232,224,208,0.15);
    }

    .dd-end-mark {
      margin-top: 4rem; padding-top: 1.5rem;
      border-top: 2px dashed rgba(232,224,208,0.2);
      display: flex; justify-content: space-between; flex-wrap: wrap; gap: 0.5rem;
      font-family: 'Space Grotesk', sans-serif; font-size: 0.85rem;
      letter-spacing: 0.1em; text-transform: uppercase; color: #E8E0D0;
    }

    html { scroll-behavior: smooth; }
    .prose-d h2 { scroll-margin-top: 90px; }
  </style>
</Layout>
```

- [ ] **Step 2: Build the site to verify it compiles**

Run: `npm run build`
Expected: build succeeds; `dd/index.html` is emitted in `dist/`.

- [ ] **Step 3: Visually verify in dev**

Run: `npm run dev` and open `http://localhost:4321/dd`.
Expected: gothic dark page renders, TOC anchors jump correctly, the form island renders with live JSON validation (paste a sample array → "Valid script JSON detected").

- [ ] **Step 4: Commit**

```bash
git add src/pages/dd.astro
git commit -m "feat(site): Demon's Draft (/dd) contest rules page"
```

---

## Task 7: Apps Script branch + deployment notes (deliverable)

**Files:**
- Create: `docs/dd-apps-script-snippet.md`

This documents the manual step the user must perform on the external Google Apps Script (behind `APPS_SCRIPT_URL`) and the deploy checklist. The worker already persists every submission to Supabase, so email is best-effort — but this enables the notification.

- [ ] **Step 1: Write the snippet doc**

Create `docs/dd-apps-script-snippet.md`:

````markdown
# Demon's Draft — Apps Script email branch

The worker posts `{ type: 'dd_submission', to: [..emails..], name, phone, email, script_json, submission_id, secret }`
to `APPS_SCRIPT_URL`. Add a branch to the Apps Script's `doPost` dispatcher that handles `type === 'dd_submission'`:

```javascript
function handleDdSubmission(data) {
  var recipients = (data.to && data.to.length ? data.to : ['boardgamecompany2024@gmail.com']).join(',');
  var subject = "Demon's Draft submission — " + data.name;
  var json = JSON.stringify(data.script_json, null, 2);
  var body =
    'New Demon\'s Draft script submission.\n\n' +
    'Name: ' + data.name + '\n' +
    'Phone: ' + data.phone + '\n' +
    'Email: ' + data.email + '\n' +
    'Submission ID: ' + data.submission_id + '\n\n' +
    'Script JSON is attached and included below.\n\n' + json;

  MailApp.sendEmail({
    to: recipients,
    subject: subject,
    body: body,
    attachments: [Utilities.newBlob(json, 'application/json', 'script-' + data.submission_id + '.json')],
  });
  return { success: true };
}
```

Wire it into the existing dispatcher alongside the other `type`s, e.g.:

```javascript
if (data.type === 'dd_submission') return jsonOut(handleDdSubmission(data));
```

(Keep the existing `secret` verification that the other handlers already use.)

Then **redeploy** the Apps Script web app (Deploy → Manage deployments → new version) so the new branch goes live.

## Deploy checklist for Demon's Draft

1. Apply migration `016_dd_submissions.sql` to Supabase (ref `yhgtwqdsnrslcgdvmunz`).
2. `cd worker && npx wrangler deploy` (worker does NOT auto-deploy on push).
3. Push to `main` → Cloudflare Pages auto-deploys the site (`/dd`).
4. Paste the `dd_submission` branch into the Apps Script and redeploy it.
5. To change notification recipients later: edit `DD_SUBMISSION_EMAILS` in `worker/wrangler.toml` and redeploy the worker (comma-separated).
6. Smoke test: open `/dd`, paste a real exported script, submit; confirm a row in `dd_submissions` and an email at `boardgamecompany2024@gmail.com`.
````

- [ ] **Step 2: Commit**

```bash
git add docs/dd-apps-script-snippet.md
git commit -m "docs: Demon's Draft Apps Script branch + deploy checklist"
```

---

## Final verification

- [ ] **Worker:** `cd worker && npm test && npx tsc --noEmit` — all pass.
- [ ] **Site:** `npm run build` — succeeds, `dist/dd/index.html` present.
- [ ] **Manual:** `/dd` renders gothic, form validates JSON live, anchors work.
- [ ] **Spec coverage check** against `docs/superpowers/specs/2026-06-07-demons-draft-contest-design.md`:
  - Rules corrections (homebrew-rule constraint, no homebrew chars, 13/4/4/4 official, anonymity, online, prize, deadline, Phase 3 aggregation) → Task 6.
  - `dd_submissions` table → Task 1.
  - `POST /api/dd-submit` (validate/insert/email, recipients var, rate-limit) → Tasks 2–4.
  - Form island (name/phone/email/JSON, client validation) → Task 5.
  - Apps Script branch + deploy steps → Task 7.
