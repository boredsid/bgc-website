// Formatting for event timing, which has three shapes:
//   - single slot, timed   (date only)                    "Sat, 5 Sep" / "6:00 pm"
//   - all day              (is_all_day)                   "Sat, 5 Sep" / "All day"
//   - multi-day            (end_date on a later day)      "5 – 7 Sep"  / "10:00 am – 6:00 pm"
//
// Everything renders in Asia/Kolkata: BGC events happen in Bangalore, so the
// clock time shown must be the time at the venue, and an all-day event's
// calendar day must not shift for a viewer in another timezone.
//
// Mirror of admin/src/lib/eventDate.ts — everything from `const TZ` down is
// byte-identical, and admin/src/lib/eventDate.test.ts asserts that.

const TZ = 'Asia/Kolkata';

export interface EventTiming {
  date: string;
  end_date?: string | null;
  is_all_day?: boolean | null;
}

/** YYYY-MM-DD for the Bangalore calendar day an instant falls on. */
export function bangaloreDayKey(iso: string | Date): string {
  const d = iso instanceof Date ? iso : new Date(iso);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

function part(d: Date, opts: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('en-IN', { timeZone: TZ, ...opts }).format(d);
}

export function isMultiDay(e: EventTiming): boolean {
  if (!e.end_date) return false;
  return bangaloreDayKey(e.end_date) !== bangaloreDayKey(e.date);
}

/** The instant the event is actually over. Mirrors the `ends_at` column. */
export function eventEndsAt(e: EventTiming): Date {
  const end = new Date(e.end_date || e.date);
  if (!e.is_all_day) return end;
  return new Date(`${bangaloreDayKey(end)}T23:59:59+05:30`);
}

export function isHappeningNow(e: EventTiming, now: Date = new Date()): boolean {
  return now >= new Date(e.date) && now <= eventEndsAt(e);
}

/**
 * "Sat, 5 Sep" (short) / "Saturday, 5 September" (long) for a single day.
 * A range leads with the weekdays, then the dates — "Sat – Sun, 12 – 13 Sep",
 * "Mon – Fri, 28 Sep – 2 Oct", "Wed – Sat, 30 Dec 2026 – 2 Jan 2027" — echoing
 * the single-day shape. Month and year are printed once when both ends share
 * them.
 */
export function formatEventDateLabel(e: EventTiming, style: 'short' | 'long' = 'short'): string {
  const start = new Date(e.date);
  const monthOpt = style === 'long' ? 'long' : 'short';
  const weekdayOpt = style === 'long' ? 'long' : 'short';

  if (!isMultiDay(e)) {
    return part(start, { weekday: weekdayOpt, day: 'numeric', month: monthOpt });
  }

  const end = new Date(e.end_date!);
  const sameYear = part(start, { year: 'numeric' }) === part(end, { year: 'numeric' });
  const sameMonth = sameYear && part(start, { month: 'short' }) === part(end, { month: 'short' });

  // Built piecewise rather than with one format call: the range needs the month
  // and year suppressed on the left when both ends agree, which no single
  // Intl pattern expresses.
  const weekdays = `${part(start, { weekday: weekdayOpt })} – ${part(end, { weekday: weekdayOpt })}`;
  const startDate = part(start, {
    day: 'numeric',
    ...(sameMonth ? {} : { month: monthOpt }),
    ...(sameYear ? {} : { year: 'numeric' }),
  });
  const endDate = part(end, {
    day: 'numeric',
    month: monthOpt,
    ...(sameYear ? {} : { year: 'numeric' }),
  });

  return `${weekdays}, ${startDate} – ${endDate}`;
}

/** "All day" / "6:00 pm" / "10:00 am – 6:00 pm". */
export function formatEventTimeLabel(e: EventTiming): string {
  if (e.is_all_day) return 'All day';
  const timeOpts: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit', hour12: true };
  const startLabel = part(new Date(e.date), timeOpts);
  if (!e.end_date) return startLabel;
  const endLabel = part(new Date(e.end_date), timeOpts);
  if (endLabel === startLabel) return startLabel;
  return `${startLabel} – ${endLabel}`;
}

/** One line for prose: "Saturday, 5 September at 6:00 pm" / "5 – 7 Sep, all day". */
export function formatEventWhen(e: EventTiming, style: 'short' | 'long' = 'long'): string {
  const dateLabel = formatEventDateLabel(e, style);
  if (e.is_all_day) return `${dateLabel}, all day`;
  return `${dateLabel} at ${formatEventTimeLabel(e)}`;
}
