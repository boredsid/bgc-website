const WORKER_URL = import.meta.env.PUBLIC_WORKER_URL;

// One entry on the Photos page: a Drive event folder, or a published event an
// admin attached a Google Photos album to. Mirrors EventAlbum in
// worker/src/event-photos.ts.
export type EventAlbum =
  | { source: 'drive'; folderId: string; title: string; date: string | null }
  | { source: 'google_photos'; eventId: string; title: string; date: string | null; albumUrl: string };

/** What `?event=` carries. Drive keeps the folder id so old shared links still open. */
export function albumId(album: EventAlbum): string {
  return album.source === 'google_photos' ? album.eventId : album.folderId;
}

export function albumPhotosUrl(album: EventAlbum): string {
  return album.source === 'google_photos'
    ? `${WORKER_URL}/api/event-photos/google/${album.eventId}`
    : `${WORKER_URL}/api/event-photos/folder/${album.folderId}`;
}

/** The picture on the album's card: its Google Photos cover, or the worker's pick from the Drive folder. */
export function albumCoverUrl(album: EventAlbum): string {
  return album.source === 'google_photos'
    ? `${WORKER_URL}/api/event-photos/cover/google/${album.eventId}`
    : `${WORKER_URL}/api/event-photos/cover/folder/${album.folderId}`;
}

/** The worker's copy of one image, which the browser may read to share as a file. */
export function shareableImageUrl(album: EventAlbum, photoId: string): string {
  return album.source === 'google_photos'
    ? `${WORKER_URL}/api/event-photos/google-image/${photoId}`
    : `${WORKER_URL}/api/event-photos/image/${photoId}`;
}
