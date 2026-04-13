import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Event } from '../lib/types';

const WORKER_URL = import.meta.env.PUBLIC_WORKER_URL;

interface EventWithSpots extends Event {
  remaining: number | null;
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

  if (loading) {
    return <div className="text-center py-12 text-muted">Loading events...</div>;
  }

  if (events.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-muted text-lg mb-4">No upcoming events right now.</p>
        <a
          href="https://instagram.com/boardgamecompany"
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:underline font-medium"
        >
          Follow us on Instagram to stay updated!
        </a>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {events.map((event) => {
        const eventDate = new Date(event.date);
        const day = eventDate.getDate();
        const month = eventDate.toLocaleDateString('en-IN', { month: 'short' }).toUpperCase();
        const weekday = eventDate.toLocaleDateString('en-IN', { weekday: 'long' });
        const time = eventDate.toLocaleTimeString('en-IN', {
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
        });
        const soldOut = event.remaining !== null && event.remaining <= 0;

        return (
          <div
            key={event.id}
            className="bg-white rounded-2xl border border-border p-5 flex gap-5 items-start"
          >
            <div className="text-center min-w-[60px]">
              <div className="text-xs font-bold text-primary uppercase">{month}</div>
              <div className="font-heading text-3xl font-bold leading-tight">{day}</div>
              <div className="text-xs text-muted">{weekday}</div>
            </div>

            <div className="flex-1">
              <h3 className="font-heading font-bold text-lg">{event.name}</h3>
              <p className="text-sm text-muted mt-1">
                {time} &middot; {event.venue_name}, {event.venue_area}
              </p>
              {event.description && (
                <p className="text-sm text-muted mt-2">{event.description}</p>
              )}
              <div className="flex items-center gap-3 mt-3">
                <span className="font-heading font-bold text-lg">₹{event.price}</span>
                {event.remaining !== null && !soldOut && (
                  <span className="text-xs text-muted">
                    {event.remaining} spot{event.remaining !== 1 ? 's' : ''} left
                  </span>
                )}
              </div>
            </div>

            <div className="flex-shrink-0 self-center">
              {soldOut ? (
                <span className="bg-gray-200 text-gray-500 px-4 py-2 rounded-full text-sm font-semibold">
                  Sold Out
                </span>
              ) : (
                <a
                  href={`/register?event=${event.id}`}
                  className="bg-primary text-white px-5 py-2.5 rounded-full font-heading font-semibold text-sm hover:bg-primary-dark transition-colors no-underline"
                >
                  Register
                </a>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
