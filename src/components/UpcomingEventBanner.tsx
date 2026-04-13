import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Event } from '../lib/types';

export default function UpcomingEventBanner() {
  const [event, setEvent] = useState<Event | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchNext() {
      const { data } = await supabase
        .from('events')
        .select('*')
        .gte('date', new Date().toISOString())
        .order('date', { ascending: true })
        .limit(1)
        .single();

      setEvent(data);
      setLoading(false);
    }
    fetchNext();
  }, []);

  if (loading || !event) return null;

  const eventDate = new Date(event.date);
  const dateStr = eventDate.toLocaleDateString('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  const timeStr = eventDate.toLocaleTimeString('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  return (
    <div className="bg-highlight/30 border border-highlight rounded-2xl p-6 flex flex-col sm:flex-row items-start sm:items-center gap-4">
      <div className="flex-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-primary mb-1">
          Next Event
        </p>
        <h3 className="font-heading font-bold text-xl">{event.name}</h3>
        <p className="text-muted text-sm mt-1">
          {dateStr} at {timeStr} &middot; {event.venue_name}, {event.venue_area} &middot; ₹{event.price}
        </p>
      </div>
      <a
        href={`/register?event=${event.id}`}
        className="bg-primary text-white px-5 py-2.5 rounded-full font-heading font-semibold text-sm hover:bg-primary-dark transition-colors no-underline whitespace-nowrap"
      >
        Register
      </a>
    </div>
  );
}
