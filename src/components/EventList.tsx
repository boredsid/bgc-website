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

function groupByMonth(events: EventWithSpots[]) {
  const grouped = new Map<string, EventWithSpots[]>();
  for (const e of events) {
    const key = monthKey(new Date(e.date));
    const arr = grouped.get(key) ?? [];
    arr.push(e);
    grouped.set(key, arr);
  }
  return grouped;
}

export default function EventList() {
  const [events, setEvents] = useState<EventWithSpots[]>([]);
  const [loading, setLoading] = useState(true);
  const [pastEvents, setPastEvents] = useState<Event[] | null>(null);
  const [pastLoading, setPastLoading] = useState(false);
  const [showPast, setShowPast] = useState(false);

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

  async function togglePast() {
    if (showPast) {
      setShowPast(false);
      return;
    }
    setShowPast(true);
    if (pastEvents === null) {
      setPastLoading(true);
      const { data } = await supabase
        .from('events')
        .select('*')
        .lt('date', new Date().toISOString())
        .order('date', { ascending: false });
      setPastEvents(data ?? []);
      setPastLoading(false);
    }
  }

  const grouped = groupByMonth(events);
  const pastGrouped = pastEvents ? groupByMonth(pastEvents.map((e) => ({ ...e, remaining: null }))) : null;

  return (
    <div className="flex flex-col gap-12">
      {loading ? (
        <div className="text-center py-16 text-[#1A1A1A]/60 font-heading">Loading sessions...</div>
      ) : events.length === 0 ? (
        <div className="text-center py-20">
          <div className="text-6xl mb-4">🎲</div>
          <p className="font-heading text-lg text-[#1A1A1A]/70 mb-4">No upcoming sessions yet — check back soon!</p>
          <a href="https://instagram.com/boardgamecompany" target="_blank" rel="noopener noreferrer" className="font-heading font-semibold text-[#F47B20] no-underline">
            Follow us on Instagram →
          </a>
        </div>
      ) : (
        Array.from(grouped.entries()).map(([month, monthEvents]) => (
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
        ))
      )}

      <div className="flex justify-center pt-4">
        <button onClick={togglePast} className="btn btn-secondary no-underline" type="button">
          {showPast ? 'Hide past events' : 'Show past events'}
        </button>
      </div>

      {showPast && (
        <div className="flex flex-col gap-12">
          {pastLoading && (
            <div className="text-center py-10 text-[#1A1A1A]/60 font-heading">Loading past sessions...</div>
          )}
          {!pastLoading && pastGrouped && pastGrouped.size === 0 && (
            <div className="text-center py-10 text-[#1A1A1A]/60 font-heading">No past sessions on record.</div>
          )}
          {!pastLoading && pastGrouped && Array.from(pastGrouped.entries()).map(([month, monthEvents]) => (
            <section key={month}>
              <div className="mb-6">
                <span className="pill inline-block" style={{ fontSize: '1.1rem', padding: '10px 22px', border: '4px solid #1A1A1A', boxShadow: '4px 4px 0 #1A1A1A', background: '#E5E5E5', color: '#1A1A1A' }}>
                  {month}
                </span>
              </div>
              <div className="grid gap-5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
                {monthEvents.map((event) => (
                  <EventCard key={event.id} event={event} past />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function EventCard({ event, past = false }: { event: EventWithSpots; past?: boolean }) {
  const eventDate = new Date(event.date);
  const dateStr = eventDate.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
  const time = eventDate.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
  const soldOut = event.remaining !== null && event.remaining <= 0;
  const featured = !past && (event as any).is_featured === true;

  return (
    <div
      className={`card-brutal flex flex-col overflow-hidden ${featured ? 'md:col-span-full' : ''}`}
      style={{ background: past ? '#F5F1EA' : '#FFFFFF', opacity: past ? 0.85 : 1 }}
    >
      <div
        className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5"
        style={{ background: featured ? '#FFD166' : past ? '#F5F1EA' : '#FFFFFF', borderBottom: '4px solid #1A1A1A' }}
      >
        <span className="font-heading font-bold text-base">{dateStr}</span>
        {featured && <span className="pill pill-black" style={{ fontSize: '0.7rem', padding: '6px 12px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Featured</span>}
        {past && <span className="pill" style={{ fontSize: '0.7rem', padding: '6px 12px', textTransform: 'uppercase', letterSpacing: '0.08em', background: '#E5E5E5', color: '#1A1A1A', border: '2px solid #1A1A1A' }}>Past</span>}
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
        {!past && (
          <>
            <div className="flex items-center gap-3 mt-2">
              <span className="font-heading font-bold text-xl">₹{event.price}</span>
              {event.remaining !== null && !soldOut && (
                <span className="text-xs text-[#1A1A1A]/60">
                  {event.remaining} spot{event.remaining !== 1 ? 's' : ''} left
                </span>
              )}
            </div>
            {event.price_includes && (
              <div className="card-brutal px-3 py-2 text-sm mt-2 font-heading font-semibold" style={{ background: '#FFD166', boxShadow: '3px 3px 0 #1A1A1A' }}>
                {event.price_includes}
              </div>
            )}
            <div className="mt-3">
              {soldOut ? (
                <span className="pill" style={{ background: '#E5E5E5', color: '#1A1A1A', border: '2px solid #1A1A1A' }}>Sold Out</span>
              ) : (
                <a href={`/register?event=${event.id}`} className="btn btn-primary btn-sm no-underline">Register →</a>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
