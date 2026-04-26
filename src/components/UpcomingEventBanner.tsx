import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Event, EventSpots } from '../lib/types';

const WORKER_URL = import.meta.env.PUBLIC_WORKER_URL;
const WHATSAPP_URL = 'https://chat.whatsapp.com/GL1h4jipksfCW4vm7OtZjp';

function formatRelativeDate(eventDate: Date): string {
  const now = new Date();
  const diffMs = eventDate.getTime() - now.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const sameCalendarDay =
    eventDate.getFullYear() === now.getFullYear() &&
    eventDate.getMonth() === now.getMonth() &&
    eventDate.getDate() === now.getDate();

  if (sameCalendarDay) return 'TONIGHT';
  if (diffDays === 1 || (diffDays === 0 && eventDate > now)) return 'TOMORROW';

  const weekday = eventDate.toLocaleDateString('en-IN', { weekday: 'long' }).toUpperCase();

  if (diffDays >= 2 && diffDays <= 7) return `THIS ${weekday}`;
  if (diffDays >= 8 && diffDays <= 14) return `NEXT ${weekday}`;

  return eventDate
    .toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })
    .toUpperCase();
}

function formatTime(eventDate: Date): string {
  return eventDate.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
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
        .gte('date', new Date().toISOString())
        .order('date', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (cancelled) return;
      setEvent(nextEvent ?? null);

      if (nextEvent) {
        try {
          const res = await fetch(`${WORKER_URL}/api/event-spots/${nextEvent.id}`);
          if (res.ok) {
            const data = (await res.json()) as EventSpots;
            if (!cancelled) setSpots(data);
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

  const eventDate = new Date(event.date);
  const relativeDate = formatRelativeDate(eventDate);
  const time = formatTime(eventDate);

  const total = spots?.capacity ?? event.capacity;
  const remaining = spots?.remaining ?? null;
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
          {event.venue_area} · {time} · ₹{event.price}
        </p>

        {spotsText !== null && (
          <div className="mt-5 max-w-md">
            <div
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
          <a href={`/register?event=${event.id}`} className="btn btn-black no-underline">
            {soldOut ? 'Join waitlist →' : 'Register →'}
          </a>
          <a href="/calendar" className="text-sm font-semibold underline underline-offset-4">
            or see all upcoming →
          </a>
        </div>
      </div>
    </section>
  );
}
