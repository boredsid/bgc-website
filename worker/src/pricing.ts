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
