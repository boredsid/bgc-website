import type { Env } from './index';
import { getSupabase } from './supabase';
import { currentBangaloreDate } from './finance-date';
import { fetchGoogleAlbum, fetchGoogleAlbumCover, isValidMediaToken, type GoogleAlbum } from './google-photos';

const DRIVE_API = 'https://www.googleapis.com/drive/v3/files';

async function driveList(query: string, env: Env, fields = 'files(id,name,mimeType)'): Promise<DriveFile[]> {
  const url =
    `${DRIVE_API}` +
    `?q=${encodeURIComponent(query)}` +
    `&fields=${encodeURIComponent(fields)}` +
    `&orderBy=name` +
    `&pageSize=1000` +
    `&key=${encodeURIComponent(env.DRIVE_API_KEY)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Drive API ${res.status}`);
  const data = (await res.json()) as { files?: DriveFile[] };
  return data.files ?? [];
}

function jsonCached(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=600' },
  });
}

function badRequest(message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 400,
    headers: { 'Content-Type': 'application/json' },
  });
}

function notFound(message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 404,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Edge-cache GET responses for ~10 min. `caches` is absent under Vitest, so it
// falls through to building the response directly there.
async function withCache(
  request: Request,
  ctx: ExecutionContext,
  build: () => Promise<Response>,
): Promise<Response> {
  const cache = (globalThis as { caches?: { default: Cache } }).caches?.default;
  if (!cache) return build();
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await build();
  if (res.ok && res.headers.get('Cache-Control') !== 'no-store') ctx.waitUntil(cache.put(request, res.clone()));
  return res;
}

export interface DriveFile {
  id: string;
  name: string;
  mimeType?: string;
  // Only asked for when picking a cover. `time` is EXIF-style "YYYY:MM:DD HH:MM:SS".
  imageMediaMetadata?: { width?: number; height?: number; rotation?: number; time?: string };
}

export interface EventFolder {
  folderId: string;
  title: string;
  date: string | null; // ISO YYYY-MM-DD, or null when the name has no parseable date
}

// An event whose admin set a Google Photos album link. Keyed by the event's id,
// since the album has no folder; `folderId` stays Drive-only so pages built
// against the Drive-only list keep working.
export interface GooglePhotosAlbum {
  source: 'google_photos';
  eventId: string;
  title: string;
  date: string | null;
  albumUrl: string;
}

export type EventAlbum = (EventFolder & { source: 'drive' }) | GooglePhotosAlbum;

export interface EventPhoto {
  id: string;
  name: string;
  kind: 'image' | 'video';
  thumbUrl: string;
  viewUrl: string;
  downloadUrl: string;
  previewUrl?: string; // present only when kind === 'video'
}

// Drive IDs are URL-safe strings; reject anything with path/illegal chars.
const DRIVE_ID_RE = /^[A-Za-z0-9_-]{10,}$/;

export function isValidDriveId(id: string): boolean {
  return DRIVE_ID_RE.test(id);
}

// "Event Name 5/24/2026" -> { title: "Event Name", date: "2026-05-24" }
export function parseEventFolder(file: DriveFile): EventFolder {
  const m = file.name.match(/^(.*\S)\s+(\d{1,2})\/(\d{1,2})\/(\d{4})\s*$/);
  if (!m) {
    return { folderId: file.id, title: file.name.trim(), date: null };
  }
  const [, title, mm, dd, yyyy] = m;
  const month = mm.padStart(2, '0');
  const day = dd.padStart(2, '0');
  return { folderId: file.id, title: title.trim(), date: `${yyyy}-${month}-${day}` };
}

// Newest first, undated last (alphabetical among themselves).
function newestFirst(a: { title: string; date: string | null }, b: { title: string; date: string | null }): number {
  if (a.date && b.date) return b.date.localeCompare(a.date);
  if (a.date) return -1;
  if (b.date) return 1;
  return a.title.localeCompare(b.title);
}

export function buildEventList(files: DriveFile[]): EventFolder[] {
  return files
    .filter((f) => f.name.trim().toLowerCase() !== 'archive')
    .map(parseEventFolder)
    .sort(newestFirst);
}

export interface PhotoAlbumEvent {
  id: string;
  name: string;
  date: string;
  google_photos_url: string;
}

export function buildAlbumList(folders: EventFolder[], events: PhotoAlbumEvent[]): EventAlbum[] {
  const google: GooglePhotosAlbum[] = events.map((e) => ({
    source: 'google_photos',
    eventId: e.id,
    title: e.name,
    date: Number.isNaN(Date.parse(e.date)) ? null : currentBangaloreDate(new Date(e.date)),
    albumUrl: e.google_photos_url,
  }));
  return [...folders.map((f) => ({ source: 'drive' as const, ...f })), ...google].sort(newestFirst);
}

export function buildPhotoList(files: DriveFile[]): EventPhoto[] {
  return files.map((f) => {
    const kind: 'image' | 'video' = f.mimeType?.startsWith('video/') ? 'video' : 'image';
    const item: EventPhoto = {
      id: f.id,
      name: f.name,
      kind,
      thumbUrl: `https://drive.google.com/thumbnail?id=${f.id}&sz=w800`,
      viewUrl: `https://drive.google.com/file/d/${f.id}/view`,
      downloadUrl: `https://drive.google.com/uc?export=download&id=${f.id}`,
    };
    if (kind === 'video') {
      item.previewUrl = `https://drive.google.com/file/d/${f.id}/preview`;
    }
    return item;
  });
}

// Drive stores the camera's pixels and reports the EXIF turn separately.
function isLandscape(file: DriveFile): boolean {
  const m = file.imageMediaMetadata;
  if (!m?.width || !m?.height) return false;
  const quarterTurn = m.rotation === 1 || m.rotation === 3;
  return quarterTurn ? m.height > m.width : m.width > m.height;
}

// Untimed photos go last, in the name order Drive listed them in.
function byCaptureTime(a: DriveFile, b: DriveFile): number {
  return (a.imageMediaMetadata?.time ?? '~').localeCompare(b.imageMediaMetadata?.time ?? '~');
}

/**
 * The photo on a Drive album's card. A photo whose name starts with "cover" is
 * the organiser's pick. Otherwise a landscape shot from the middle of the
 * event: the first frames tend to be empty tables, and by halfway the room is
 * full and the games are going. An album of only videos gets a video's frame.
 */
export function pickDriveCover(files: DriveFile[]): DriveFile | null {
  const images = files.filter((f) => !f.mimeType || f.mimeType.startsWith('image/'));
  if (images.length === 0) return files[0] ?? null;
  const chosen = images.find((f) => /^cover(?![a-z])/i.test(f.name));
  if (chosen) return chosen;
  const landscape = images.filter(isLandscape);
  const pool = [...(landscape.length > 0 ? landscape : images)].sort(byCaptureTime);
  return pool[Math.floor(pool.length / 2)];
}

export function buildGooglePhotoList(album: GoogleAlbum): EventPhoto[] {
  return album.items.map((item, i) => ({
    id: item.token,
    name: `bgc-${item.isVideo ? 'video' : 'photo'}-${i + 1}.${item.isVideo ? 'mp4' : 'jpg'}`,
    kind: item.isVideo ? 'video' : 'image',
    thumbUrl: `${item.baseUrl}=w800`,
    viewUrl: `https://photos.google.com/share/${album.albumKey}/photo/${item.mediaKey}?key=${album.authKey}`,
    downloadUrl: `${item.baseUrl}=${item.isVideo ? 'dv' : 'd'}`,
  }));
}

// Null when the lookup fails, so a database problem only hides the Google
// Photos albums instead of taking the Drive ones down with them.
async function listGooglePhotosEvents(env: Env): Promise<PhotoAlbumEvent[] | null> {
  try {
    const { data, error } = await getSupabase(env)
      .from('events')
      .select('id, name, date, google_photos_url')
      .eq('is_published', true)
      .not('google_photos_url', 'is', null);
    return error ? null : ((data ?? []) as PhotoAlbumEvent[]);
  } catch {
    return null;
  }
}

export async function handleEventPhotos(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  return withCache(request, ctx, async () => {
    const [files, events] = await Promise.all([
      driveList(
        `'${env.EVENT_PHOTOS_FOLDER_ID}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
        env,
      ),
      listGooglePhotosEvents(env),
    ]);
    const body = { events: buildAlbumList(buildEventList(files), events ?? []) };
    if (events) return jsonCached(body);
    // Serve the Drive albums now, but don't cache a list that's missing some.
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function publishedAlbumUrl(eventId: string, env: Env): Promise<string | null> {
  const { data: event, error } = await getSupabase(env)
    .from('events')
    .select('google_photos_url')
    .eq('id', eventId)
    .eq('is_published', true)
    .maybeSingle();
  if (error) throw new Error(`Supabase ${error.message}`);
  return (event as { google_photos_url: string | null } | null)?.google_photos_url ?? null;
}

// `complete` is false when only part of a large album could be read; the page
// then shows what it has and links to the album for the rest. A 502 means the
// album couldn't be read at all, and the page falls back to the link alone.
export async function handleGooglePhotosAlbum(
  eventId: string,
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  if (!UUID_RE.test(eventId)) return badRequest('Invalid event ID');
  return withCache(request, ctx, async () => {
    const albumUrl = await publishedAlbumUrl(eventId, env);
    if (!albumUrl) return notFound('Album not found');
    const album = await fetchGoogleAlbum(albumUrl).catch(() => null);
    if (!album) {
      return new Response(JSON.stringify({ error: 'Could not read the album', albumUrl }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return jsonCached({ photos: buildGooglePhotoList(album), albumUrl, complete: album.complete });
  });
}

export async function handleEventPhotosFolder(
  folderId: string,
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  if (!isValidDriveId(folderId)) return badRequest('Invalid folder ID');
  return withCache(request, ctx, async () => {
    const files = await driveList(
      `'${folderId}' in parents and (mimeType contains 'image/' or mimeType contains 'video/') and trashed=false`,
      env,
    );
    return jsonCached({ photos: buildPhotoList(files) });
  });
}

export async function handleEventPhotoImage(
  fileId: string,
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  if (!isValidDriveId(fileId)) return badRequest('Invalid file ID');
  return withCache(request, ctx, () => proxyImage(`https://drive.google.com/thumbnail?id=${fileId}&sz=w1200`));
}

// Google Photos serves images without CORS headers, so sharing one as a file
// goes through here just like a Drive image. Only lh3 shared-album paths are
// fetched, so this can't be pointed at an arbitrary URL.
export async function handleGooglePhotoImage(
  token: string,
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  if (!isValidMediaToken(token)) return badRequest('Invalid image ID');
  return withCache(request, ctx, () => proxyImage(`https://lh3.googleusercontent.com/pw/${token}=w1200`));
}

// The picture on an album's card. Served as image bytes so the card can use it
// as a plain <img src>; a 404 leaves the card on its plain colour.
export async function handleDriveCover(
  folderId: string,
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  if (!isValidDriveId(folderId)) return badRequest('Invalid folder ID');
  return withCache(request, ctx, async () => {
    const files = await driveList(
      `'${folderId}' in parents and (mimeType contains 'image/' or mimeType contains 'video/') and trashed=false`,
      env,
      'files(id,name,mimeType,imageMediaMetadata(width,height,rotation,time))',
    );
    const cover = pickDriveCover(files);
    if (!cover) return notFound('No photos in this album');
    return proxyImage(`https://drive.google.com/thumbnail?id=${cover.id}&sz=w800`);
  });
}

export async function handleGooglePhotosCover(
  eventId: string,
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  if (!UUID_RE.test(eventId)) return badRequest('Invalid event ID');
  return withCache(request, ctx, async () => {
    const albumUrl = await publishedAlbumUrl(eventId, env);
    const token = albumUrl ? await fetchGoogleAlbumCover(albumUrl).catch(() => null) : null;
    if (!token) return notFound('No cover for this album');
    return proxyImage(`https://lh3.googleusercontent.com/pw/${token}=w800`);
  });
}

async function proxyImage(upstreamUrl: string): Promise<Response> {
  const upstream = await fetch(upstreamUrl);
  if (!upstream.ok) return notFound('Image not found');
  return new Response(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': upstream.headers.get('Content-Type') ?? 'image/jpeg',
      'Cache-Control': 'public, max-age=600',
    },
  });
}
