# Source Attribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture a `?source=` URL parameter (e.g. `?source=instagram`), persist it in sessionStorage with first-touch semantics, and stamp it onto `users.source` (first-touch on user creation), `registrations.source` (per signup), and `guild_path_members.source` (per signup) per `docs/superpowers/specs/2026-04-30-source-attribution-design.md`.

**Architecture:** A single nullable `source text` column added to three tables. A small inline script in `Layout.astro` captures `?source=` on every page load and writes it to `sessionStorage.bgc_source` (first-touch wins). React forms (`RegistrationForm.tsx`, `GuildPurchase.tsx`) read it via `src/lib/source.ts` and send it on the existing `/api/register` and `/api/guild-purchase` POST bodies. The Worker re-sanitizes (defense in depth) and writes the column on insert.

**Tech Stack:** Astro 5 · React 19 islands · Tailwind 4 · Cloudflare Workers · Supabase (via service role key in Worker) · Supabase MCP for migrations

**Verification approach:** This codebase has no unit-test framework. Tasks verify with: (1) `npx astro check` for type errors, (2) `cd worker && npx tsc --noEmit` for Worker type errors, (3) `npm run dev` + browser DevTools to observe sessionStorage and network requests, and (4) Supabase queries to confirm rows have the expected `source` value. Each task leaves the codebase in a working state.

---

## File Map

**New:**
- `supabase/migrations/004_source_attribution.sql` — adds nullable `source` column to three tables
- `src/lib/source.ts` — `getSource(): string | null` reading from sessionStorage

**Modified:**
- `src/layouts/Layout.astro` — adds an inline `<script is:inline>` that captures `?source=` and writes to sessionStorage with first-touch semantics
- `src/components/RegistrationForm.tsx` — sends `source` in `/api/register` POST body
- `src/components/GuildPurchase.tsx` — sends `source` in `/api/guild-purchase` POST body
- `worker/src/validation.ts` — adds `sanitizeSource` helper
- `worker/src/register.ts` — accepts `source`, sets `users.source` only on user insert, sets `registrations.source` always
- `worker/src/guild-purchase.ts` — accepts `source`, sets `users.source` only on user insert, sets `guild_path_members.source` always

---

## Task 1: Apply the database migration

**Why first:** All later tasks read from or write to these columns. Adding the columns first means worker/frontend changes can be deployed in any order without coupling.

**Files:**
- Create: `supabase/migrations/004_source_attribution.sql`

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/004_source_attribution.sql`:

```sql
-- Add source attribution columns. All nullable — historical rows stay NULL.
alter table users add column source text;
alter table registrations add column source text;
alter table guild_path_members add column source text;
```

- [ ] **Step 2: Apply the migration to Supabase**

Use the Supabase MCP `apply_migration` tool with project ref `yhgtwqdsnrslcgdvmunz`, name `source_attribution`, and the SQL from Step 1. Do NOT run this via psql or Supabase Studio manually — use the MCP tool so it's recorded in the migration history.

- [ ] **Step 3: Verify the columns exist**

Run via Supabase MCP `execute_sql`:

```sql
select table_name, column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and column_name = 'source'
  and table_name in ('users', 'registrations', 'guild_path_members')
order by table_name;
```

Expected: 3 rows, each `data_type = text`, `is_nullable = YES`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/004_source_attribution.sql
git commit -m "feat(db): add source column to users, registrations, guild_path_members"
```

---

## Task 2: Add `sanitizeSource` to Worker validation

**Why before Worker handlers:** The handlers will import this helper.

**Files:**
- Modify: `worker/src/validation.ts`

- [ ] **Step 1: Add the helper**

Append to `worker/src/validation.ts` (after `sanitizeName`, before `jsonResponse`):

```ts
export function sanitizeSource(source: unknown): string | null {
  if (typeof source !== 'string') return null;
  const cleaned = source.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 50);
  return cleaned.length > 0 ? cleaned : null;
}
```

Rules: lowercase, keep only `[a-z0-9_-]`, max 50 chars, return null if empty after sanitize or non-string input.

- [ ] **Step 2: Verify Worker types**

```bash
cd worker && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add worker/src/validation.ts
git commit -m "feat(worker): add sanitizeSource validation helper"
```

---

## Task 3: Wire `source` through the register handler

**Files:**
- Modify: `worker/src/register.ts`

- [ ] **Step 1: Import `sanitizeSource`**

Update the import at the top of `worker/src/register.ts`:

```ts
import { sanitizePhone, sanitizeEmail, sanitizeName, sanitizeSource, jsonResponse } from './validation';
```

- [ ] **Step 2: Accept `source` in the request body type**

Update the `request.json<...>()` type (lines 6–14) to include `source`:

```ts
const body = await request.json<{
  event_id: string;
  name: string;
  phone: string;
  email: string;
  seats: number;
  custom_answers: Record<string, string | boolean>;
  payment_status: 'pending' | 'confirmed';
  source?: string;
}>();
```

- [ ] **Step 3: Sanitize source after the existing sanitization block**

After the `payment_status` validation check (around line 32), add:

```ts
const source = sanitizeSource(body.source);
```

No early return — `null` is valid (means "no source").

- [ ] **Step 4: Set `users.source` on insert only**

Find the user insert block (around line 116):

```ts
} else {
  const { data: newUser, error: userError } = await supabase
    .from('users')
    .insert({ phone, name, email })
    .select('id')
    .single();
```

Change the insert payload to include `source`:

```ts
} else {
  const { data: newUser, error: userError } = await supabase
    .from('users')
    .insert({ phone, name, email, source })
    .select('id')
    .single();
```

Do NOT add `source` to the `users` UPDATE branch above — first-touch must not be overwritten.

- [ ] **Step 5: Set `registrations.source` on insert**

Find the `registrations` insert (around line 152) and add `source` to the payload:

```ts
const { data: registration, error: regError } = await supabase
  .from('registrations')
  .insert({
    event_id: body.event_id,
    user_id: userId,
    name,
    phone,
    email,
    seats,
    total_amount: totalAmount,
    discount_applied: discountApplied,
    custom_answers: customAnswers,
    payment_status: body.payment_status,
    source,
  })
  .select('id')
  .single();
```

- [ ] **Step 6: Verify Worker types**

```bash
cd worker && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add worker/src/register.ts
git commit -m "feat(worker): attribute event registrations to source param"
```

---

## Task 4: Wire `source` through the guild-purchase handler

**Files:**
- Modify: `worker/src/guild-purchase.ts`

- [ ] **Step 1: Import `sanitizeSource`**

Update the import at the top:

```ts
import { sanitizePhone, sanitizeEmail, sanitizeName, sanitizeSource, jsonResponse } from './validation';
```

- [ ] **Step 2: Accept `source` in the request body type**

Update lines 21–26:

```ts
const body = await request.json<{
  name: string;
  phone: string;
  email: string;
  tier: string;
  source?: string;
}>();
```

- [ ] **Step 3: Sanitize source after the tier validation**

After the `VALID_TIERS.includes(...)` check (around line 38), add:

```ts
const source = sanitizeSource(body.source);
```

- [ ] **Step 4: Set `users.source` on insert only**

Find the user insert (around line 63):

```ts
const { data: newUser, error: userError } = await supabase
  .from('users')
  .insert({ phone, name, email })
  .select('id')
  .single();
```

Change to:

```ts
const { data: newUser, error: userError } = await supabase
  .from('users')
  .insert({ phone, name, email, source })
  .select('id')
  .single();
```

Do NOT add `source` to the `users` UPDATE branch above (first-touch).

- [ ] **Step 5: Set `guild_path_members.source` on insert**

Find the `guild_path_members` insert (around line 83) and add `source`:

```ts
const { data: purchase, error: purchaseError } = await supabase
  .from('guild_path_members')
  .insert({
    user_id: userId,
    tier,
    amount,
    status: 'pending',
    starts_at: startsAt,
    expires_at: expiresAt,
    source,
  })
  .select('id')
  .single();
```

- [ ] **Step 6: Verify Worker types**

```bash
cd worker && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Deploy the Worker**

```bash
cd worker && npx wrangler deploy
```

Expected: a deploy success line ending with the worker URL.

After this step the deployed Worker accepts and persists `source` for both endpoints. The old frontend continues to work because `source` is optional and `sanitizeSource(undefined)` returns `null`.

- [ ] **Step 8: Commit**

```bash
git add worker/src/guild-purchase.ts
git commit -m "feat(worker): attribute guild path purchases to source param"
```

---

## Task 5: Add the frontend source-capture util

**Files:**
- Create: `src/lib/source.ts`

- [ ] **Step 1: Write the util**

Create `src/lib/source.ts`:

```ts
const STORAGE_KEY = 'bgc_source';

export function getSource(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}
```

The capture-and-write logic lives in the inline script in `Layout.astro` (next task) so that it runs before any React island hydrates. This file is the read side only.

- [ ] **Step 2: Verify types**

```bash
npx astro check
```

Expected: 0 errors. (Warnings unrelated to this file are fine.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/source.ts
git commit -m "feat: add getSource helper for marketing attribution"
```

---

## Task 6: Capture `?source=` in Layout.astro

**Why an inline script (not a module):** It must run before React islands hydrate so `getSource()` returns the right value on first render. `is:inline` ensures Astro emits it verbatim in `<head>`-adjacent position with no bundling delay.

**Files:**
- Modify: `src/layouts/Layout.astro`

- [ ] **Step 1: Add the capture script**

In `src/layouts/Layout.astro`, find the existing `<script>` block at the bottom of `<body>` (around lines 36–46, the IntersectionObserver one). Add a NEW script block immediately above it:

```astro
    <script is:inline>
      (function () {
        try {
          var KEY = 'bgc_source';
          if (sessionStorage.getItem(KEY)) return;
          var raw = new URLSearchParams(window.location.search).get('source');
          if (!raw) return;
          var cleaned = raw.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 50);
          if (cleaned) sessionStorage.setItem(KEY, cleaned);
        } catch (e) {}
      })();
    </script>
```

Sanitization rules MUST match `sanitizeSource` in `worker/src/validation.ts`: lowercase, `[a-z0-9_-]`, max 50 chars. First-touch wins via the early `return` if the key already exists.

- [ ] **Step 2: Run dev server and verify capture**

```bash
npm run dev
```

In a browser, open `http://localhost:4321/?source=instagram`. Open DevTools → Application → Session Storage → `http://localhost:4321`. Expected: a key `bgc_source` with value `instagram`.

- [ ] **Step 3: Verify first-touch wins**

In the same tab, navigate to `http://localhost:4321/?source=whatsapp`. Refresh sessionStorage view. Expected: `bgc_source` is still `instagram` (NOT overwritten).

- [ ] **Step 4: Verify sanitization**

Open a fresh tab (so sessionStorage is empty for this tab). Navigate to `http://localhost:4321/?source=<script>alert(1)</script>`. Expected: `bgc_source` is `scriptalert1script` (no angle brackets, no parens) — and crucially, no script ran. Open one more fresh tab with `?source=` (empty value): expected no `bgc_source` key set.

- [ ] **Step 5: Commit**

```bash
git add src/layouts/Layout.astro
git commit -m "feat: capture ?source= URL param into session storage"
```

---

## Task 7: Send `source` from RegistrationForm

**Files:**
- Modify: `src/components/RegistrationForm.tsx`

- [ ] **Step 1: Import `getSource`**

Add at the top of `src/components/RegistrationForm.tsx`, near the existing imports (after the `supabase` import on line 2):

```tsx
import { getSource } from '../lib/source';
```

- [ ] **Step 2: Include `source` in the register POST body**

In `submitRegistration` (around lines 162–175), add `source: getSource()` to the JSON body:

```tsx
const res = await fetch(`${WORKER_URL}/api/register`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    event_id: eventId,
    name,
    phone,
    email,
    seats,
    custom_answers: customAnswers,
    payment_status: paymentStatus,
    source: getSource(),
  }),
});
```

- [ ] **Step 3: Verify types**

```bash
npx astro check
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/RegistrationForm.tsx
git commit -m "feat(register): send source attribution with registration"
```

---

## Task 8: Send `source` from GuildPurchase

**Files:**
- Modify: `src/components/GuildPurchase.tsx`

- [ ] **Step 1: Import `getSource`**

Add at the top of `src/components/GuildPurchase.tsx`, after the existing imports (line 3):

```tsx
import { getSource } from '../lib/source';
```

- [ ] **Step 2: Include `source` in the guild-purchase POST body**

In `handlePaymentConfirm` (around lines 42–51), add `source: getSource()`:

```tsx
const res = await fetch(`${WORKER_URL}/api/guild-purchase`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name,
    phone,
    email,
    tier: selectedTier.key,
    source: getSource(),
  }),
});
```

- [ ] **Step 3: Verify types**

```bash
npx astro check
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/GuildPurchase.tsx
git commit -m "feat(guild): send source attribution with guild purchase"
```

---

## Task 9: End-to-end manual verification

**Why:** Confirm the full pipeline works with the deployed Worker against the live database. Use a brand-new test phone number to avoid colliding with existing users — `users.source` must only set on insert, so reusing an existing phone won't exercise that path.

**Files:** None — verification only.

- [ ] **Step 1: Choose a test phone**

Pick a 10-digit phone number that does NOT already exist in `users`. Verify with Supabase MCP:

```sql
select id, phone, source from users where phone = '<TEST_PHONE>';
```

Expected: 0 rows. If 1 row exists, pick a different number.

- [ ] **Step 2: Test event registration with source**

Run `npm run dev`. In a fresh browser tab (no existing sessionStorage), open:

```
http://localhost:4321/register?source=instagram
```

Complete the registration form with the test phone. For a paid event, click through the payment sheet and confirm. For a free event (e.g., a guild member or `event.price = 0`), the form submits directly.

After the success screen appears, query Supabase MCP:

```sql
select source from registrations where phone = '<TEST_PHONE>' order by created_at desc limit 1;
select source from users where phone = '<TEST_PHONE>';
```

Expected: both rows have `source = 'instagram'`.

- [ ] **Step 3: Test first-touch persistence**

In a fresh tab (clear sessionStorage), open:

```
http://localhost:4321/register?source=whatsapp
```

Register the SAME test phone for a different event (or, if only one event exists, repeat the same one — `registrations` allows duplicates). Query:

```sql
select source from users where phone = '<TEST_PHONE>';
select source from registrations where phone = '<TEST_PHONE>' order by created_at desc limit 2;
```

Expected: `users.source = 'instagram'` (unchanged — first-touch). The two `registrations` rows should be `whatsapp` (newest) and `instagram` (older).

- [ ] **Step 4: Test direct visit (no source)**

In a fresh tab (clear sessionStorage), open `http://localhost:4321/register` with NO query params. Use a NEW test phone (not the one from Step 1). Complete a registration. Query:

```sql
select source from users where phone = '<TEST_PHONE_2>';
select source from registrations where phone = '<TEST_PHONE_2>' order by created_at desc limit 1;
```

Expected: both rows have `source IS NULL`.

- [ ] **Step 5: Test guild path with source**

In a fresh tab (clear sessionStorage), open:

```
http://localhost:4321/guild-path?source=telegram
```

Use a THIRD new test phone. Click any tier → fill form → confirm payment. Query:

```sql
select source from users where phone = '<TEST_PHONE_3>';
select source from guild_path_members where user_id = (select id from users where phone = '<TEST_PHONE_3>');
```

Expected: both rows have `source = 'telegram'`.

- [ ] **Step 6: Clean up test data (optional)**

If desired, delete the test rows via Supabase MCP. The migration and code changes are complete regardless.
