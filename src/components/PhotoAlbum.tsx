import { useEffect, useState } from 'react';
import { sharePhotoFile, canNativeShare, canShareUrl, shareUrlLink, copyLink } from '../lib/share';

const WORKER_URL = import.meta.env.PUBLIC_WORKER_URL;

interface Photo {
  id: string;
  name: string;
  kind: 'image' | 'video';
  thumbUrl: string;
  viewUrl: string;
  downloadUrl: string;
  previewUrl?: string;
}

interface Props {
  folderId: string;
  title: string;
  dateLabel: string;
  onBack: () => void;
}

export default function PhotoAlbum({ folderId, title, dateLabel, onBack }: Props) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [lightbox, setLightbox] = useState<Photo | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    (async () => {
      try {
        const res = await fetch(`${WORKER_URL}/api/event-photos/folder/${folderId}`);
        if (!res.ok) throw new Error('fetch failed');
        const data = (await res.json()) as { photos: Photo[] };
        if (!cancelled) setPhotos(data.photos);
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [folderId]);

  function flashCopied(ok: boolean) {
    setCopied(ok);
    setTimeout(() => setCopied(false), 2000);
  }

  async function onShare(photo: Photo) {
    const shared =
      photo.kind === 'video' ? await shareUrlLink(photo.viewUrl) : await sharePhotoFile(photo);
    if (!shared) flashCopied(await copyLink(photo.viewUrl));
  }

  return (
    <div>
      <button onClick={onBack} className="mb-6 font-heading font-semibold text-[#F47B20]">
        ← All events
      </button>
      <h2 className="font-heading font-bold text-3xl">{title}</h2>
      {dateLabel && <p className="text-[#1A1A1A]/60 mb-6">{dateLabel}</p>}

      {loading && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="aspect-square rounded-xl bg-black/5 animate-pulse" />
          ))}
        </div>
      )}

      {error && <p className="py-10 text-[#1A1A1A]/70">Couldn't load these photos. Try again later.</p>}

      {!loading && !error && photos.length === 0 && (
        <p className="py-10 text-[#1A1A1A]/70">No photos in this album yet.</p>
      )}

      {!loading && !error && photos.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {photos.map((p) => (
            <button
              key={p.id}
              onClick={() => setLightbox(p)}
              className="relative aspect-square overflow-hidden rounded-xl bg-black/5"
            >
              <img src={p.thumbUrl} alt={p.name} loading="lazy" className="w-full h-full object-cover" />
              {p.kind === 'video' && (
                <span className="absolute inset-0 flex items-center justify-center">
                  <span className="flex items-center justify-center w-12 h-12 rounded-full bg-black/55 text-white text-xl">
                    ▶
                  </span>
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {lightbox && (
        <div
          className="fixed inset-0 z-[100] bg-black/80 flex flex-col items-center justify-center p-4"
          onClick={() => setLightbox(null)}
        >
          {lightbox.kind === 'video' ? (
            <iframe
              src={lightbox.previewUrl}
              title={lightbox.name}
              allow="autoplay; fullscreen"
              allowFullScreen
              className="w-[90vw] max-w-[900px] aspect-video rounded-lg bg-black"
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <img
              src={lightbox.thumbUrl}
              alt={lightbox.name}
              className="max-h-[75vh] max-w-full rounded-lg"
              onClick={(e) => e.stopPropagation()}
            />
          )}
          <div className="flex flex-wrap gap-3 mt-4 justify-center" onClick={(e) => e.stopPropagation()}>
            {(lightbox.kind === 'video' ? canShareUrl() : canNativeShare()) && (
              <button onClick={() => onShare(lightbox)} className="btn btn-primary">
                Share
              </button>
            )}
            <a
              href={lightbox.downloadUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-secondary"
            >
              Download
            </a>
            <button onClick={async () => flashCopied(await copyLink(lightbox.viewUrl))} className="btn btn-secondary">
              {copied ? 'Copied!' : 'Copy link'}
            </button>
            <button onClick={() => setLightbox(null)} className="btn btn-black">
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
