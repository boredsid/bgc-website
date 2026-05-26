import type { Env } from './index';

const DRIVE_API = 'https://www.googleapis.com/drive/v3/files';

async function driveList(query: string, env: Env): Promise<DriveFile[]> {
  const url =
    `${DRIVE_API}` +
    `?q=${encodeURIComponent(query)}` +
    `&fields=${encodeURIComponent('files(id,name)')}` +
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
  if (res.ok) ctx.waitUntil(cache.put(request, res.clone()));
  return res;
}

export interface DriveFile {
  id: string;
  name: string;
}

export interface EventFolder {
  folderId: string;
  title: string;
  date: string | null; // ISO YYYY-MM-DD, or null when the name has no parseable date
}

export interface EventPhoto {
  id: string;
  name: string;
  thumbUrl: string;
  viewUrl: string;
  downloadUrl: string;
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

export function buildEventList(files: DriveFile[]): EventFolder[] {
  return files
    .filter((f) => f.name.trim().toLowerCase() !== 'archive')
    .map(parseEventFolder)
    .sort((a, b) => {
      if (a.date && b.date) return b.date.localeCompare(a.date);
      if (a.date) return -1;
      if (b.date) return 1;
      return a.title.localeCompare(b.title);
    });
}

export function buildPhotoList(files: DriveFile[]): EventPhoto[] {
  return files.map((f) => ({
    id: f.id,
    name: f.name,
    thumbUrl: `https://drive.google.com/thumbnail?id=${f.id}&sz=w800`,
    viewUrl: `https://drive.google.com/file/d/${f.id}/view`,
    downloadUrl: `https://drive.google.com/uc?export=download&id=${f.id}`,
  }));
}

export async function handleEventPhotos(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  return withCache(request, ctx, async () => {
    const files = await driveList(
      `'${env.EVENT_PHOTOS_FOLDER_ID}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      env,
    );
    return jsonCached({ events: buildEventList(files) });
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
      `'${folderId}' in parents and mimeType contains 'image/' and trashed=false`,
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
  return withCache(request, ctx, async () => {
    const upstream = await fetch(`https://drive.google.com/thumbnail?id=${fileId}&sz=w1200`);
    if (!upstream.ok) {
      return new Response(JSON.stringify({ error: 'Image not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(upstream.body, {
      status: 200,
      headers: {
        'Content-Type': upstream.headers.get('Content-Type') ?? 'image/jpeg',
        'Cache-Control': 'public, max-age=600',
      },
    });
  });
}
