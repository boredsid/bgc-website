# Differential Option Pricing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each option of a single-select custom question carry its own price, so an attendee's answers can change the per-seat price away from the event base.

**Architecture:** A pure helper `effectiveSeatPrice(questions, answers, basePrice)` is the single source of truth for the rule. The worker imports it from `worker/src/pricing.ts` (used by both the public and admin register handlers); the public registration form keeps a tiny mirror of the same logic. The effective price is a drop-in replacement for `event.price` as the per-seat base everywhere pricing happens, so guild/promo/credit stacking is unchanged.

**Tech Stack:** TypeScript, Cloudflare Workers, Vitest (worker + admin), Astro/React (public site), Vite/React/shadcn (admin).

## Global Constraints

- The pricing rule, verbatim: if any selected option has a defined `price`, the event base price is ignored and the effective per-seat price is the **sum** of all selected priced options; otherwise the base price applies. `price: undefined` = no price; explicit `price: 0` counts as a priced selection (free override).
- Pricing options apply to `radio` and `select` types only. `text` and `checkbox` never carry a price.
- A registration carries one answer set — every seat in a registration shares one effective price.
- `price` is an integer number of rupees stored inside the existing `events.custom_questions` JSONB. **No DB migration.**
- Do not change capacity logic (`event.capacity`, per-option `capacity`) — it is independent of price.
- Email and admin views show `total_amount` only — no per-answer price breakdown.

---

### Task 1: Shared pricing helper

**Files:**
- Create: `worker/src/pricing.ts`
- Test: `worker/src/pricing.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface PricingOption { value: string; capacity?: number; price?: number }`
  - `interface PricingQuestion { id: string; label: string; type: string; required: boolean; options?: PricingOption[] }`
  - `function effectiveSeatPrice(questions: PricingQuestion[], answers: Record<string, string | boolean>, basePrice: number): number`

- [ ] **Step 1: Write the failing test**

Create `worker/src/pricing.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { effectiveSeatPrice, type PricingQuestion } from './pricing';

const tableQ: PricingQuestion = {
  id: 'table', label: 'Table', type: 'radio', required: true,
  options: [{ value: 'Standard' }, { value: 'VIP', price: 800 }, { value: 'Free', price: 0 }],
};
const mealQ: PricingQuestion = {
  id: 'meal', label: 'Meal', type: 'select', required: false,
  options: [{ value: 'None' }, { value: 'Dinner', price: 300 }],
};
const textQ: PricingQuestion = { id: 'note', label: 'Note', type: 'text', required: false };

describe('effectiveSeatPrice', () => {
  it('returns base price when no priced option is selected', () => {
    expect(effectiveSeatPrice([tableQ, mealQ], { table: 'Standard', meal: 'None' }, 500)).toBe(500);
  });
  it('returns base price when there are no option questions', () => {
    expect(effectiveSeatPrice([textQ], { note: 'hi' }, 500)).toBe(500);
  });
  it('uses a single priced option and ignores the base', () => {
    expect(effectiveSeatPrice([tableQ], { table: 'VIP' }, 500)).toBe(800);
  });
  it('sums priced options across questions', () => {
    expect(effectiveSeatPrice([tableQ, mealQ], { table: 'VIP', meal: 'Dinner' }, 500)).toBe(1100);
  });
  it('treats an explicit price of 0 as a priced selection', () => {
    expect(effectiveSeatPrice([tableQ], { table: 'Free' }, 500)).toBe(0);
  });
  it('only counts the priced answer when mixing priced and unpriced', () => {
    expect(effectiveSeatPrice([tableQ, mealQ], { table: 'Standard', meal: 'Dinner' }, 500)).toBe(300);
  });
  it('ignores non-option answer types and unselected questions', () => {
    expect(effectiveSeatPrice([tableQ, mealQ], { note: 'x' }, 500)).toBe(500);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd worker && npx vitest run src/pricing.test.ts`
Expected: FAIL — cannot resolve `./pricing` / `effectiveSeatPrice is not defined`.

- [ ] **Step 3: Write minimal implementation**

Create `worker/src/pricing.ts`:

```ts
export interface PricingOption {
  value: string;
  capacity?: number;
  price?: number;
}

export interface PricingQuestion {
  id: string;
  label: string;
  type: string;
  required: boolean;
  options?: PricingOption[];
}

/**
 * Effective per-seat price for a registration given the attendee's answers.
 *
 * If any selected option carries a defined price, the event base price is
 * ignored and the effective price is the sum of all selected priced options.
 * Otherwise the base price applies. An explicit price of 0 counts as a priced
 * selection (a free override).
 */
export function effectiveSeatPrice(
  questions: PricingQuestion[],
  answers: Record<string, string | boolean>,
  basePrice: number,
): number {
  const pricedSelections: number[] = [];
  for (const q of questions) {
    if (q.type !== 'radio' && q.type !== 'select') continue;
    const answer = answers[q.id];
    if (typeof answer !== 'string' || answer === '') continue;
    const opt = q.options?.find((o) => o.value === answer);
    if (opt && opt.price !== undefined) pricedSelections.push(opt.price);
  }
  if (pricedSelections.length === 0) return basePrice;
  return pricedSelections.reduce((sum, p) => sum + p, 0);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd worker && npx vitest run src/pricing.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add worker/src/pricing.ts worker/src/pricing.test.ts
git commit -m "feat(worker): effectiveSeatPrice helper for differential option pricing"
```

---

### Task 2: Wire effective price into worker register handlers

**Files:**
- Modify: `worker/src/register.ts` (import + lines 154, 162, 179-181, 196, 199, 209; insert seatPrice after validation at line 105)
- Modify: `worker/src/admin/register-manual.ts` (import + lines 93, 100, 116-119, 134, 142; compute customQuestions + seatPrice after event fetch at line 42)
- Test: `worker/src/register.test.ts` (add a `describe` block)

**Interfaces:**
- Consumes: `effectiveSeatPrice`, `PricingQuestion` from Task 1.
- Produces: nothing new (behavior change only).

- [ ] **Step 1: Write the failing test**

Append to `worker/src/register.test.ts` (after the last `describe`):

```ts
describe('handleRegister differential pricing', () => {
  function buildMock(capture: { insert: any }) {
    return {
      from: (table: string) => {
        if (table === 'events') return {
          select: () => ({ eq: () => ({ eq: () => ({ single: async () => ({ data: {
            id: 'E1', name: 'Test', date: '2026-06-01', venue_name: 'V', venue_area: null,
            price: 500, capacity: 10, price_includes: null, is_published: true,
            guild_path_exclusive: false,
            custom_questions: [
              { id: 'table', label: 'Table', type: 'radio', required: true,
                options: [{ value: 'Standard' }, { value: 'VIP', price: 800 }] },
            ],
          }, error: null }) }) }) }),
        };
        if (table === 'registrations') return {
          select: () => ({ eq: () => ({ neq: async () => ({ data: [], error: null }) }) }),
          insert: (row: any) => { capture.insert = row; return { select: () => ({ single: async () => ({ data: { id: 'R1' }, error: null }) }) }; },
        };
        if (table === 'users') return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
          insert: () => ({ select: () => ({ single: async () => ({ data: { id: 'U1' }, error: null }) }) }),
        };
        if (table === 'guild_path_members') return {
          select: () => ({ eq: () => ({ eq: () => ({ gte: () => ({ order: () => ({ limit: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) }) }) }),
        };
        if (table === 'leads') return {
          update: () => ({ eq: () => ({ eq: () => ({ is: () => ({ is: async () => ({ error: null }) }) }) }) }),
        };
        return null;
      },
    };
  }

  it('charges the option price instead of the base price', async () => {
    const capture = { insert: null as any };
    (getSupabase as any).mockReturnValue(buildMock(capture));
    const req = new Request('http://localhost/api/register', {
      method: 'POST',
      body: JSON.stringify({
        event_id: 'E1', name: 'Asha', phone: '9876543210', email: 'a@b.com',
        seats: 2, custom_answers: { table: 'VIP' }, payment_status: 'pending',
      }),
    });
    const ctx = { waitUntil: (p: Promise<unknown>) => p } as any;
    const res = await handleRegister(req, mockEnv(), ctx);
    expect(res.status).toBe(200);
    expect(capture.insert.total_amount).toBe(1600); // 800 * 2 seats
  });

  it('falls back to base price when the unpriced option is chosen', async () => {
    const capture = { insert: null as any };
    (getSupabase as any).mockReturnValue(buildMock(capture));
    const req = new Request('http://localhost/api/register', {
      method: 'POST',
      body: JSON.stringify({
        event_id: 'E1', name: 'Asha', phone: '9876543210', email: 'a@b.com',
        seats: 1, custom_answers: { table: 'Standard' }, payment_status: 'pending',
      }),
    });
    const ctx = { waitUntil: (p: Promise<unknown>) => p } as any;
    await handleRegister(req, mockEnv(), ctx);
    expect(capture.insert.total_amount).toBe(500);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd worker && npx vitest run src/register.test.ts -t "differential pricing"`
Expected: FAIL — first test gets `total_amount` 1000 (500×2 base) instead of 1600.

- [ ] **Step 3: Implement — `worker/src/register.ts`**

Add the import beside the existing imports at the top:

```ts
import { effectiveSeatPrice } from './pricing';
```

Immediately after the custom-question validation loop closes (the `}` ending the `for (const q of customQuestions)` loop, line 105), add:

```ts
  const seatPrice = effectiveSeatPrice(customQuestions, customAnswers, event.price);
```

Then replace `event.price` with `seatPrice` at the per-seat pricing base sites:

- Line 154: `let totalAmount = event.price * seats;` → `let totalAmount = seatPrice * seats;`
- Line 162: `let seatCosts: number[] = Array(seats).fill(event.price);` → `let seatCosts: number[] = Array(seats).fill(seatPrice);`
- Lines 179-181 (initiate branch):

```ts
      seatCosts = [
        ...Array(fullSeats).fill(seatPrice),
        ...Array(secondSeats).fill(seatPrice * 0.9),
        ...Array(firstSeats).fill(seatPrice * 0.8),
      ];
```

- Line 196: `...Array(paidSeats).fill(event.price),` → `...Array(paidSeats).fill(seatPrice),`
- Line 199: `totalAmount = paidSeats * event.price;` → `totalAmount = paidSeats * seatPrice;`
- Line 209: `const applicablePromo = await getApplicablePromo(supabase, userId, event.price);` → `const applicablePromo = await getApplicablePromo(supabase, userId, seatPrice);`

Leave every other `event.price` / `event.capacity` reference untouched.

- [ ] **Step 4: Implement — `worker/src/admin/register-manual.ts`**

Add the import beside the existing imports at the top:

```ts
import { effectiveSeatPrice, type PricingQuestion } from '../pricing';
```

Immediately after the event-not-found guard (line 42, `if (!event) return ...`), add:

```ts
  const customQuestions = (event.custom_questions || []) as PricingQuestion[];
  const seatPrice = effectiveSeatPrice(customQuestions, body.custom_answers || {}, event.price);
```

Then replace `event.price` with `seatPrice` at the per-seat pricing base sites:

- Line 93: `let totalAmount = event.price * seats;` → `let totalAmount = seatPrice * seats;`
- Line 100: `let seatCosts: number[] = Array(seats).fill(event.price);` → `let seatCosts: number[] = Array(seats).fill(seatPrice);`
- Lines 116-119 (initiate branch):

```ts
      seatCosts = [
        ...Array(fullSeats).fill(seatPrice),
        ...Array(secondSeats).fill(seatPrice * 0.9),
        ...Array(firstSeats).fill(seatPrice * 0.8),
      ];
```

- Line 130-131 (free/plus-one branch) — the paid-seat fill:

```ts
      seatCosts = [
        ...Array(paidSeats).fill(seatPrice),
```

- Line 134: `totalAmount = paidSeats * event.price;` → `totalAmount = paidSeats * seatPrice;`
- Line 142: `const applicablePromo = await getApplicablePromo(supabase, userId, event.price);` → `const applicablePromo = await getApplicablePromo(supabase, userId, seatPrice);`

Leave every other `event.price` / `event.capacity` reference untouched.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd worker && npm test`
Expected: PASS — the new differential-pricing tests pass and all existing worker tests (cancel, credits, access-auth, register, register-manual) still pass.

- [ ] **Step 6: Commit**

```bash
git add worker/src/register.ts worker/src/admin/register-manual.ts worker/src/register.test.ts
git commit -m "feat(worker): charge differential option price in register + manual register"
```

---

### Task 3: Public registration form — effective price + live display

**Files:**
- Modify: `src/lib/types.ts` (add `price?` to `CustomQuestionOption`, lines 39-42)
- Modify: `src/components/RegistrationForm.tsx` (add mirror helper; lines 170-171, 174, 184-186, 200, 203; display line 388)

**Interfaces:**
- Consumes: the pricing rule from Task 1 (mirrored locally — the public site is a separate package and does not import from `worker/`).
- Produces: nothing new.

- [ ] **Step 1: Add `price` to the option type**

In `src/lib/types.ts`, change the `CustomQuestionOption` interface (lines 39-42) to:

```ts
export interface CustomQuestionOption {
  value: string;
  capacity?: number;
  price?: number;
}
```

- [ ] **Step 2: Add the mirror helper in the form module**

In `src/components/RegistrationForm.tsx`, add this function at module scope (top level, below the imports, outside the component):

```ts
// Mirror of worker/src/pricing.ts effectiveSeatPrice. The public site is a
// separate package and can't import from worker/, so the rule is duplicated.
// If any selected option carries a price, the base price is ignored and the
// effective per-seat price is the sum of selected priced options; an explicit
// price of 0 counts as a priced selection.
function effectiveSeatPrice(
  questions: CustomQuestion[],
  answers: Record<string, string | boolean>,
  basePrice: number,
): number {
  const priced: number[] = [];
  for (const q of questions) {
    if (q.type !== 'radio' && q.type !== 'select') continue;
    const answer = answers[q.id];
    if (typeof answer !== 'string' || answer === '') continue;
    const opt = q.options?.find((o) => o.value === answer);
    if (opt && opt.price !== undefined) priced.push(opt.price);
  }
  if (priced.length === 0) return basePrice;
  return priced.reduce((sum, p) => sum + p, 0);
}
```

Ensure `CustomQuestion` is imported in this file (it already imports from `../lib/types`; add `CustomQuestion` to that import if not already present).

- [ ] **Step 3: Compute the effective price and replace the base**

In the component body, just before `const grossTotal = event.price * seats;` (line 170), add:

```ts
  const seatPrice = effectiveSeatPrice(event.custom_questions || [], customAnswers, event.price);
```

Then replace `event.price` with `seatPrice` at these pricing-base sites only:

- Line 170: `const grossTotal = event.price * seats;` → `const grossTotal = seatPrice * seats;`
- Line 171: `const promoFits = !!activePromo && event.price <= activePromo.max_event_price;` → `const promoFits = !!activePromo && seatPrice <= activePromo.max_event_price;`
- Line 174: `let seatCosts: number[] = Array(seats).fill(event.price);` → `let seatCosts: number[] = Array(seats).fill(seatPrice);`
- Lines 184-186 (the `discount === '20'` branch):

```ts
      seatCosts = [
        ...Array(fullSeats).fill(seatPrice),
        ...Array(secondSeats).fill(seatPrice * 0.9),
        ...Array(firstSeats).fill(seatPrice * 0.8),
      ];
```

- Line 200: `...Array(paidSeats).fill(event.price),` → `...Array(paidSeats).fill(seatPrice),`
- Line 203: `total = paidSeats * event.price;` → `total = paidSeats * seatPrice;`

Leave the `customAnswers` submit payload, capacity, and other `event.price` references untouched.

- [ ] **Step 4: Show the effective price in the header**

Replace line 388:

```tsx
          <span className="font-heading font-bold text-lg">₹{event.price} / person</span>
```

with:

```tsx
          <span className="font-heading font-bold text-lg">₹{seatPrice} / person</span>
```

- [ ] **Step 5: Verify it type-checks and builds**

Run: `npm run build`
Expected: build succeeds with no TypeScript errors. (The public site has no test runner; the build is the gate.)

- [ ] **Step 6: Commit**

```bash
git add src/lib/types.ts src/components/RegistrationForm.tsx
git commit -m "feat(site): apply differential option price in registration form"
```

---

### Task 4: Admin editor — per-option price input

**Files:**
- Modify: `admin/src/lib/types.ts` (add `price?` to `CustomQuestionOption`)
- Modify: `admin/src/components/CustomQuestionsEditor.tsx` (`OptionsEditor`, lines 153-167)
- Test: `admin/src/components/CustomQuestionsEditor.test.tsx` (add one test)

**Interfaces:**
- Consumes: nothing from earlier tasks (admin is a separate package).
- Produces: option rows that may include `price`, consumed by the worker via `events.custom_questions`.

- [ ] **Step 1: Add `price` to the admin option type**

In `admin/src/lib/types.ts`, add `price?: number;` to the `CustomQuestionOption` interface (alongside `value` and `capacity?`). If the admin interface currently reads:

```ts
export interface CustomQuestionOption {
  value: string;
  capacity?: number;
}
```

change it to:

```ts
export interface CustomQuestionOption {
  value: string;
  capacity?: number;
  price?: number;
}
```

- [ ] **Step 2: Write the failing test**

Add to `admin/src/components/CustomQuestionsEditor.test.tsx` inside the existing `describe`:

```ts
  it('sets a price on an option', () => {
    const value: CustomQuestion[] = [
      { id: 'table', label: 'Table', type: 'radio', required: false, options: [{ value: 'VIP' }] },
    ];
    let last: CustomQuestion[] = value;
    render(<CustomQuestionsEditor value={value} onChange={(v) => { last = v; }} />);
    fireEvent.change(screen.getByLabelText('Option price'), { target: { value: '800' } });
    expect(last[0].options![0].price).toBe(800);
  });
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd admin && npx vitest run src/components/CustomQuestionsEditor.test.tsx -t "sets a price"`
Expected: FAIL — no element with label "Option price".

- [ ] **Step 4: Add the price input**

In `admin/src/components/CustomQuestionsEditor.tsx`, in `OptionsEditor`, add a price `Input` between the capacity input and the remove button (after line 162's closing `/>`, before the remove `Button`):

```tsx
          <Input
            type="number"
            placeholder="Price"
            aria-label="Option price"
            className="w-16 sm:w-24 shrink-0"
            value={o.price ?? ''}
            onChange={(e) => update(idx, { price: e.target.value ? Number(e.target.value) : undefined })}
          />
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd admin && npm test`
Expected: PASS — the new test passes and all existing admin tests still pass.

- [ ] **Step 6: Verify the admin build compiles**

Run: `cd admin && npm run build`
Expected: build succeeds with no TypeScript errors.

- [ ] **Step 7: Commit**

```bash
git add admin/src/lib/types.ts admin/src/components/CustomQuestionsEditor.tsx admin/src/components/CustomQuestionsEditor.test.tsx
git commit -m "feat(admin): per-option price input in custom-question editor"
```

---

## Manual verification (after all tasks)

1. `cd admin && npm run dev` — open an event, add a `radio` question with options "Standard" (no price) and "VIP" (price 800); save.
2. On the public site (`npm run dev`), open that event's registration form. The header shows `₹500 / person`; selecting **VIP** updates it to `₹800 / person` and the total recomputes. Selecting **Standard** returns it to base.
3. Register with VIP × 2 → confirmation email and `/pay` amount reflect ₹1600.
4. As a guild Initiate member, VIP × 1 → 20% off the ₹800 (₹640), confirming discounts stack on the effective price.

## Deployment note

The worker change does **not** auto-deploy. After merge, run `cd worker && npx wrangler deploy`. Site + admin auto-deploy on push to `main`.

## Self-Review Notes

- **Spec coverage:** data model (T1 helper types, T3/T4 type files) ✓; rule incl. sum/override/0-as-priced (T1 tests) ✓; radio+select scope (T1 helper guard) ✓; stacking incl. promo gate (T2 register.ts:209, register-manual.ts:142; T3 promoFits) ✓; no migration ✓; total-only email/admin (untouched) ✓; admin editor input (T4) ✓; manual register path (T2) ✓.
- **Placeholder scan:** none — every code step shows full code.
- **Type consistency:** `effectiveSeatPrice(questions, answers, basePrice)` signature identical in worker (T1) and mirror (T3); `price?: number` field name consistent across `worker/src/pricing.ts`, `src/lib/types.ts`, `admin/src/lib/types.ts`.
