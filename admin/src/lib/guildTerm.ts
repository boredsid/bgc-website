/**
 * How long each Guild Path tier runs for, in calendar months.
 *
 * This mirrors `TIER_DURATION_MONTHS` in `worker/src/guild-purchase.ts` and the
 * "Valid for N months" copy in `src/lib/guild-tiers.ts`. The admin tool used to
 * keep its own table in days, which had drifted to 180 for Adventurer — so a
 * membership bought on the site ran three months while the same tier marked
 * paid from here ran six. Anything that dates a membership in the admin tool
 * goes through this module, so there is one table left to keep in step.
 */
export const TIER_DURATION_MONTHS: Record<string, number> = {
  initiate: 3,
  adventurer: 3,
  guildmaster: 12,
};

/** Fallback term for a tier we don't recognise — the shortest one we sell. */
export const DEFAULT_DURATION_MONTHS = 3;

export function tierDurationMonths(tier: string | null | undefined): number {
  return TIER_DURATION_MONTHS[tier ?? ''] ?? DEFAULT_DURATION_MONTHS;
}

/**
 * The expiry date for a membership of `tier` starting on `startsAt` (YYYY-MM-DD).
 *
 * Counts calendar months rather than a fixed number of days, so a three-month
 * term always lands on the same day of the month instead of drifting by a day
 * or two depending on which months it crosses. The arithmetic runs in UTC to
 * match the worker, which does the same sum on the purchase path — otherwise
 * the two could disagree about the same start date near midnight.
 *
 * Returns '' when `startsAt` isn't a real date, so callers can say so rather
 * than throw; date inputs can be cleared.
 */
export function membershipExpiry(startsAt: string, tier: string | null | undefined): string {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(startsAt);
  if (!parts) return '';
  const [, y, m, d] = parts;
  const expires = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  if (Number.isNaN(expires.getTime())) return '';
  expires.setUTCMonth(expires.getUTCMonth() + tierDurationMonths(tier));
  return expires.toISOString().slice(0, 10);
}
