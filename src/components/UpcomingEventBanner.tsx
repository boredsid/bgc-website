import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { bangaloreDayKey, formatEventDateLabel, formatEventTimeLabel, isHappeningNow, isMultiDay } from '../lib/event-date';
import type { Event, EventSpots } from '../lib/types';

const WORKER_URL = import.meta.env.PUBLIC_WORKER_URL;
const WHATSAPP_URL = 'https://chat.whatsapp.com/GL1h4jipksfCW4vm7OtZjp';

function formatRelativeDate(event: Event): string {
  // A multi-day event that has already started is running right now, so the
  // countdown wording ("TOMORROW") would be wrong.
  if (isHappeningNow(event)) return 'HAPPENING NOW';

  const eventDate = new Date(event.date);

  // Bangalore calendar-day diff (not millisecond diff): a late-night event
  // can't be mislabeled by clock drift, and "TONIGHT" means tonight at the
  // venue rather than tonight wherever the visitor happens to be.
  const diffDays = Math.round(
    (Date.parse(bangaloreDayKey(event.date)) - Date.parse(bangaloreDayKey(new Date()))) / 86400000,
  );

  // A multi-day run reads better as its date range than as a single day.
  if (isMultiDay(event)) return formatEventDateLabel(event, 'short').toUpperCase();

  if (diffDays === 0) return event.is_all_day ? 'TODAY' : 'TONIGHT';
  if (diffDays === 1) return 'TOMORROW';

  const weekday = eventDate
    .toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long' })
    .toUpperCase();

  if (diffDays >= 2 && diffDays <= 7) return `THIS ${weekday}`;
  if (diffDays >= 8 && diffDays <= 14) return `NEXT ${weekday}`;

  return formatEventDateLabel(event, 'short').toUpperCase();
}

export default function UpcomingEventBanner() {
  const [event, setEvent] = useState<Event | null>(null);
  const [spots, setSpots] = useState<EventSpots | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const { data: nextEvent } = await supabase
        .from('events')
        .select('*')
        // ends_at, not date: keep showing a multi-day event while it runs.
        .gte('ends_at', new Date().toISOString())
        .order('date', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (cancelled) return;
      setEvent(nextEvent ?? null);

      if (nextEvent && !nextEvent.externally_managed) {
        try {
          const res = await fetch(`${WORKER_URL}/api/event-spots/${nextEvent.id}`);
          if (res.ok) {
            const data = (await res.json()) as EventSpots;
            if (typeof data?.capacity === 'number' && typeof data?.remaining === 'number') {
              if (!cancelled) setSpots(data);
            }
          }
        } catch {
          // network/worker failure: leave spots null; bar simply won't render
        }
      }
      if (!cancelled) setLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return null;

  if (!event) {
    return (
      <section
        className="w-full"
        style={{ background: '#FFD166', borderTop: '4px solid #1A1A1A', borderBottom: '4px solid #1A1A1A' }}
      >
        <div className="max-w-[1200px] mx-auto px-6 py-8 md:py-12 text-center md:text-left">
          <h2 className="font-heading font-bold text-3xl md:text-5xl" style={{ letterSpacing: '-1px' }}>
            No public sessions on the calendar right now.
          </h2>
          <p className="mt-3 text-[#1A1A1A]/80 text-base md:text-lg">
            We post the next one in the WhatsApp group first — drop in.
          </p>
          <a
            href={WHATSAPP_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-black no-underline mt-6 inline-block"
          >
            Join the WhatsApp →
          </a>
        </div>
      </section>
    );
  }

  const relativeDate = formatRelativeDate(event);
  const time = formatEventTimeLabel(event);

  const total = event.externally_managed ? 0 : (spots?.capacity ?? event.capacity);
  const remaining = event.externally_managed ? null : (spots?.remaining ?? null);
  const used = remaining !== null ? Math.max(0, total - remaining) : null;
  const fillPct = used !== null && total > 0 ? Math.min(100, (used / total) * 100) : 0;

  const soldOut = remaining === 0;
  const almostFull = remaining !== null && remaining > 0 && remaining <= 3;

  let spotsText: string | null = null;
  if (remaining !== null) {
    if (soldOut) spotsText = 'Event full';
    else if (almostFull) spotsText = `Almost full — ${remaining} ${remaining === 1 ? 'spot' : 'spots'} left`;
    else spotsText = `${remaining} of ${total} spots left`;
  }

  const barColor = soldOut || almostFull ? '#DC2626' : '#1A1A1A';

  return (
    <section
      className="w-full"
      style={{ background: '#FFD166', borderTop: '4px solid #1A1A1A', borderBottom: '4px solid #1A1A1A' }}
    >
      <div className="max-w-[1200px] mx-auto px-6 py-8 md:py-12">
        <div className="font-heading font-bold text-sm md:text-base tracking-wider">▸ {relativeDate}</div>
        <h2
          className="font-heading font-bold mt-1"
          style={{ fontSize: 'clamp(2rem, 5vw, 4rem)', letterSpacing: '-1px', lineHeight: 1.05 }}
        >
          {event.name}
        </h2>
        <p className="mt-3 text-[#1A1A1A]/80 text-base md:text-lg">
          {event.venue_area} · {time}
          {event.externally_managed ? ' · Registration managed by partner' : ` · ₹${event.price}`}
        </p>

        {spotsText !== null && (
          <div className="mt-5 max-w-md">
            <div
              role="progressbar"
              aria-valuenow={Math.round(fillPct)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={spotsText}
              className="w-full h-3 rounded-full overflow-hidden"
              style={{ border: '2px solid #1A1A1A', background: '#FFFFFF' }}
            >
              <div className="h-full" style={{ width: `${fillPct}%`, background: barColor, transition: 'width 0.3s' }} />
            </div>
            <p className="mt-2 text-sm font-semibold" style={{ color: barColor }}>
              {spotsText}
            </p>
          </div>
        )}

        <div className="mt-6 flex flex-wrap items-center gap-4">
          {event.externally_managed ? (
            event.external_registration_url ? (
              <a
                href={event.external_registration_url}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-black no-underline"
              >
                Register on partner site ↗
              </a>
            ) : (
              <span className="font-heading font-semibold">Registration link unavailable</span>
            )
          ) : (
            <a href={`/register?event=${event.id}`} className="btn btn-black no-underline">
              {soldOut ? 'Join waitlist →' : 'Register →'}
            </a>
          )}
          <a href="/calendar" className="text-sm font-semibold underline underline-offset-4">
            or see all upcoming →
          </a>
        </div>
      </div>
    </section>
  );
}
