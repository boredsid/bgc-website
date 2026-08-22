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
 * Apply a REPLAY pass to a per-seat cost array.
 *
 * A REPLAY pass belongs to one person, so it covers exactly one seat: the pass
 * holder's own. Companion seats still pay. Someone who already holds seats for
 * this event has spent the entitlement, and a booking that already contains a
 * free seat (a Guild Path self-seat) doesn't need it — in both cases the pass
 * changes nothing rather than stacking.
 *
 * Runs after the Guild Path discount and before the giveaway promo, so the
 * promo covers whatever the pass didn't. Returns the new cost array; the caller
 * decides how to label it.
 */
export function applyReplayPassSeat(
  seatCosts: number[],
  opts: { hasPass: boolean; existingSeatsForEvent: number },
): { seatCosts: number[]; seatCovered: boolean } {
  if (!opts.hasPass || opts.existingSeatsForEvent > 0) return { seatCosts, seatCovered: false };
  if (seatCosts.length === 0 || seatCosts.some((c) => c <= 0)) return { seatCosts, seatCovered: false };

  // Cover the most expensive seat, matching how the giveaway promo spends.
  const priciest = seatCosts.reduce((best, c, i) => (c > seatCosts[best] ? i : best), 0);
  const next = [...seatCosts];
  next[priciest] = 0;
  return { seatCosts: next, seatCovered: true };
}
