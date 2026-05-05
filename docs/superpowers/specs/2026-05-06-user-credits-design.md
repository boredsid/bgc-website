# User Credits — Design Spec

**Date:** 2026-05-06
**Scope:** Admin app, Worker API, public registration flow, Supabase schema

## Goal

Introduce a user-level credit balance. When a confirmed registration is cancelled, the amount paid (cash + any credit previously consumed) is added to the user's credit balance. Credits auto-apply against future event registrations and guild membership purchases. Admins can view, edit, and manually adjust user data and credit balances from a new Users tab.

## Non-goals

- Cancellation of guild memberships does **not** generate credits.
- No expiry, refund-to-cash, or transfer of credits between users.
- No public-facing "credits dashboard" — credits surface in registration summaries only.

## Data model

### Table `user_credits` (new, immutable ledger)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `user_id` | uuid not null, fk users.id on delete cascade | |
| `amount` | int not null | Positive = credit added, negative = credit consumed |
| `reason` | text not null | One of: `cancellation`, `cancellation_reversal`, `registration_use`, `guild_use`, `admin_adjustment` |
| `registration_id` | uuid null, fk registrations.id on delete set null | Set for `cancellation`, `cancellation_reversal`, `registration_use` |
| `guild_member_id` | uuid null, fk guild_path_members.id on delete set null | Set for `guild_use` |
| `note` | text null | Admin note for `admin_adjustment` |
| `created_by` | text null | Admin email for admin-initiated rows |
| `created_at` | timestamptz not null default now() | |

Indexes: `user_id`, `registration_id` (partial where not null).

RLS: enabled, no public policies. Worker-only (service-role).

**Balance derivation:** `select coalesce(sum(amount), 0) from user_credits where user_id = $1`. There is no balance column to keep in sync — the ledger is the source of truth.

### Column added to `registrations`

| Column | Type | Notes |
|---|---|---|
| `credits_applied` | int not null default 0 | Credits consumed at registration time. `total_amount` continues to store the **cash** charged after credit deduction. |

### Migration `008_user_credits.sql`

Creates `user_credits` with constraints, indexes, RLS. Adds `credits_applied` column to `registrations`.

## Logic

### Helper module `worker/src/credits.ts`

```
getUserBalance(supabase, userId): Promise<number>
  → sum(amount) where user_id = userId

recordCreditEvent(supabase, {
  user_id, amount, reason, registration_id?, guild_member_id?, note?, created_by?
}): Promise<void>

applyCreditsToTotal(supabase, userId, totalAmount):
  Promise<{ creditsApplied: number; finalAmount: number }>
  → balance = getUserBalance(userId)
  → applied = max(0, min(balance, totalAmount))
  → returns { creditsApplied: applied, finalAmount: totalAmount - applied }
  → does NOT insert; caller inserts after writing the registration so the ledger row can reference the new id
```

### Registration write paths

In `register.ts` (public), `admin/register-manual.ts`, and `guild-purchase.ts`:

1. Compute `total_amount` as today (with all existing discount logic intact).
2. If a `user_id` is known/upserted:
   - `{ creditsApplied, finalAmount } = applyCreditsToTotal(user_id, total_amount)`
   - Insert the registration / guild membership with `total_amount = finalAmount` and (registrations only) `credits_applied = creditsApplied`.
   - If `creditsApplied > 0`, insert a ledger row `−creditsApplied`, reason `registration_use` (or `guild_use` for guild purchases), with the new row's id in the appropriate FK column.
3. If `total_amount` reaches 0 after credits, the registration is still inserted with status `pending` (or whatever the existing flow returns) — payment processing logic is unchanged outside total computation.

### Cancellation transitions

A "cancellation event" is **either**:
- `POST /api/admin/cancel-registration` (existing dedicated endpoint), **or**
- `PATCH /api/admin/registrations/:id` where `payment_status` flips to `cancelled`.

For both paths, after successfully writing `payment_status = cancelled`:

- If the **previous** status was `confirmed`, insert a ledger row `+(total_amount + credits_applied)`, reason `cancellation`, registration_id = id.
- If the previous status was `pending`, do nothing (no money or credit moved at registration time).
- If already `cancelled`, no-op (matches today's `already_cancelled` short-circuit).

### Reversal (cancelled → confirmed)

Only via `PATCH /api/admin/registrations/:id` with `payment_status: 'confirmed'` when current status is `cancelled`.

1. Compute `amount = total_amount + credits_applied`.
2. If `amount > 0`:
   - `balance = getUserBalance(user_id)`
   - If `balance < amount`, return 400 with message: `"Cannot reverse — credits from this cancellation have already been spent (₹{amount} needed, ₹{balance} available)."`
   - Otherwise insert ledger row `−amount`, reason `cancellation_reversal`, registration_id = id.
3. Update the registration to `confirmed`.

If `user_id` is null on the registration (legacy rows), skip credit refund entirely on both cancel and reverse — no row to credit.

### Manual admin adjustment

`POST /api/admin/users/:id/credits` body `{ amount: int, note: string }`:

- `amount` may be positive or negative.
- `note` required, ≤ 500 chars.
- Resulting balance may go negative if admin debits more than current balance — admin-initiated, no balance check.
- Insert ledger row with reason `admin_adjustment`, note, `created_by = gate.admin.email`.

## Worker API additions

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/admin/users?q=&limit=&offset=` | Paginated user list with `credit_balance` join. Search across phone, name, email. |
| GET | `/api/admin/users/:id` | Existing — extend to include `credit_balance` and `credits` (ledger array, newest first, capped at 100). |
| PATCH | `/api/admin/users/:id` | Existing — unchanged. |
| POST | `/api/admin/users/:id/credits` | Manual adjustment. Body `{ amount, note }`. Returns updated balance. |

Public `POST /api/lookup-phone` response gains `credit_balance: number` (0 if user not found).

## Frontend changes

### Public site

**`src/components/RegistrationForm.tsx`:**
- After phone lookup, store `credit_balance` from response.
- In the totals/summary section, between subtotal and final total: render a row "Credits applied −₹{min(balance, subtotal)}" when balance > 0.
- Final total = subtotal − applied credits. If 0, button text reads "Confirm registration" (no payment step).

**`src/components/PaymentSheet.tsx` (guild purchase) and any guild purchase UI:**
- Same treatment — show credits applied row in the order summary.

The client computes credits-applied for display only; the worker re-derives authoritatively.

### Admin app

**Routes (App.tsx):**
- `/users` → `UsersList`
- `/users/:id` → `UsersList` + `UserDrawer` (refactored to be a top-level users drawer; keep existing guild-side drawer entry working by routing `/guild/:id/user` through the same component or extracting shared form parts).

**Sidebar / BottomTabBar:** add "Users" entry between "Guild" and any later tab.

**`pages/UsersList.tsx` (new):**
- DataTable / MobileCardList with columns: Name, Phone, Email, Credits (₹), Last registered.
- Search input (server-side `?q=`).
- Row click navigates to `/users/:id`.

**`pages/UserDrawer.tsx` (refactor):**
- Sections:
  1. **Edit** — name, phone, email, source (existing).
  2. **Credits** — large balance number; "Adjust credits" button opens a small inline form: signed amount input + note textarea + Save button.
  3. **Credit history** — chronological list (newest first) of ledger entries: `+₹500 cancellation · {registration link or id} · 2026-05-01`, `−₹300 registration_use · …`, `+₹200 admin_adjustment · "goodwill" · {admin email}`. Each row links to the related registration where applicable.

**`pages/RegistrationDrawer.tsx`:**
- When admin changes `payment_status` selector, show inline hint:
  - From confirmed → cancelled: `"Will add ₹{total_amount + credits_applied} to {user name}'s credits."`
  - From cancelled → confirmed: `"Will deduct ₹{amount} credits. User has ₹{balance}."` Disable Save if balance insufficient and surface the same error from the API.

**`pages/ManualRegistrationDrawer.tsx`:**
- After phone lookup, show "Credits available: ₹X" and "Credits applied: −₹Y" in the summary.

### Types (admin/src/lib/types.ts)

Add:

```ts
export interface UserCreditEntry {
  id: string;
  amount: number;
  reason: 'cancellation' | 'cancellation_reversal' | 'registration_use' | 'guild_use' | 'admin_adjustment';
  registration_id: string | null;
  guild_member_id: string | null;
  note: string | null;
  created_by: string | null;
  created_at: string;
}

export interface UserWithCredits extends User {
  credit_balance: number;
  credits: UserCreditEntry[];
}
```

Update `User` consumers as needed.

## Validation & edge cases

- `amount` must be integer (rupees, no paise). Validated in helper + endpoint.
- Reversal blocked when balance insufficient — surfaces clearly to admin.
- Concurrent cancel + adjust: ledger is append-only, balance recomputes from sum, so there's no lost-update window for balance itself. Reversal balance check is best-effort (read-then-insert); a tightly concurrent spend could in theory push balance negative, but volume is low and admin can correct via manual adjustment.
- If `users.id` is missing on a registration (legacy rows pre-`003_registrations_user_id`), credit logic is skipped silently.
- Users with `credit_balance = 0` and no ledger entries appear in the Users list (it lists all users, not just those with credits).

## Tests

Worker (vitest):
- `credits.test.ts`: `getUserBalance` over mixed positives/negatives; `applyCreditsToTotal` clamps at 0 and at totalAmount.
- `registrations.test.ts`: cancel from confirmed inserts `cancellation` row of correct size; cancel from pending does not; double-cancel is no-op.
- `registrations.test.ts`: reversal inserts `cancellation_reversal`; insufficient balance returns 400.
- `register-manual.test.ts` and `register.test.ts`: registering with available credits inserts `registration_use` row and stores `credits_applied`; final `total_amount` reflects deduction.
- `users.test.ts`: list with `q` filter; manual adjustment inserts row with admin email.

Admin app (vitest + Testing Library):
- `UsersList.test.tsx`: renders rows, filters by search.
- `UserDrawer.test.tsx`: shows balance, ledger entries, opens adjust form, calls POST.
- `RegistrationDrawer.test.tsx`: shows correct hint on status change.

## Build sequence

1. Migration 008 + types.
2. `worker/src/credits.ts` + tests.
3. Wire into cancel paths (dedicated endpoint + PATCH) + tests.
4. Wire into register paths + tests.
5. Extend `lookup-phone` response.
6. Extend `admin/users.ts` for list + ledger + adjustment + tests.
7. Admin frontend: types, UsersList, UserDrawer refactor, sidebar entry.
8. Admin frontend: status-change hints in RegistrationDrawer, summary line in ManualRegistrationDrawer.
9. Public site: credits in RegistrationForm + guild purchase summary.
10. Manual smoke test on local Worker + admin dev server.
11. Deploy worker, push site, verify.
