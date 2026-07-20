# MCP Duplicate-Registration Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `register_for_event` refuses to book a second spot for an event the phone already holds a registration for, until the call carries `confirm_additional: true`.

**Architecture:** A best-effort pre-check inside the MCP tool (`worker/src/mcp/write-tools.ts`) — one Supabase query on `registrations` by event + phone, wrapped in try/catch so a failed check never blocks a valid registration. Returns a structured `requires_confirmation` result (not a `ToolError`). No changes to `/api/register`, the site, or admin flows.

**Tech Stack:** TypeScript, Cloudflare Workers, Vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-20-mcp-duplicate-guard-design.md`

## Global Constraints

- MCP only: touch `worker/src/mcp/write-tools.ts`, `worker/src/mcp/write-tools.test.ts`, and one instructions line in `worker/src/mcp/protocol.ts`. Nothing else.
- Pre-check failure (query error or throw) → proceed without the guard. Never block registration on the pre-check.
- The unconfirmed-duplicate response is a structured non-error result: `{ registered: false, requires_confirmation: true, existing_seats: <n>, message: ... }` — not `ToolError`, not `isError`.
- `confirm_additional` must NOT be forwarded to `handleRegister` (the API body shape is unchanged).
- Phone sanitized with `sanitizePhone` from `worker/src/validation.ts`; invalid phone skips the pre-check (wrapped handler rejects it).
- Existing seats = sum of `seats` on rows where `event_id` matches, `phone` matches, `payment_status != 'cancelled'`.
- `join_waitlist` and `join_guild_path` unchanged.
- `cd worker && npm test` fully green before every commit. Branch: `feat/mcp-duplicate-guard`.

---

### Task 1: Confirmation guard in register_for_event

**Files:**
- Modify: `worker/src/mcp/write-tools.ts`
- Modify: `worker/src/mcp/protocol.ts` (INSTRUCTIONS constant only)
- Test: `worker/src/mcp/write-tools.test.ts`

**Interfaces:**
- Consumes: `sanitizePhone(phone: string): string | null` from `../validation`; `getSupabase(env)` from `../supabase`; existing `handleRegister` mock pattern in the test file.
- Produces: `register_for_event` accepts optional `confirm_additional: boolean`; unconfirmed duplicates return `{ registered: false, requires_confirmation: true, existing_seats, message }`.

**Compatibility note for the implementer:** the existing register tests mock Supabase with a chain that only supports `select().eq().single()`. The pre-check uses a different chain (`select('seats').eq().eq().neq()`), which would throw a TypeError against those old mocks — but the pre-check's try/catch treats any throw as "no existing seats, proceed", so the existing tests pass **unchanged**. Do not modify the existing tests; only add the new describe block and its helper.

- [ ] **Step 1: Create branch**

```bash
git checkout -b feat/mcp-duplicate-guard
```

- [ ] **Step 2: Write the failing tests**

Append to `worker/src/mcp/write-tools.test.ts` (inside the file, after the existing `register_for_event` describe block — it reuses the top-level `env`, `ctx`, `tool`, `jsonRes` helpers and the existing `vi.mock` setup):

```ts
describe('register_for_event duplicate guard', () => {
  const args = {
    event_id: 'E1', name: 'Asha', phone: '9876543210', email: 'a@b.com',
    seats: 1, custom_answers: {},
  };

  // Table/column-aware mock: the pre-check chain (select('seats').eq().eq().neq())
  // resolves `precheck`; the post-success by-id chain resolves `regRow`.
  function mockRegisterSupabase(opts: { precheck?: unknown; precheckThrows?: boolean; regRow?: unknown }) {
    (getSupabase as any).mockReturnValue({
      from: (table: string) => ({
        select: (cols: string) => {
          if (table === 'registrations' && cols === 'seats') {
            return { eq: () => ({ eq: () => ({ neq: async () => {
              if (opts.precheckThrows) throw new Error('precheck boom');
              return opts.precheck ?? { data: [], error: null };
            } }) }) };
          }
          return { eq: () => ({ single: async () => ({ data: opts.regRow ?? null }) }) };
        },
      }),
    });
  }

  const regRow = {
    total_amount: 500, discount_applied: null, credits_applied: 0, seats: 1,
    events: { name: 'Catan Night' },
  };

  it('asks for confirmation instead of registering when the phone already has seats', async () => {
    mockRegisterSupabase({ precheck: { data: [{ seats: 2 }, { seats: 1 }], error: null } });

    const out = await tool('register_for_event').handler(args, env, ctx) as any;

    expect(out.registered).toBe(false);
    expect(out.requires_confirmation).toBe(true);
    expect(out.existing_seats).toBe(3);
    expect(out.message).toMatch(/already has 3 seat/);
    expect(out.message).toMatch(/confirm_additional/);
    expect(handleRegister).not.toHaveBeenCalled();
  });

  it('proceeds when confirm_additional is true and does not forward the flag', async () => {
    mockRegisterSupabase({ precheck: { data: [{ seats: 1 }], error: null }, regRow });
    (handleRegister as any).mockResolvedValue(jsonRes({ success: true, registration_id: 'R1' }));

    const out = await tool('register_for_event').handler({ ...args, confirm_additional: true }, env, ctx) as any;

    expect(out.registered).toBe(true);
    const forwarded = await ((handleRegister as any).mock.calls[0][0] as Request).json();
    expect(forwarded).not.toHaveProperty('confirm_additional');
    expect(forwarded.source).toBe('mcp');
  });

  it('proceeds without the flag when there is no existing registration', async () => {
    mockRegisterSupabase({ precheck: { data: [], error: null }, regRow });
    (handleRegister as any).mockResolvedValue(jsonRes({ success: true, registration_id: 'R1' }));

    const out = await tool('register_for_event').handler(args, env, ctx) as any;
    expect(out.registered).toBe(true);
    expect(handleRegister).toHaveBeenCalledTimes(1);
  });

  it('proceeds when the pre-check itself fails (best-effort guard)', async () => {
    mockRegisterSupabase({ precheckThrows: true, regRow });
    (handleRegister as any).mockResolvedValue(jsonRes({ success: true, registration_id: 'R1' }));

    const out = await tool('register_for_event').handler(args, env, ctx) as any;
    expect(out.registered).toBe(true);
    expect(handleRegister).toHaveBeenCalledTimes(1);
  });

  it('skips the pre-check for an invalid phone and lets the handler reject it', async () => {
    mockRegisterSupabase({ precheck: { data: [{ seats: 1 }], error: null } });
    (handleRegister as any).mockResolvedValue(jsonRes({ error: 'Invalid phone number' }, 400));

    await expect(tool('register_for_event').handler({ ...args, phone: '12345' }, env, ctx))
      .rejects.toThrow('Invalid phone number');
    expect(handleRegister).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 3: Run tests to verify the new block fails**

Run: `cd worker && npx vitest run src/mcp/write-tools.test.ts`
Expected: the 5 new tests FAIL (first one: `registered` is `true` / `handleRegister` was called); the existing 12 still pass.

- [ ] **Step 4: Implement the guard in write-tools.ts**

In `worker/src/mcp/write-tools.ts`:

Add to the imports:

```ts
import { sanitizePhone } from '../validation';
```

Add below the `upiPayment` helper:

```ts
// Best-effort duplicate check: sum of non-cancelled seats this phone already
// holds for the event. Any failure returns 0 — the guard must never block a
// valid registration.
async function existingSeatsFor(
  env: { SUPABASE_URL: string; SUPABASE_SERVICE_KEY: string },
  eventId: string,
  phone: string,
): Promise<number> {
  try {
    const { data, error } = await getSupabase(env)
      .from('registrations')
      .select('seats')
      .eq('event_id', eventId)
      .eq('phone', phone)
      .neq('payment_status', 'cancelled');
    if (error || !data) return 0;
    return data.reduce((sum: number, r: { seats: number }) => sum + (r.seats || 0), 0);
  } catch {
    return 0;
  }
}
```

In `registerForEvent`, extend the description (append to the existing string):

```
 If the phone already has a registration for this event, the tool returns requires_confirmation=true instead of booking — tell the user, and only call again with confirm_additional: true after their explicit yes.
```

Add to `inputSchema.properties`:

```ts
      confirm_additional: {
        type: 'boolean',
        description:
          'Set to true ONLY after the user has been told they already have a spot for this event and has explicitly confirmed they want another.',
      },
```

At the top of the `handler`, before the `handleRegister` call:

```ts
    const sanitizedPhone = sanitizePhone(String(args.phone ?? ''));
    if (sanitizedPhone && args.confirm_additional !== true) {
      const existing = await existingSeatsFor(env, String(args.event_id ?? ''), sanitizedPhone);
      if (existing > 0) {
        return {
          registered: false,
          requires_confirmation: true,
          existing_seats: existing,
          message: `This phone number already has ${existing} seat(s) booked for this event. Tell the user this explicitly and ask whether they want to book an additional spot. Only if they confirm, call register_for_event again with confirm_additional: true.`,
        };
      }
    }
```

The synthetic-request body passed to `handleRegister` stays exactly as it is (no `confirm_additional` key).

- [ ] **Step 5: Add the instructions line in protocol.ts**

In `worker/src/mcp/protocol.ts`, inside the `INSTRUCTIONS` template literal, add this as a new paragraph before the `Cancellations` paragraph:

```
Duplicate bookings: if register_for_event returns requires_confirmation, the person already has a spot for that event — tell them so explicitly, and only retry with confirm_additional: true after they clearly say they want an additional spot.
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd worker && npx vitest run src/mcp/write-tools.test.ts`
Expected: 17/17 PASS.

- [ ] **Step 7: Run the full worker suite**

Run: `cd worker && npm test`
Expected: all PASS (224 tests).

- [ ] **Step 8: Commit**

```bash
git add worker/src/mcp/write-tools.ts worker/src/mcp/write-tools.test.ts worker/src/mcp/protocol.ts
git commit -m "feat(worker): require explicit confirmation for duplicate MCP registrations"
```

---

### Task 2: Merge, deploy, and smoke-test

- [ ] **Step 1: Final check**

```bash
cd worker && npm test
```

Expected: all green.

- [ ] **Step 2: Merge and push**

```bash
git checkout main && git merge feat/mcp-duplicate-guard && git branch -d feat/mcp-duplicate-guard && git push
```

- [ ] **Step 3: Deploy the worker** (manual — never auto-deploys)

```bash
cd worker && npx wrangler deploy
```

- [ ] **Step 4: Smoke-test production**

Call `tools/list` on `https://api.boardgamecompany.in/mcp` and confirm `register_for_event`'s inputSchema now contains `confirm_additional`, and `initialize` instructions mention "Duplicate bookings". (Do NOT create a real registration against production.)
