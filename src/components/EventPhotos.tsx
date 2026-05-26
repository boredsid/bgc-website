import { useEffect, useState } from 'react';
import PhotoAlbum from './PhotoAlbum';

const WORKER_URL = import.meta.env.PUBLIC_WORKER_URL;
const PARENT_FOLDER_URL =
  'https://drive.google.com/drive/folders/11e-Aibjt3IztaW-Qd1BU24T-V1ECPXn-';

interface EventFolder {
  folderId: string;
  title: string;
  date: string | null;
}

function formatDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
}

export default function EventPhotos() {
  const [events, setEvents] = useState<EventFolder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [active, setActive] = useState<EventFolder | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${WORKER_URL}/api/event-photos`);
        if (!res.ok) throw new Error('fetch failed');
        const data = (await res.json()) as { events: EventFolder[] };
        if (!cancelled) setEvents(data.events);
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Keep the open album in sync with ?event= (supports deep links + back/forward).
  useEffect(() => {
    function syncFromUrl() {
      const id = new URLSearchParams(window.location.search).get('event');
      setActive(id ? events.find((e) => e.folderId === id) ?? null : null);
    }
    syncFromUrl();
    window.addEventListener('popstate', syncFromUrl);
    return () => window.removeEventListener('popstate', syncFromUrl);
  }, [events]);

  function openEvent(ev: EventFolder) {
    const url = new URL(window.location.href);
    url.searchParams.set('event', ev.folderId);
    window.history.pushState({}, '', url);
    setActive(ev);
  }

  function closeEvent() {
    const url = new URL(window.location.href);
    url.searchParams.delete('event');
    window.history.pushState({}, '', url);
    setActive(null);
  }

  if (active) {
    return (
      <PhotoAlbum
        folderId={active.folderId}
        title={active.title}
        dateLabel={formatDate(active.date)}
        onBack={closeEvent}
      />
    );
  }

  if (loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="rounded-2xl bg-black/5 animate-pulse" style={{ height: 180 }} />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-16">
        <p className="text-lg text-[#1A1A1A]/70 mb-4">Couldn't load photos right now.</p>
        <a href={PARENT_FOLDER_URL} target="_blank" rel="noopener noreferrer" className="btn btn-primary">
          Browse on Google Drive
        </a>
      </div>
    );
  }

  if (events.length === 0) {
    return <p className="text-center py-16 text-lg text-[#1A1A1A]/70">Event photos coming soon.</p>;
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
      {events.map((ev) => (
        <button
          key={ev.folderId}
          onClick={() => openEvent(ev)}
          className="text-left rounded-2xl p-6 transition-transform hover:-translate-y-1"
          style={{
            background: 'linear-gradient(135deg, #F47B20 0%, #FFD166 100%)',
            border: 'var(--border)',
            minHeight: 180,
          }}
        >
          <span className="block font-heading font-bold text-2xl text-[#1A1A1A]">{ev.title}</span>
          {ev.date && (
            <span className="block mt-2 font-semibold text-[#1A1A1A]/70">{formatDate(ev.date)}</span>
          )}
        </button>
      ))}
    </div>
  );
}
