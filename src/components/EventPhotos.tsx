import { useEffect, useState } from 'react';
import PhotoAlbum from './PhotoAlbum';
import { albumCoverUrl, albumId, type EventAlbum } from '../lib/photo-albums';

const WORKER_URL = import.meta.env.PUBLIC_WORKER_URL;
const PARENT_FOLDER_URL =
  'https://drive.google.com/drive/folders/11e-Aibjt3IztaW-Qd1BU24T-V1ECPXn-';

function formatDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
}

const CARD_GRADIENT = 'linear-gradient(135deg, #F47B20 0%, #FFD166 100%)';

function AlbumCard({ album, onOpen }: { album: EventAlbum; onOpen: () => void }) {
  // Until the cover arrives the photo side shows the card's own gradient, and
  // it stays that way if the album has no photo to show.
  const [cover, setCover] = useState<'loading' | 'loaded' | 'missing'>('loading');

  return (
    <button
      onClick={onOpen}
      className="group flex text-left rounded-2xl overflow-hidden transition-transform hover:-translate-y-1"
      style={{ border: 'var(--border)', minHeight: 180, background: '#FFFFFF' }}
    >
      <div
        className="relative w-[42%] shrink-0 overflow-hidden"
        style={{ background: CARD_GRADIENT, borderRight: 'var(--border)' }}
      >
        {cover !== 'missing' && (
          <img
            src={albumCoverUrl(album)}
            alt=""
            loading="lazy"
            onLoad={() => setCover('loaded')}
            onError={() => setCover('missing')}
            className="absolute inset-0 w-full h-full object-cover transition duration-300 group-hover:scale-105"
            style={{ opacity: cover === 'loaded' ? 1 : 0 }}
          />
        )}
      </div>
      <div className="flex-1 min-w-0 p-5 flex flex-col">
        <span className="block font-heading font-bold text-xl sm:text-2xl leading-tight text-[#1A1A1A]">
          {album.title}
        </span>
        {album.date && (
          <span className="block mt-2 font-semibold text-[#1A1A1A]/70">{formatDate(album.date)}</span>
        )}
        <span className="mt-auto pt-4 font-heading font-semibold text-sm text-[#F47B20]">
          View photos →
        </span>
      </div>
    </button>
  );
}

export default function EventPhotos() {
  const [events, setEvents] = useState<EventAlbum[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [active, setActive] = useState<EventAlbum | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${WORKER_URL}/api/event-photos`);
        if (!res.ok) throw new Error('fetch failed');
        const data = (await res.json()) as { events: EventAlbum[] };
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
      setActive(id ? events.find((e) => albumId(e) === id) ?? null : null);
    }
    syncFromUrl();
    window.addEventListener('popstate', syncFromUrl);
    return () => window.removeEventListener('popstate', syncFromUrl);
  }, [events]);

  function openEvent(ev: EventAlbum) {
    const url = new URL(window.location.href);
    url.searchParams.set('event', albumId(ev));
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
        album={active}
        title={active.title}
        dateLabel={formatDate(active.date)}
        onBack={closeEvent}
      />
    );
  }

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
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
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {events.map((ev) => (
        <AlbumCard key={albumId(ev)} album={ev} onOpen={() => openEvent(ev)} />
      ))}
    </div>
  );
}
