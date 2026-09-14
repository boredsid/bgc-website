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

/**
 * Number of seats in a cost array that are still being paid for.
 *
 * Callers use this to cap how many REPLAY passes they bother claiming: a pass
 * spent on a seat that is already free is a pass burned for nothing, and claims
 * are one-per-event-per-pass.
 */
export function countPaidSeats(seatCosts: number[]): number {
  return seatCosts.filter((c) => c > 0).length;
}

/**
 * Apply REPLAY passes to a per-seat cost array.
 *
 * A pass belongs to one person and is worth exactly one free seat. A booking can
 * carry several — the purchaser's own, plus any companion whose number was
 * entered and checked out — so `passCount` is however many distinct passes this
 * booking successfully claimed. Seats already free (a Guild Path self-seat, a
 * plus-one) are left alone; the passes spend on the most expensive seats still
 * being paid for, matching how the giveaway promo spends.
 *
 * Deciding *which* people are eligible is the caller's job: it is the caller
 * that knows whose seat the Guild Path already covered and which numbers have
 * already spent their pass on this event.
 *
 * Runs after the Guild Path discount and before the giveaway promo, so the
 * promo covers whatever the passes didn't.
 */
export function applyReplayPassSeats(
  seatCosts: number[],
  passCount: number,
): { seatCosts: number[]; seatsCovered: number } {
  if (passCount <= 0) return { seatCosts, seatsCovered: 0 };

  // Most expensive paid seat first, so the passes buy down the largest amount.
  const paidIndexes = seatCosts
    .map((cost, index) => ({ cost, index }))
    .filter((s) => s.cost > 0)
    .sort((a, b) => b.cost - a.cost)
    .slice(0, passCount)
    .map((s) => s.index);

  if (paidIndexes.length === 0) return { seatCosts, seatsCovered: 0 };

  const next = [...seatCosts];
  for (const i of paidIndexes) next[i] = 0;
  return { seatCosts: next, seatsCovered: paidIndexes.length };
}
