# Differential pricing for radio/select custom-question options

**Date:** 2026-07-01
**Status:** Approved design

## Problem

Events have a single base price (`events.price`) charged per seat. We want an
optional per-response price: each option of a single-select custom question can
carry its own price, so picking "VIP table" or "Dinner add-on" changes what the
attendee pays — without forcing separate events.

## Decisions (locked)

- **Override base, not surcharge.** When a priced option is selected, the event
  base price is *ignored*. The effective per-seat price is the **sum** of all
  selected priced options across questions.
- **Combine across questions by summing.** Base ₹500, "Table → VIP ₹800",
  "Meal → Dinner ₹300", pick both → ₹1100/seat. Base is dropped because at least
  one priced option is selected. Unpriced answers contribute ₹0.
- **No priced option selected → base price.** If the attendee selects only
  unpriced options (or the event has no priced options), the seat costs
  `event.price` exactly as today.
- **Discounts still stack.** Guild %, plus-ones, promos, and credits all compute
  against the effective per-seat price (drop-in replacement for `event.price`),
  including the promo `max_event_price` eligibility gate.
- **Total only, no breakdown.** Confirmation email and admin views keep showing
  `total_amount`; we do not annotate individual answers with their price.

## Scope of "option" questions

Applies to both `radio` and `select` types — they are mechanically identical
single-select questions, and the existing per-option `capacity` feature already
treats them the same. `text` and `checkbox` never carry a price.

## Data model

`CustomQuestionOption` gains an optional field:

```ts
interface CustomQuestionOption {
  value: string;
  capacity?: number;
  price?: number; // integer rupees; undefined/blank = no price, 0 = free override
}
```

Stored inside the existing `events.custom_questions` JSONB column — **no
migration required**. `price: undefined` means "no price set" (falls back to
base / contributes nothing). An explicit `0` is a real free override and counts
as "a priced option is selected".

Type updated in both `src/lib/types.ts` and `admin/src/lib/types.ts`.

## Core helper

A single pure function is the source of truth for the rule:

```ts
// effective per-seat price given the attendee's answers
function effectiveSeatPrice(
  questions: CustomQuestion[],
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

Lives in **`worker/src/pricing.ts`** (new file) and is imported by both
`register.ts` and `register-manual.ts`. The frontend keeps a tiny mirror of the
same function inside `RegistrationForm.tsx` (separate package; logic is small
and stable enough that duplication is cheaper than a shared package).

Because a registration carries one answer set, every seat in a registration
shares the same effective price — no per-seat variance within a registration.

## Changes by file

### Worker — `worker/src/register.ts`, `worker/src/admin/register-manual.ts`
- After custom-question validation, compute
  `const seatPrice = effectiveSeatPrice(customQuestions, customAnswers, event.price);`
- Replace every `event.price` used as the **per-seat pricing base** with
  `seatPrice`:
  - `totalAmount = seatPrice * seats`
  - `seatCosts = Array(seats).fill(seatPrice)`
  - guild `initiate` tiers (`seatPrice`, `seatPrice * 0.9`, `seatPrice * 0.8`)
  - guild `adventurer`/`guildmaster` paid-seat fills + `paidSeats * seatPrice`
  - `getApplicablePromo(supabase, userId, seatPrice)` (promo eligibility gate)
- Do **not** change capacity logic (`event.capacity`, per-option `capacity`),
  which is independent of price.

### Frontend — `src/components/RegistrationForm.tsx`
- Add the mirrored `effectiveSeatPrice` and derive
  `const seatPrice = effectiveSeatPrice(customQuestions, customAnswers, event.price);`
  reactively (recomputed on every answer change — it already re-renders on
  `customAnswers` updates).
- Replace `event.price` base in `grossTotal`, `seatCosts`, the guild discount
  branches, and `promoFits` with `seatPrice`.
- Update the price display: the "₹{event.price} / person" line shows
  `seatPrice` so it reflects the current selection live. When `seatPrice` differs
  from `event.price`, the form already recomputes the totals below it; the
  per-person line simply tracks `seatPrice`.

### Admin editor — `admin/src/components/CustomQuestionsEditor.tsx`
- In `OptionsEditor`, add a `Price (₹)` number input per option beside the
  existing `Cap` input, bound to `o.price`
  (`onChange` writes `e.target.value ? Number(e.target.value) : undefined`).
- No other editor changes; `select`/`radio` already render `OptionsEditor`.

### Types
- `src/lib/types.ts`: add `price?: number` to `CustomQuestionOption`.
- `admin/src/lib/types.ts`: same addition.

## What does NOT change

- DB schema / migrations (JSONB field).
- Capacity counting in `worker/src/event-spots.ts` and per-option capacity.
- Email template (`worker/src/email.ts`) — still shows `total_amount`; the
  answer list already appears, no per-line price.
- Admin registration/registrations views — total only.

## Testing

Worker Vitest (`worker/src/pricing.test.ts` + additions to `register.test.ts`):

1. `effectiveSeatPrice` unit cases:
   - no priced option selected → base price
   - single priced option → that price (base ignored)
   - two priced options across two questions → sum
   - explicit `price: 0` selected → 0 (counts as priced)
   - unpriced answer + priced answer → only the priced one summed
   - non-option types (`text`/`checkbox`) never contribute
2. Register flow:
   - priced option overrides base in `total_amount`
   - guild `initiate` discount applies to the effective price
   - promo eligibility gate uses effective price, not base
   - credits applied against the effective-priced total

## Out of scope (YAGNI)

- Dedicated DB column for option price.
- Per-seat price variance inside a single registration.
- Override-vs-surcharge configurability (rule is fixed: sum of priced selections,
  base ignored).
- Per-answer price breakdown in email / admin UI.
