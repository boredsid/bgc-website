# User Credits Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a user-level credit system. Cancelling a confirmed registration credits the user; credits auto-apply to future event registrations and guild memberships; admins manage users + credits via a new Users tab.

**Architecture:** Append-only ledger table `user_credits` (balance = sum of `amount`). New column `registrations.credits_applied`. Worker computes/applies/refunds credits on every registration write and every status transition. New admin Users page + drawer surfaces balance, ledger, and manual adjustment.

**Tech Stack:** Supabase (Postgres + RLS), Cloudflare Worker (TypeScript, vitest), Astro + React (public site), React + Vite (admin app), shadcn/ui.

**Spec:** `docs/superpowers/specs/2026-05-06-user-credits-design.md`

---

## File map

**Migrations:**
- Create: `supabase/migrations/008_user_credits.sql`

**Worker:**
- Create: `worker/src/credits.ts`
- Create: `worker/src/credits.test.ts`
- Modify: `worker/src/lookup-phone.ts` (return `credit_balance`)
- Modify: `worker/src/register.ts` (apply credits on insert)
- Modify: `worker/src/admin/register-manual.ts` (apply credits)
- Modify: `worker/src/guild-purchase.ts` (apply credits)
- Modify: `worker/src/cancel.ts` (emit cancellation row)
- Modify: `worker/src/admin/registrations.ts` (emit cancellation/reversal rows on PATCH)
- Modify: `worker/src/admin/users.ts` (list + ledger + adjustment)
- Modify: `worker/src/index.ts` (route additions)

**Admin app:**
- Modify: `admin/src/lib/types.ts` (UserCreditEntry, UserWithCredits)
- Create: `admin/src/pages/UsersList.tsx`
- Create: `admin/src/pages/UsersList.test.tsx`
- Modify: `admin/src/pages/UserDrawer.tsx` (full rebuild — list-side drawer)
- Modify: `admin/src/App.tsx` (routes)
- Modify: `admin/src/components/Sidebar.tsx` (Users entry)
- Modify: `admin/src/components/BottomTabBar.tsx` (Users tab)
- Modify: `admin/src/pages/RegistrationDrawer.tsx` (status-change hint)
- Modify: `admin/src/pages/ManualRegistrationDrawer.tsx` (credit summary line)

**Public site:**
- Modify: `src/components/RegistrationForm.tsx` (credit summary)
- Modify: `src/components/PaymentSheet.tsx` and/or guild purchase flow caller (credit summary)

---

## Task 1: Migration `008_user_credits.sql`

**Files:**
- Create: `supabase/migrations/008_user_credits.sql`

- [ ] **Step 1: Write migration SQL**

```sql
-- 008_user_credits.sql
-- Append-only ledger of user credit movements. Balance = sum(amount) per user.

create table user_credits (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references users(id) on delete cascade,
  amount int not null,
  reason text not null check (reason in (
    'cancellation',
    'cancellation_reversal',
    'registration_use',
    'guild_use',
    'admin_adjustment'
  )),
  registration_id uuid references registrations(id) on delete set null,
  guild_member_id uuid references guild_path_members(id) on delete set null,
  note text,
  created_by text,
  created_at timestamptz not null default now()
);

create index user_credits_user_id_idx on user_credits (user_id);
create index user_credits_registration_id_idx
  on user_credits (registration_id) where registration_id is not null;

alter table user_credits enable row level security;
-- No public policies — Worker (service role) only

alter table registrations
  add column if not exists credits_applied int not null default 0;
```

- [ ] **Step 2: Apply migration to remote Supabase**

Use the Supabase MCP `apply_migration` tool with name `008_user_credits` and the SQL above. Project ref: `yhgtwqdsnrslcgdvmunz`.

- [ ] **Step 3: Verify**

Use `mcp__claude_ai_Supabase__list_tables` and confirm `user_credits` exists with the expected columns. Use `execute_sql` to `select column_name from information_schema.columns where table_name='registrations' and column_name='credits_applied'` — expect one row.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/008_user_credits.sql
git commit -m "feat(db): add user_credits ledger and registrations.credits_applied"
```

---

## Task 2: `credits.ts` helpers + tests

**Files:**
- Create: `worker/src/credits.ts`
- Create: `worker/src/credits.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `worker/src/credits.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { applyCreditsToTotal, getUserBalance } from './credits';

function fakeSupabaseWithBalance(rows: { amount: number }[]) {
  return {
    from: () => ({
      select: () => ({
        eq: () => Promise.resolve({ data: rows, error: null }),
      }),
    }),
  } as unknown as Parameters<typeof getUserBalance>[0];
}

describe('getUserBalance', () => {
  it('returns 0 when no rows', async () => {
    const sb = fakeSupabaseWithBalance([]);
    expect(await getUserBalance(sb, 'u1')).toBe(0);
  });

  it('sums positives and negatives', async () => {
    const sb = fakeSupabaseWithBalance([{ amount: 500 }, { amount: -200 }, { amount: 100 }]);
    expect(await getUserBalance(sb, 'u1')).toBe(400);
  });
});

describe('applyCreditsToTotal', () => {
  it('returns 0 when balance is 0', async () => {
    const sb = fakeSupabaseWithBalance([]);
    expect(await applyCreditsToTotal(sb, 'u1', 800)).toEqual({ creditsApplied: 0, finalAmount: 800 });
  });

  it('caps at totalAmount when balance exceeds it', async () => {
    const sb = fakeSupabaseWithBalance([{ amount: 1000 }]);
    expect(await applyCreditsToTotal(sb, 'u1', 300)).toEqual({ creditsApplied: 300, finalAmount: 0 });
  });

  it('caps at balance when total exceeds it', async () => {
    const sb = fakeSupabaseWithBalance([{ amount: 200 }]);
    expect(await applyCreditsToTotal(sb, 'u1', 800)).toEqual({ creditsApplied: 200, finalAmount: 600 });
  });

  it('floors negative balance to 0 applied', async () => {
    const sb = fakeSupabaseWithBalance([{ amount: -50 }]);
    expect(await applyCreditsToTotal(sb, 'u1', 800)).toEqual({ creditsApplied: 0, finalAmount: 800 });
  });
});
```

- [ ] **Step 2: Run tests, expect failure**

```bash
cd worker && npm test -- credits.test.ts
```

Expected: fails with module-not-found for `./credits`.

- [ ] **Step 3: Implement `credits.ts`**

Create `worker/src/credits.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js';

export type CreditReason =
  | 'cancellation'
  | 'cancellation_reversal'
  | 'registration_use'
  | 'guild_use'
  | 'admin_adjustment';

export interface CreditEvent {
  user_id: string;
  amount: number;
  reason: CreditReason;
  registration_id?: string | null;
  guild_member_id?: string | null;
  note?: string | null;
  created_by?: string | null;
}

export async function getUserBalance(supabase: SupabaseClient, userId: string): Promise<number> {
  const { data, error } = await supabase
    .from('user_credits')
    .select('amount')
    .eq('user_id', userId);
  if (error || !data) return 0;
  return data.reduce((sum: number, r: { amount: number }) => sum + r.amount, 0);
}

export async function recordCreditEvent(
  supabase: SupabaseClient,
  event: CreditEvent,
): Promise<void> {
  const row = {
    user_id: event.user_id,
    amount: event.amount,
    reason: event.reason,
    registration_id: event.registration_id ?? null,
    guild_member_id: event.guild_member_id ?? null,
    note: event.note ?? null,
    created_by: event.created_by ?? null,
  };
  const { error } = await supabase.from('user_credits').insert(row);
  if (error) {
    console.error('[credits] insert failed', error);
    throw error;
  }
}

export async function applyCreditsToTotal(
  supabase: SupabaseClient,
  userId: string,
  totalAmount: number,
): Promise<{ creditsApplied: number; finalAmount: number }> {
  if (totalAmount <= 0) return { creditsApplied: 0, finalAmount: totalAmount };
  const balance = await getUserBalance(supabase, userId);
  const applied = Math.max(0, Math.min(balance, totalAmount));
  return { creditsApplied: applied, finalAmount: totalAmount - applied };
}
```

- [ ] **Step 4: Run tests, expect pass**

```bash
cd worker && npm test -- credits.test.ts
```

Expected: 5 passing tests.

- [ ] **Step 5: Commit**

```bash
git add worker/src/credits.ts worker/src/credits.test.ts
git commit -m "feat(worker): add user credits ledger helpers"
```

---

## Task 3: Apply credits in public registration

**Files:**
- Modify: `worker/src/register.ts` (around the registration insert at line 188)

- [ ] **Step 1: Edit `register.ts` — import helpers**

At the top with other imports, add:

```ts
import { applyCreditsToTotal, recordCreditEvent } from './credits';
```

- [ ] **Step 2: Apply credits before insert**

Right after `totalAmount` is finalized (after the `if (member) { ... }` block that ends around line 185, before the registration insert):

```ts
  const { creditsApplied, finalAmount } = await applyCreditsToTotal(supabase, userId, totalAmount);
  totalAmount = finalAmount;
```

- [ ] **Step 3: Add `credits_applied` to the insert**

Update the `.insert({ ... })` payload (around line 188-203) to include:

```ts
      credits_applied: creditsApplied,
```

(Add it next to `plus_ones_consumed`.)

- [ ] **Step 4: Record ledger row after insert**

Right after `if (regError) return ...` returns and before `if (membershipIdToUpdate ...)`, add:

```ts
  if (creditsApplied > 0) {
    await recordCreditEvent(supabase, {
      user_id: userId,
      amount: -creditsApplied,
      reason: 'registration_use',
      registration_id: registration.id,
    });
  }
```

- [ ] **Step 5: Manual sanity check**

```bash
cd worker && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add worker/src/register.ts
git commit -m "feat(worker): auto-apply credits on public registration"
```

---

## Task 4: Apply credits in admin manual registration

**Files:**
- Modify: `worker/src/admin/register-manual.ts`

- [ ] **Step 1: Read the file**

Read `worker/src/admin/register-manual.ts` to locate where `total_amount` is computed and where the registration row is inserted. The structure mirrors `register.ts`.

- [ ] **Step 2: Apply same pattern as Task 3**

- Add `import { applyCreditsToTotal, recordCreditEvent } from '../credits';`
- Just before the registration `insert`, call `applyCreditsToTotal(supabase, userId, totalAmount)` and reassign `totalAmount`.
- Include `credits_applied: creditsApplied` in the insert payload.
- After the insert succeeds, if `creditsApplied > 0`, call `recordCreditEvent({ user_id: userId, amount: -creditsApplied, reason: 'registration_use', registration_id: registration.id })`.

- [ ] **Step 3: Update / add tests**

Open `worker/src/admin/register-manual.test.ts`. Add a test that pre-seeds a `+500` credit row for a user, then manually-registers them for an `800` event, and asserts:
- The inserted registration has `total_amount = 300` and `credits_applied = 500`.
- A new `user_credits` row exists with `amount = -500`, `reason = 'registration_use'`, `registration_id = <new id>`.

- [ ] **Step 4: Run tests**

```bash
cd worker && npm test -- register-manual.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add worker/src/admin/register-manual.ts worker/src/admin/register-manual.test.ts
git commit -m "feat(worker): auto-apply credits on admin manual registration"
```

---

## Task 5: Apply credits in guild purchase

**Files:**
- Modify: `worker/src/guild-purchase.ts`

- [ ] **Step 1: Read the file**

Read `worker/src/guild-purchase.ts`. Find where `total_amount` (or equivalent) is finalised and where the `guild_path_members` row is inserted.

- [ ] **Step 2: Apply credits**

- Add `import { applyCreditsToTotal, recordCreditEvent } from './credits';`
- Just before insert, call `applyCreditsToTotal(supabase, userId, totalAmount)` and overwrite the `amount` going into the row with `finalAmount`.
- After insert, if `creditsApplied > 0`, call `recordCreditEvent({ user_id: userId, amount: -creditsApplied, reason: 'guild_use', guild_member_id: member.id })`.

Note: `guild_path_members` does **not** get a `credits_applied` column. Cancelling a guild membership does not refund credits per the spec, so we don't need to track the applied amount on that row.

- [ ] **Step 3: Type-check**

```bash
cd worker && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add worker/src/guild-purchase.ts
git commit -m "feat(worker): auto-apply credits on guild membership purchase"
```

---

## Task 6: Cancel endpoint emits cancellation credit

**Files:**
- Modify: `worker/src/cancel.ts`

- [ ] **Step 1: Edit imports**

```ts
import { recordCreditEvent } from './credits';
```

- [ ] **Step 2: Extend the `select` and credit on cancel**

In `handleCancelRegistration`, change the `.select(...)` on line 14 to include `total_amount, credits_applied`:

```ts
    .select('id, user_id, payment_status, plus_ones_consumed, discount_applied, total_amount, credits_applied')
```

Then after the `update({ payment_status: 'cancelled' })` succeeds and before the plus-ones refund block, add:

```ts
  if (reg.payment_status === 'confirmed' && reg.user_id) {
    const refund = (reg.total_amount || 0) + (reg.credits_applied || 0);
    if (refund > 0) {
      await recordCreditEvent(supabase, {
        user_id: reg.user_id,
        amount: refund,
        reason: 'cancellation',
        registration_id: reg.id,
      });
    }
  }
```

(The plus-ones refund logic later already checks the same `confirmed`/`user_id` conditions implicitly — leave it untouched.)

- [ ] **Step 3: Add a test**

Open or create `worker/src/cancel.test.ts`. Add a test:
- Insert a user.
- Insert a confirmed registration with `total_amount=300`, `credits_applied=500`, `user_id=<u>`.
- Call `handleCancelRegistration` with that registration id.
- Assert: new `user_credits` row with `amount=800`, `reason='cancellation'`, `registration_id=<id>`.
- Assert: cancelling a `pending` registration does NOT insert a row.

If `cancel.test.ts` doesn't exist yet, mirror the style of `worker/src/admin/register-manual.test.ts` for Supabase mocking.

- [ ] **Step 4: Run tests**

```bash
cd worker && npm test -- cancel
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add worker/src/cancel.ts worker/src/cancel.test.ts
git commit -m "feat(worker): credit user on confirmed registration cancellation"
```

---

## Task 7: PATCH registration emits cancellation/reversal credit

**Files:**
- Modify: `worker/src/admin/registrations.ts`

- [ ] **Step 1: Edit imports**

```ts
import { getUserBalance, recordCreditEvent } from '../credits';
```

- [ ] **Step 2: Replace `handleUpdateRegistration` body**

Replace the existing implementation (lines 49-61) with:

```ts
export async function handleUpdateRegistration(id: string, request: Request, env: Env): Promise<Response> {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return jsonResponse({ error: 'Invalid request body' }, 400);
  const payload = pickRegFields(body);
  if (Object.keys(payload).length === 0) return jsonResponse({ error: 'No fields to update' }, 400);
  const err = validateRegPayload(payload);
  if (err) return jsonResponse({ error: err }, 400);

  const supabase = getSupabase(env);

  const { data: prior, error: priorError } = await supabase
    .from('registrations')
    .select('id, user_id, payment_status, total_amount, credits_applied')
    .eq('id', id)
    .maybeSingle();
  if (priorError) return jsonResponse({ error: 'Failed to load registration' }, 500);
  if (!prior) return jsonResponse({ error: 'Registration not found' }, 404);

  const newStatus = payload.payment_status as 'pending' | 'confirmed' | 'cancelled' | undefined;
  const transitioningToCancelled = newStatus === 'cancelled' && prior.payment_status === 'confirmed';
  const transitioningToConfirmed = newStatus === 'confirmed' && prior.payment_status === 'cancelled';
  const refundAmount = (prior.total_amount || 0) + (prior.credits_applied || 0);

  if (transitioningToConfirmed && prior.user_id && refundAmount > 0) {
    const balance = await getUserBalance(supabase, prior.user_id);
    if (balance < refundAmount) {
      return jsonResponse({
        error: `Cannot reverse — credits from this cancellation already spent (₹${refundAmount} needed, ₹${balance} available).`,
      }, 400);
    }
  }

  const { data, error } = await supabase
    .from('registrations')
    .update(payload)
    .eq('id', id)
    .select('*')
    .maybeSingle();
  if (error) return jsonResponse({ error: 'Failed to update registration' }, 500);
  if (!data) return jsonResponse({ error: 'Registration not found' }, 404);

  if (transitioningToCancelled && prior.user_id && refundAmount > 0) {
    await recordCreditEvent(supabase, {
      user_id: prior.user_id,
      amount: refundAmount,
      reason: 'cancellation',
      registration_id: id,
    });
  }
  if (transitioningToConfirmed && prior.user_id && refundAmount > 0) {
    await recordCreditEvent(supabase, {
      user_id: prior.user_id,
      amount: -refundAmount,
      reason: 'cancellation_reversal',
      registration_id: id,
    });
  }

  return jsonResponse({ registration: data });
}
```

- [ ] **Step 3: Add tests**

In `worker/src/admin/registrations.test.ts` (create if missing) add cases:
- confirmed → cancelled inserts `+refund` row, reason `cancellation`.
- cancelled → confirmed when balance sufficient inserts `−refund` row, reason `cancellation_reversal`.
- cancelled → confirmed when balance insufficient returns 400 and inserts no row.
- pending → cancelled inserts no row.

- [ ] **Step 4: Run tests**

```bash
cd worker && npm test -- admin/registrations
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add worker/src/admin/registrations.ts worker/src/admin/registrations.test.ts
git commit -m "feat(worker): emit credit events on registration status transitions"
```

---

## Task 8: `lookup-phone` returns credit balance

**Files:**
- Modify: `worker/src/lookup-phone.ts`

- [ ] **Step 1: Add import**

```ts
import { getUserBalance } from './credits';
```

- [ ] **Step 2: Compute balance and include in response**

After the `existingSeatsForEvent` block, before the final `return jsonResponse(...)`:

```ts
  let creditBalance = 0;
  if (user) {
    creditBalance = await getUserBalance(supabase, user.id);
  }
```

Then in the response object, add `credit_balance: creditBalance` at the top level (sibling of `existing_seats_for_event`).

- [ ] **Step 3: Type-check**

```bash
cd worker && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add worker/src/lookup-phone.ts
git commit -m "feat(worker): include credit_balance in lookup-phone response"
```

---

## Task 9: Admin users list + ledger + adjustment endpoints

**Files:**
- Modify: `worker/src/admin/users.ts`
- Modify: `worker/src/index.ts`

- [ ] **Step 1: Extend `users.ts`**

Replace the file contents with:

```ts
import type { Env } from '../index';
import { getSupabase } from '../supabase';
import { sanitizePhone, sanitizeEmail, sanitizeName, jsonResponse } from '../validation';
import { getUserBalance, recordCreditEvent } from '../credits';

export async function handleListUsers(url: URL, env: Env): Promise<Response> {
  const supabase = getSupabase(env);
  const q = (url.searchParams.get('q') || '').trim();
  const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get('limit') || '50', 10)));
  const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10));

  let query = supabase
    .from('users')
    .select('*')
    .order('last_registered_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (q) {
    const like = `%${q.replace(/[%_]/g, (m) => '\\' + m)}%`;
    query = query.or(`phone.ilike.${like},name.ilike.${like},email.ilike.${like}`);
  }

  const { data: users, error } = await query;
  if (error) return jsonResponse({ error: 'Failed to load users' }, 500);

  const ids = (users || []).map((u) => u.id);
  let balances = new Map<string, number>();
  if (ids.length > 0) {
    const { data: rows } = await supabase
      .from('user_credits')
      .select('user_id, amount')
      .in('user_id', ids);
    for (const r of rows || []) {
      balances.set(r.user_id, (balances.get(r.user_id) || 0) + r.amount);
    }
  }

  const out = (users || []).map((u) => ({ ...u, credit_balance: balances.get(u.id) || 0 }));
  return jsonResponse({ users: out });
}

export async function handleGetUser(id: string, env: Env): Promise<Response> {
  const supabase = getSupabase(env);
  const { data, error } = await supabase.from('users').select('*').eq('id', id).maybeSingle();
  if (error) return jsonResponse({ error: 'Failed to load user' }, 500);
  if (!data) return jsonResponse({ error: 'User not found' }, 404);

  const { data: ledger } = await supabase
    .from('user_credits')
    .select('*')
    .eq('user_id', id)
    .order('created_at', { ascending: false })
    .limit(100);

  const credit_balance = (ledger || []).reduce((s: number, r: { amount: number }) => s + r.amount, 0);
  return jsonResponse({ user: data, credit_balance, credits: ledger || [] });
}

export async function handleUpdateUser(id: string, request: Request, env: Env): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { name?: string; phone?: string; email?: string } | null;
  if (!body) return jsonResponse({ error: 'Invalid request body' }, 400);

  const update: Record<string, unknown> = {};
  if ('name' in body) {
    const n = sanitizeName(body.name || '');
    if (!n) return jsonResponse({ error: 'Invalid name' }, 400);
    update.name = n;
  }
  if ('phone' in body) {
    const p = sanitizePhone(body.phone || '');
    if (!p) return jsonResponse({ error: 'Invalid phone number' }, 400);
    update.phone = p;
  }
  if ('email' in body) {
    if (body.email) {
      const e = sanitizeEmail(body.email);
      if (!e) return jsonResponse({ error: 'Invalid email' }, 400);
      update.email = e;
    } else {
      update.email = null;
    }
  }
  if (Object.keys(update).length === 0) return jsonResponse({ error: 'No fields to update' }, 400);

  const supabase = getSupabase(env);
  const { data, error } = await supabase.from('users').update(update).eq('id', id).select('*').maybeSingle();
  if (error) return jsonResponse({ error: 'Failed to update user' }, 500);
  if (!data) return jsonResponse({ error: 'User not found' }, 404);
  return jsonResponse({ user: data });
}

export async function handleAdjustUserCredits(
  id: string,
  request: Request,
  env: Env,
  adminEmail: string,
): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { amount?: number; note?: string } | null;
  if (!body) return jsonResponse({ error: 'Invalid request body' }, 400);
  const amount = Number(body.amount);
  if (!Number.isInteger(amount) || amount === 0) {
    return jsonResponse({ error: 'Amount must be a non-zero integer' }, 400);
  }
  const note = (body.note || '').trim();
  if (!note) return jsonResponse({ error: 'Note is required' }, 400);
  if (note.length > 500) return jsonResponse({ error: 'Note must be 500 characters or fewer' }, 400);

  const supabase = getSupabase(env);
  const { data: user, error: userError } = await supabase
    .from('users')
    .select('id')
    .eq('id', id)
    .maybeSingle();
  if (userError) return jsonResponse({ error: 'Failed to load user' }, 500);
  if (!user) return jsonResponse({ error: 'User not found' }, 404);

  await recordCreditEvent(supabase, {
    user_id: id,
    amount,
    reason: 'admin_adjustment',
    note,
    created_by: adminEmail,
  });

  const balance = await getUserBalance(supabase, id);
  return jsonResponse({ credit_balance: balance });
}
```

- [ ] **Step 2: Wire routes in `index.ts`**

In `worker/src/index.ts`, update the `import { handleGetUser, handleUpdateUser } from './admin/users';` line to:

```ts
import {
  handleGetUser,
  handleUpdateUser,
  handleListUsers,
  handleAdjustUserCredits,
} from './admin/users';
```

Then in the admin routing section, replace the existing single `users` block (currently the regex `^\/api\/admin\/users\/([^/]+)$`) with:

```ts
          if (!adminResponse && url.pathname === '/api/admin/users' && request.method === 'GET') {
            adminResponse = await handleListUsers(url, env);
          }

          if (!adminResponse) {
            const userCreditsMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)\/credits$/);
            if (userCreditsMatch && request.method === 'POST') {
              adminResponse = await handleAdjustUserCredits(userCreditsMatch[1], request, env, gate.admin.email);
            }
          }

          if (!adminResponse) {
            const userMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)$/);
            if (userMatch) {
              const userId = userMatch[1];
              if (request.method === 'GET') adminResponse = await handleGetUser(userId, env);
              else if (request.method === 'PATCH') adminResponse = await handleUpdateUser(userId, request, env);
              else adminResponse = new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
            }
          }
```

Order matters — the `/credits` regex must be tested before the catch-all `/users/:id`.

- [ ] **Step 3: Type-check**

```bash
cd worker && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add worker/src/admin/users.ts worker/src/index.ts
git commit -m "feat(worker): admin users list + credit ledger + manual adjustment"
```

---

## Task 10: Admin types

**Files:**
- Modify: `admin/src/lib/types.ts`

- [ ] **Step 1: Append to types.ts**

```ts
export type UserCreditReason =
  | 'cancellation'
  | 'cancellation_reversal'
  | 'registration_use'
  | 'guild_use'
  | 'admin_adjustment';

export interface UserCreditEntry {
  id: string;
  user_id: string;
  amount: number;
  reason: UserCreditReason;
  registration_id: string | null;
  guild_member_id: string | null;
  note: string | null;
  created_by: string | null;
  created_at: string;
}

export interface UserListItem extends User {
  credit_balance: number;
}

export interface UserDetail {
  user: User;
  credit_balance: number;
  credits: UserCreditEntry[];
}
```

Also extend `Registration` in the same file to include `credits_applied: number;`.

- [ ] **Step 2: Type-check**

```bash
cd admin && npx tsc -b --noEmit
```

If anywhere in admin code reads `reg.credits_applied` and the column was missing, this will surface; fix any compile errors caused by adding the field.

- [ ] **Step 3: Commit**

```bash
git add admin/src/lib/types.ts
git commit -m "feat(admin): add UserCreditEntry/UserListItem/UserDetail types"
```

---

## Task 11: Users list page

**Files:**
- Create: `admin/src/pages/UsersList.tsx`
- Create: `admin/src/pages/UsersList.test.tsx`

- [ ] **Step 1: Look at sibling for pattern**

Read `admin/src/pages/GuildList.tsx` to mirror layout (DataTable + MobileCardList + search + revalidate hook).

- [ ] **Step 2: Write `UsersList.tsx`**

Modeled on GuildList. Columns: Name (or "—"), Phone, Email, Credits (₹{n}), Last registered (RelativeDate). Server-side search via `?q=`. Row click → `navigate('/users/' + user.id)`. Use `fetchAdmin<{ users: UserListItem[] }>('/api/admin/users?q=' + encodeURIComponent(q))` and the existing `useRevalidate` hook.

```tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchAdmin, showApiError } from '@/lib/api';
import { useRevalidate } from '@/lib/revalidate';
import { DataTable, type Column } from '@/components/DataTable';
import { MobileCardList } from '@/components/MobileCardList';
import { RelativeDate } from '@/components/RelativeDate';
import { PhoneCell } from '@/components/PhoneCell';
import { Input } from '@/components/ui/input';
import type { UserListItem } from '@/lib/types';

export default function UsersList() {
  const [users, setUsers] = useState<UserListItem[]>([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const load = () => {
    setLoading(true);
    fetchAdmin<{ users: UserListItem[] }>(`/api/admin/users?q=${encodeURIComponent(q)}`)
      .then((r) => setUsers(r.users))
      .catch(showApiError)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  useRevalidate(load);

  const columns: Column<UserListItem>[] = [
    { header: 'Name', cell: (u) => u.name || '—' },
    { header: 'Phone', cell: (u) => <PhoneCell phone={u.phone} /> },
    { header: 'Email', cell: (u) => u.email || '—' },
    { header: 'Credits', cell: (u) => `₹${u.credit_balance}` },
    { header: 'Last registered', cell: (u) => <RelativeDate iso={u.last_registered_at} /> },
  ];

  return (
    <div className="space-y-3 p-4">
      <Input placeholder="Search name, phone, email" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="hidden md:block">
        <DataTable rows={users} columns={columns} onRowClick={(u) => navigate(`/users/${u.id}`)} loading={loading} />
      </div>
      <div className="md:hidden">
        <MobileCardList
          rows={users}
          onClick={(u) => navigate(`/users/${u.id}`)}
          renderTitle={(u) => u.name || u.phone}
          renderSubtitle={(u) => `${u.phone} · ₹${u.credit_balance} credit`}
          loading={loading}
        />
      </div>
    </div>
  );
}
```

If any prop names differ from sibling pages (`Column`, `DataTable` props, `MobileCardList` props), match the existing usage in `GuildList.tsx` exactly. Don't invent props.

- [ ] **Step 3: Write a smoke test**

```tsx
// admin/src/pages/UsersList.test.tsx
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import UsersList from './UsersList';

vi.mock('@/lib/api', () => ({
  fetchAdmin: vi.fn(async () => ({
    users: [
      { id: 'u1', phone: '+919999999999', name: 'Alice', email: 'a@x', source: null,
        first_registered_at: '2026-01-01T00:00:00Z', last_registered_at: '2026-04-01T00:00:00Z', credit_balance: 500 },
    ],
  })),
  showApiError: vi.fn(),
}));
vi.mock('@/lib/revalidate', () => ({ useRevalidate: () => {} }));

describe('UsersList', () => {
  it('shows users with balance', async () => {
    render(<MemoryRouter><UsersList /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());
    expect(screen.getByText(/₹500/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Run tests**

```bash
cd admin && npm test -- UsersList
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add admin/src/pages/UsersList.tsx admin/src/pages/UsersList.test.tsx
git commit -m "feat(admin): users list page"
```

---

## Task 12: Rebuild UserDrawer for `/users/:id`

**Files:**
- Modify: `admin/src/pages/UserDrawer.tsx`

The current drawer is hardcoded to `/guild/:id/user`. Refactor it to accept a `mode` prop OR detect the route, and to support displaying the credit balance + ledger and an inline adjust form. Easiest: parameterise on `useParams` — drawer is always at `/users/:id` when accessed from users list and at `/guild/:id/user` when accessed from guild flow.

- [ ] **Step 1: Replace the contents of `UserDrawer.tsx`**

Approach: take a `userId` either from `useParams().id` (when route is `/users/:id`) or via the existing guild-member fetch path. We'll detect via the URL pattern.

```tsx
import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { FormDrawer } from '@/components/FormDrawer';
import { fetchAdmin, showApiError } from '@/lib/api';
import { validateUser, type ValidationErrors } from '@/lib/validation';
import { toast } from 'sonner';
import type { User, GuildMember, UserCreditEntry } from '@/lib/types';

export default function UserDrawer() {
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams();
  const isGuildContext = location.pathname.startsWith('/guild/');
  const guildMemberId = isGuildContext ? params.id : undefined;
  const directUserId = !isGuildContext ? params.id : undefined;

  const [user, setUser] = useState<User | null>(null);
  const [initial, setInitial] = useState<User | null>(null);
  const [creditBalance, setCreditBalance] = useState(0);
  const [credits, setCredits] = useState<UserCreditEntry[]>([]);
  const [saving, setSaving] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustAmount, setAdjustAmount] = useState('');
  const [adjustNote, setAdjustNote] = useState('');
  const [adjustSaving, setAdjustSaving] = useState(false);

  function loadUser(userId: string) {
    fetchAdmin<{ user: User; credit_balance: number; credits: UserCreditEntry[] }>(`/api/admin/users/${userId}`)
      .then((r) => {
        setUser(r.user);
        setInitial(r.user);
        setCreditBalance(r.credit_balance);
        setCredits(r.credits);
      })
      .catch(showApiError);
  }

  useEffect(() => {
    if (directUserId) {
      loadUser(directUserId);
    } else if (guildMemberId) {
      fetchAdmin<{ member: GuildMember }>(`/api/admin/guild-members/${guildMemberId}`)
        .then(({ member }) => loadUser(member.user_id))
        .catch(showApiError);
    }
  }, [guildMemberId, directUserId]);

  const errors: ValidationErrors = useMemo(() => {
    if (!user) return {};
    return validateUser({ name: user.name, phone: user.phone, email: user.email });
  }, [user]);
  const errorCount = Object.keys(errors).length;
  const dirty = useMemo(() => JSON.stringify(user) !== JSON.stringify(initial), [user, initial]);

  function close() {
    if (isGuildContext) navigate(`/guild/${guildMemberId}`);
    else navigate('/users');
  }

  async function save() {
    if (!user) return;
    setShowErrors(true);
    if (errorCount > 0) {
      const first = Object.keys(errors)[0];
      const el = document.getElementById(`field-${first}`);
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el?.focus();
      return;
    }
    setSaving(true);
    setServerError(null);
    try {
      await fetchAdmin(`/api/admin/users/${user.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: user.name || '', phone: user.phone, email: user.email }),
      });
      toast.success('User updated');
      close();
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setSaving(false);
    }
  }

  async function submitAdjust() {
    if (!user) return;
    const amt = Number(adjustAmount);
    if (!Number.isInteger(amt) || amt === 0) {
      toast.error('Enter a non-zero whole number');
      return;
    }
    if (!adjustNote.trim()) {
      toast.error('Add a note');
      return;
    }
    setAdjustSaving(true);
    try {
      await fetchAdmin(`/api/admin/users/${user.id}/credits`, {
        method: 'POST',
        body: JSON.stringify({ amount: amt, note: adjustNote.trim() }),
      });
      toast.success('Credits adjusted');
      setAdjustOpen(false);
      setAdjustAmount('');
      setAdjustNote('');
      loadUser(user.id);
    } catch (err) {
      showApiError(err);
    } finally {
      setAdjustSaving(false);
    }
  }

  function set<K extends keyof User>(k: K, v: User[K]) {
    setUser((x) => x ? { ...x, [k]: v } : x);
  }

  function field(key: string, label: string, control: React.ReactNode) {
    const err = showErrors ? errors[key] : undefined;
    return (
      <div id={`field-${key}`}>
        <Label className={err ? 'text-destructive' : undefined}>{label}</Label>
        {control}
        {err && <div className="text-xs text-destructive mt-1">{err}</div>}
      </div>
    );
  }

  return (
    <FormDrawer
      open
      title="Edit user"
      dirty={dirty}
      saving={saving}
      onCancel={close}
      onSave={save}
      errorCount={showErrors ? errorCount : 0}
      errorMessage={serverError}
    >
      {!user ? <p>Loading…</p> : (
        <div className="space-y-6">
          <div className="space-y-3">
            {field('name', 'Name', (
              <Input value={user.name || ''} onChange={(e) => set('name', e.target.value)} />
            ))}
            {field('phone', 'Phone', (
              <Input value={user.phone} onChange={(e) => set('phone', e.target.value)} />
            ))}
            {field('email', 'Email', (
              <Input value={user.email || ''} onChange={(e) => set('email', e.target.value || null)} />
            ))}
          </div>

          <div className="border-t pt-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm text-muted-foreground">Credit balance</div>
                <div className="text-2xl font-semibold">₹{creditBalance}</div>
              </div>
              <Button type="button" variant="outline" onClick={() => setAdjustOpen((v) => !v)}>
                {adjustOpen ? 'Cancel' : 'Adjust credits'}
              </Button>
            </div>

            {adjustOpen && (
              <div className="space-y-2 rounded border p-3">
                <Label>Amount (signed integer; negative deducts)</Label>
                <Input
                  type="number"
                  value={adjustAmount}
                  onChange={(e) => setAdjustAmount(e.target.value)}
                  placeholder="e.g. 200 or -100"
                />
                <Label>Note</Label>
                <Textarea value={adjustNote} onChange={(e) => setAdjustNote(e.target.value)} maxLength={500} />
                <Button type="button" onClick={submitAdjust} disabled={adjustSaving}>
                  {adjustSaving ? 'Saving…' : 'Save adjustment'}
                </Button>
              </div>
            )}

            <div className="space-y-1">
              <div className="text-sm font-medium">Credit history</div>
              {credits.length === 0 ? (
                <div className="text-sm text-muted-foreground">No credit activity yet.</div>
              ) : (
                <ul className="text-sm divide-y">
                  {credits.map((c) => (
                    <li key={c.id} className="py-2 flex justify-between gap-4">
                      <div>
                        <div className={c.amount >= 0 ? 'text-emerald-600' : 'text-destructive'}>
                          {c.amount >= 0 ? '+' : ''}₹{c.amount}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {c.reason}{c.note ? ` · ${c.note}` : ''}{c.created_by ? ` · ${c.created_by}` : ''}
                        </div>
                      </div>
                      <div className="text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(c.created_at).toLocaleDateString()}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </FormDrawer>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
cd admin && npx tsc -b --noEmit
```

If `Textarea` import path differs, check `admin/src/components/ui/` — adjust the import to match what exists. If no Textarea component exists, substitute `<textarea className="w-full border rounded p-2 text-sm" rows={3} ... />`.

- [ ] **Step 3: Commit**

```bash
git add admin/src/pages/UserDrawer.tsx
git commit -m "feat(admin): user drawer shows credit balance, ledger, and adjust form"
```

---

## Task 13: Wire users routes + sidebar entry

**Files:**
- Modify: `admin/src/App.tsx`
- Modify: `admin/src/components/Sidebar.tsx`
- Modify: `admin/src/components/BottomTabBar.tsx`

- [ ] **Step 1: Update `App.tsx`**

Add after the guild routes block:

```tsx
import UsersList from './pages/UsersList';
```

```tsx
          <Route path="/users" element={<UsersList />} />
          <Route path="/users/:id" element={<><UsersList /><UserDrawer /></>} />
```

- [ ] **Step 2: Update `Sidebar.tsx` and `BottomTabBar.tsx`**

Read both files. They are list-driven nav. Add a "Users" entry pointing to `/users` with an appropriate icon (lucide `Users` or whatever the file already imports from lucide). Place it after Guild, before any settings/log entries.

- [ ] **Step 3: Type-check + run admin app**

```bash
cd admin && npx tsc -b --noEmit
cd admin && npm run dev
```

Manually open `http://localhost:5173/users` in the browser, confirm the list renders and clicking a row opens the drawer.

- [ ] **Step 4: Commit**

```bash
git add admin/src/App.tsx admin/src/components/Sidebar.tsx admin/src/components/BottomTabBar.tsx
git commit -m "feat(admin): wire users tab in nav and routes"
```

---

## Task 14: Status-change hint in RegistrationDrawer

**Files:**
- Modify: `admin/src/pages/RegistrationDrawer.tsx`

- [ ] **Step 1: Read the file**

Locate the `payment_status` selector. Identify how the current registration object (`reg`) is in scope and how `user_id` / `total_amount` / `credits_applied` are available.

- [ ] **Step 2: Fetch user balance when needed**

When the drawer loads, also fetch the user's balance if `reg.user_id` is set:

```tsx
const [userBalance, setUserBalance] = useState<number | null>(null);
useEffect(() => {
  if (!reg?.user_id) { setUserBalance(null); return; }
  fetchAdmin<{ credit_balance: number }>(`/api/admin/users/${reg.user_id}`)
    .then((r) => setUserBalance(r.credit_balance))
    .catch(() => setUserBalance(null));
}, [reg?.user_id]);
```

- [ ] **Step 3: Render hint near status selector**

Below the status selector:

```tsx
{(() => {
  if (!reg) return null;
  const refund = (reg.total_amount || 0) + (reg.credits_applied || 0);
  if (statusDraft === 'cancelled' && reg.payment_status === 'confirmed' && refund > 0) {
    return <p className="text-xs text-muted-foreground">Cancelling will add ₹{refund} to {reg.name}'s credits.</p>;
  }
  if (statusDraft === 'confirmed' && reg.payment_status === 'cancelled' && refund > 0) {
    if (userBalance !== null && userBalance < refund) {
      return <p className="text-xs text-destructive">Cannot reverse — needs ₹{refund} credit, user has ₹{userBalance}.</p>;
    }
    return <p className="text-xs text-muted-foreground">Reversing will deduct ₹{refund} from credits (user has ₹{userBalance ?? '?'}).</p>;
  }
  return null;
})()}
```

(Replace `statusDraft` with whatever local draft variable the file already uses for the status selector value before save.)

If the drawer doesn't already separate "draft" status from saved, introduce a `statusDraft` state initialized from `reg.payment_status`, used by the selector, and read at save time.

- [ ] **Step 4: Manual test**

Start admin dev (`cd admin && npm run dev`). Open a confirmed registration; flip status to cancelled — hint should show the correct ₹ amount. Flip a cancelled registration to confirmed — hint should show balance check.

- [ ] **Step 5: Commit**

```bash
git add admin/src/pages/RegistrationDrawer.tsx
git commit -m "feat(admin): show credit impact hint on registration status change"
```

---

## Task 15: Manual registration drawer summary

**Files:**
- Modify: `admin/src/pages/ManualRegistrationDrawer.tsx`

- [ ] **Step 1: Read the file**

Find the existing summary/totals block (where amount is displayed before submit) and where the phone lookup result is stored.

- [ ] **Step 2: Surface credit balance and applied amount**

After phone lookup populates the form, also store `credit_balance` from the lookup response (`/api/lookup-phone` is the same endpoint used by the public form, now returning `credit_balance`). In the summary block, render:

```tsx
{creditBalance > 0 && total > 0 && (
  <>
    <div className="flex justify-between text-sm">
      <span>Credits available</span><span>₹{creditBalance}</span>
    </div>
    <div className="flex justify-between text-sm">
      <span>Credits applied</span><span>−₹{Math.min(creditBalance, total)}</span>
    </div>
    <div className="flex justify-between font-medium">
      <span>Total payable</span><span>₹{Math.max(0, total - creditBalance)}</span>
    </div>
  </>
)}
```

(Match exact JSX style and class names from the existing summary in the file — this is illustrative.)

- [ ] **Step 3: Commit**

```bash
git add admin/src/pages/ManualRegistrationDrawer.tsx
git commit -m "feat(admin): show credit application in manual registration summary"
```

---

## Task 16: Public RegistrationForm credit summary

**Files:**
- Modify: `src/components/RegistrationForm.tsx`

- [ ] **Step 1: Read the file**

Find the section that currently renders the order summary (after phone lookup, before submit). Identify how lookup-phone response data flows into state.

- [ ] **Step 2: Capture and apply `credit_balance`**

When the lookup response arrives, store `credit_balance` (default 0). In the order summary, between the gross subtotal line and the final total line, render the same pattern as Task 15 but with the public site's existing summary classnames.

- [ ] **Step 3: Manual test**

Start `npm run dev` (Astro on :4321) and `cd worker && npm run dev` (Worker on :8787). Manually:
1. Seed a test user with a credit (via admin app's adjust form, after Tasks 12-13 are deployed locally).
2. Visit `/register` on the dev site, enter that user's phone, verify the form shows credit available and applies it.
3. Submit and verify the registration's `total_amount` reflects the deducted amount and a `user_credits` row of `-applied` exists.

- [ ] **Step 4: Commit**

```bash
git add src/components/RegistrationForm.tsx
git commit -m "feat(site): apply user credits to event registration total"
```

---

## Task 17: Public guild purchase credit summary

**Files:**
- Modify: `src/components/PaymentSheet.tsx` (or whichever component drives guild purchase summary)

- [ ] **Step 1: Locate guild purchase summary**

```bash
grep -rn "guild-purchase" src/components | head
```

Find the component that renders the totals for the guild membership flow.

- [ ] **Step 2: Apply credits in summary**

If the same `lookup-phone` call is made (or a similar lookup), surface `credit_balance` and apply min(balance, total) the same way as Task 16. The Worker already deducts credits server-side; this is purely display.

- [ ] **Step 3: Commit**

```bash
git add src/components/PaymentSheet.tsx
git commit -m "feat(site): apply user credits to guild membership total"
```

---

## Task 18: Manual end-to-end smoke + deploy

- [ ] **Step 1: Run all worker tests**

```bash
cd worker && npm test
```

All passing.

- [ ] **Step 2: Run all admin tests**

```bash
cd admin && npm test
```

All passing.

- [ ] **Step 3: End-to-end smoke (local)**

With both dev servers running:
1. Register a new phone via the public form. Confirm it goes through normally (no credit pre-existing → no credit row).
2. From admin, change that registration from confirmed → cancelled. Confirm the user's drawer now shows a `+₹X` cancellation row and the balance reflects it.
3. Re-register the same phone for another event. Confirm the form shows credits available + applied; submitted registration has reduced `total_amount` and a `−₹X registration_use` row.
4. From admin, manually adjust the user's credits with a note. Confirm new ledger row with admin email.
5. Try reversing a cancellation where balance is now lower than refund — confirm the API returns the 400 with the readable message.

- [ ] **Step 4: Deploy worker**

```bash
cd worker && npx wrangler deploy
```

- [ ] **Step 5: Push site**

```bash
git push origin main
```

Cloudflare Pages auto-deploys.

- [ ] **Step 6: Production smoke**

Repeat step 3's flows on the live site with a throwaway phone number; verify behavior.

---

## Self-review notes

- All five spec sections (data model, logic, API additions, frontend changes, tests) are covered: schema in Task 1; helpers in Task 2; registration application in Tasks 3-5; cancel/reversal in Tasks 6-7; lookup-phone in Task 8; admin endpoints in Task 9; admin frontend in Tasks 10-15; public site in Tasks 16-17; tests are inline; deploy in Task 18.
- No "TBD" / "TODO" / "implement later" placeholders.
- Function names align across tasks: `getUserBalance`, `recordCreditEvent`, `applyCreditsToTotal`, `handleListUsers`, `handleAdjustUserCredits`.
- `credits_applied` is added to the registrations table in Task 1, written to in Tasks 3-4, and read back in Tasks 6-7 and 14.
