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
  const dateStr = eventDate.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
  const timeStr = eventDate.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });

  return (
    <div
      className="flex flex-col sm:flex-row items-stretch rounded-2xl overflow-hidden"
      style={{ border: '4px solid #1A1A1A', boxShadow: '6px 6px 0 #1A1A1A', background: '#FFFFFF' }}
    >
      <div className="sm:w-[12px] h-[6px] sm:h-auto" style={{ background: '#F47B20' }} />
      <div className="flex-1 flex flex-col sm:flex-row items-start sm:items-center gap-4 p-5 sm:p-6">
        <div className="flex-1">
          <span className="pill pill-black mb-2 inline-block">{dateStr.toUpperCase()}</span>
          <h3 className="font-heading font-bold text-xl mt-1">{event.name}</h3>
          <p className="text-[#1A1A1A]/70 text-sm mt-1">
            {timeStr} · {event.venue_name}, {event.venue_area} · ₹{event.price}
          </p>
        </div>
        <a href={`/register?event=${event.id}`} className="btn btn-primary btn-sm no-underline whitespace-nowrap">
          Register →
        </a>
      </div>
    </div>
  );
}
