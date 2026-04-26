import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Event } from '../lib/types';

const WORKER_URL = import.meta.env.PUBLIC_WORKER_URL;

interface EventWithSpots extends Event {
  remaining: number | null;
}

function monthKey(date: Date) {
  return date.toLocaleDateString('en-IN', { year: 'numeric', month: 'long' });
}

export default function EventList() {
  const [events, setEvents] = useState<EventWithSpots[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchEvents() {
      const { data } = await supabase
        .from('events')
        .select('*')
        .gte('date', new Date().toISOString())
        .order('date', { ascending: true });

      if (!data || data.length === 0) {
        setEvents([]);
        setLoading(false);
        return;
      }

      const eventsWithSpots = await Promise.all(
        data.map(async (event: Event) => {
          try {
            const res = await fetch(`${WORKER_URL}/api/event-spots/${event.id}`);
            const spots = await res.json();
            return { ...event, remaining: spots.remaining };
          } catch {
            return { ...event, remaining: null };
          }
        })
      );

      setEvents(eventsWithSpots);
      setLoading(false);
    }
    fetchEvents();
  }, []);

  if (loading) return <div className="text-center py-16 text-[#1A1A1A]/60 font-heading">Loading sessions...</div>;

  if (events.length === 0) {
    return (
      <div className="text-center py-20">
        <div className="text-6xl mb-4">🎲</div>
        <p className="font-heading text-lg text-[#1A1A1A]/70 mb-4">No upcoming sessions yet — check back soon!</p>
        <a href="https://instagram.com/boardgamecompany" target="_blank" rel="noopener noreferrer" className="font-heading font-semibold text-[#F47B20] no-underline">
          Follow us on Instagram →
        </a>
      </div>
    );
  }

  const grouped = new Map<string, EventWithSpots[]>();
  for (const e of events) {
    const key = monthKey(new Date(e.date));
    const arr = grouped.get(key) ?? [];
    arr.push(e);
    grouped.set(key, arr);
  }

  return (
    <div className="flex flex-col gap-12">
      {Array.from(grouped.entries()).map(([month, monthEvents]) => (
        <section key={month}>
          <div className="mb-6">
            <span className="pill pill-accent inline-block" style={{ fontSize: '1.1rem', padding: '10px 22px', border: '4px solid #1A1A1A', boxShadow: '4px 4px 0 #1A1A1A' }}>
              {month}
            </span>
          </div>
          <div className="grid gap-5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
            {monthEvents.map((event) => (
              <EventCard key={event.id} event={event} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function EventCard({ event }: { event: EventWithSpots }) {
  const eventDate = new Date(event.date);
  const dateStr = eventDate.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
  const time = eventDate.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
  const soldOut = event.remaining !== null && event.remaining <= 0;
  const featured = (event as any).is_featured === true;

  return (
    <div
      className={`card-brutal flex flex-col overflow-hidden ${featured ? 'md:col-span-full' : ''}`}
      style={{ background: '#FFFFFF' }}
    >
      <div
        className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5"
        style={{ background: featured ? '#FFD166' : '#FFFFFF', borderBottom: '4px solid #1A1A1A' }}
      >
        <span className="font-heading font-bold text-base">{dateStr}</span>
        {featured && <span className="pill pill-black" style={{ fontSize: '0.7rem', padding: '6px 12px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Featured</span>}
      </div>
      <div className="flex-1 flex flex-col gap-2.5 px-5 pt-5 pb-5">
        <h3 className="font-heading font-bold text-lg leading-tight">{event.name}</h3>
        <p className="text-sm text-[#1A1A1A]/70 leading-snug">
          📍 {event.venue_name}, {event.venue_area}
        </p>
        <p className="text-sm text-[#1A1A1A]/70">🕐 {time}</p>
        {event.description && (
          <p className="text-sm text-[#1A1A1A]/70 leading-relaxed">{event.description}</p>
        )}
        <div className="flex items-center gap-3 mt-2">
          <span className="font-heading font-bold text-xl">₹{event.price}</span>
          {event.remaining !== null && !soldOut && (
            <span className="text-xs text-[#1A1A1A]/60">
              {event.remaining} spot{event.remaining !== 1 ? 's' : ''} left
            </span>
          )}
        </div>
        <div className="mt-3">
          {soldOut ? (
            <span className="pill" style={{ background: '#E5E5E5', color: '#1A1A1A', border: '2px solid #1A1A1A' }}>Sold Out</span>
          ) : (
            <a href={`/register?event=${event.id}`} className="btn btn-primary btn-sm no-underline">Register →</a>
          )}
        </div>
      </div>
    </div>
  );
}
