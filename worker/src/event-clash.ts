import type { SupabaseClient } from '@supabase/supabase-js';

export interface ClashingEvent {
  id: string;
  name: string;
  date: string;
  end_date: string | null;
  is_all_day: boolean;
  venue_name: string | null;
}

export interface EventClash {
  event: ClashingEvent;
  seats: number;
}

/**
 * The registration this number already holds for a different event starting at
 * the same moment, if there is one.
 *
 * "Same time" is exact start equality, not overlap. BGC slots are published on
 * a fixed grid, so two events that start together are the two you have to
 * choose between, while a 15:00 and an 18:00 on the same day are an afternoon
 * and an evening someone can genuinely do both of. All-day events compare the
 * same way — two all-day events pinned to the same day clash, an all-day event
 * and an evening slot don't.
 *
 * Matched on phone rather than user_id, because the phone is what every
 * registration row carries, including ones written before a user row existed.
 * Unpublished events count: the booking is real even if the listing is hidden.
 */
export async function findEventClash(
  supabase: SupabaseClient,
  eventId: string,
  startsAt: string,
  phone: string,
): Promise<EventClash | null> {
  const { data: siblings } = await supabase
    .from('events')
    .select('id, name, date, end_date, is_all_day, venue_name')
    .eq('date', startsAt)
    .neq('id', eventId);

  if (!siblings || siblings.length === 0) return null;

  const { data: clashing } = await supabase
    .from('registrations')
    .select('event_id, seats')
    .in('event_id', siblings.map((e: { id: string }) => e.id))
    .eq('phone', phone)
    .neq('payment_status', 'cancelled')
    .limit(1);

  const hit = clashing?.[0];
  if (!hit) return null;

  const event = siblings.find((e: { id: string }) => e.id === hit.event_id);
  if (!event) return null;

  return { event: event as ClashingEvent, seats: hit.seats };
}

/** The one sentence every caller leads with; each appends its own guidance. */
export function clashMessage(clash: EventClash): string {
  return `Already registered for "${clash.event.name}", which starts at the same time.`;
}
