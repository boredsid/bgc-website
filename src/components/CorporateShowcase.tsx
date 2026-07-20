import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { CorporateEvent } from '../lib/types';

// One fetch shared by both island placements on /corporate (module-level
// cache — both islands hydrate from the same bundle).
let cached: Promise<CorporateEvent[]> | null = null;

function loadCorporateEvents(): Promise<CorporateEvent[]> {
  if (!cached) {
    cached = supabase
      .from('corporate_events')
      .select('*')
      .order('event_date', { ascending: false })
      .then(({ data, error }) => {
        if (error) return [];
        return (data as CorporateEvent[]) || [];
      });
  }
  return cached;
}

function todayLocal(): string {
  return new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD
}

function monthYear(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString('en-IN', {
    month: 'short',
    year: 'numeric',
  });
}

function LogoTile({ event }: { event: CorporateEvent }) {
  return (
    <div
      className="logo-tile flex items-center justify-center bg-white px-5 py-4"
      style={{ border: 'var(--border)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-sm)', minHeight: '84px' }}
      title={event.company_name}
    >
      {event.logo_url ? (
        <img
          src={event.logo_url}
          alt={event.company_name}
          loading="lazy"
          className="max-h-12 max-w-full object-contain"
        />
      ) : (
        <span className="font-heading font-bold text-lg text-center leading-tight">
          {event.company_name}
        </span>
      )}
    </div>
  );
}

function LogoWall({ events }: { events: CorporateEvent[] }) {
  // One tile per company, newest first.
  const seen = new Set<string>();
  const companies = events.filter((e) => {
    const key = e.company_name.trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (companies.length === 0) return null;

  return (
    <section className="py-14 md:py-20">
      <div className="max-w-[1200px] mx-auto px-6">
        <span className="section-tag">The roster</span>
        <h2 className="font-heading font-bold" style={{ fontSize: 'clamp(1.8rem, 4vw, 2.8rem)', letterSpacing: '-1px' }}>
          Companies we've played with
        </h2>
        <div className="mt-8 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {companies.map((e) => (
            <LogoTile key={e.id} event={e} />
          ))}
        </div>
      </div>
      <style>{`
        .logo-tile img { filter: grayscale(1); opacity: 0.75; transition: filter 0.25s, opacity 0.25s; }
        .logo-tile:hover img { filter: grayscale(0); opacity: 1; }
        @media (prefers-reduced-motion: reduce) {
          .logo-tile img { transition: none; }
        }
      `}</style>
    </section>
  );
}

function PastEventCard({ event }: { event: CorporateEvent }) {
  return (
    <article
      className="bg-white p-6 flex flex-col gap-3"
      style={{ border: 'var(--border-thick)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-md)' }}
    >
      <div className="flex items-center gap-3">
        {event.logo_url && (
          <img
            src={event.logo_url}
            alt=""
            loading="lazy"
            className="h-8 w-auto max-w-[120px] object-contain shrink-0"
          />
        )}
        <div>
          <h3 className="font-heading font-bold text-xl leading-tight">{event.company_name}</h3>
          <div className="text-sm text-[#1A1A1A]/60 font-semibold">
            {event.title || 'Team game event'} · {monthYear(event.event_date)}
          </div>
        </div>
        {event.headcount && (
          <span className="pill pill-yellow ml-auto shrink-0 whitespace-nowrap">
            {event.headcount} players
          </span>
        )}
      </div>
      {event.description && <p className="text-[#1A1A1A]/80">{event.description}</p>}
      {event.testimonial && (
        <blockquote
          className="mt-auto px-4 py-3 font-semibold"
          style={{ background: '#FFD166', border: 'var(--border)', borderRadius: 'var(--radius-sm)' }}
        >
          “{event.testimonial}”
        </blockquote>
      )}
    </article>
  );
}

function EventsSection({ events }: { events: CorporateEvent[] }) {
  const today = todayLocal();
  const upcoming = events.filter((e) => e.event_date >= today).sort((a, b) => a.event_date.localeCompare(b.event_date));
  const past = events.filter((e) => e.event_date < today);
  if (events.length === 0) return null;

  return (
    <>
      {past.length > 0 && (
        <section className="py-14 md:py-20" style={{ background: '#FAFAF5' }}>
          <div className="max-w-[1200px] mx-auto px-6">
            <span className="section-tag">Track record</span>
            <h2 className="font-heading font-bold" style={{ fontSize: 'clamp(1.8rem, 4vw, 2.8rem)', letterSpacing: '-1px' }}>
              Recent corporate events
            </h2>
            <div className="mt-8 grid gap-6 md:grid-cols-2">
              {past.map((e) => (
                <PastEventCard key={e.id} event={e} />
              ))}
            </div>
          </div>
        </section>
      )}

      {upcoming.length > 0 && (
        <section className="py-10" style={{ background: '#1A1A1A' }}>
          <div className="max-w-[1200px] mx-auto px-6">
            <div className="font-heading font-semibold text-xs md:text-sm tracking-widest" style={{ color: '#FFD166' }}>
              ▸ ON THE CALENDAR
            </div>
            <ul className="mt-4 flex flex-wrap gap-x-8 gap-y-2 list-none m-0 p-0">
              {upcoming.map((e) => (
                <li key={e.id} className="text-white font-heading font-semibold text-lg">
                  {e.company_name}
                  <span className="text-white/50 font-normal text-base"> — {monthYear(e.event_date)}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}
    </>
  );
}

interface Props {
  section: 'logos' | 'events';
}

export default function CorporateShowcase({ section }: Props) {
  const [events, setEvents] = useState<CorporateEvent[]>([]);

  useEffect(() => {
    loadCorporateEvents().then(setEvents);
  }, []);

  return section === 'logos' ? <LogoWall events={events} /> : <EventsSection events={events} />;
}
