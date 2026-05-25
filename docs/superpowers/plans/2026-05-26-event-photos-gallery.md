# Past Event Photos Gallery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/photos` page that shows photos from past events (pulled live from one Google Drive folder, one subfolder per event) with native previews and share-to-social actions.

**Architecture:** A Cloudflare Worker proxies the Google Drive API (key kept as a worker secret) via three public GET endpoints: list event folders, list a folder's images, and a CORS image proxy for Web Share. The public Astro site adds a static `/photos` page hosting a React island that fetches those endpoints at runtime, renders an event grid → album → lightbox, and shares photos through the device's native share sheet.

**Tech Stack:** Cloudflare Workers (TypeScript, Vitest), Astro 5 + React 19 islands, Tailwind utility classes + existing global.css tokens, Google Drive API v3.

---

## Context for the implementer

- The worker is a flat `if/else` router in `worker/src/index.ts`. Public endpoints live in the top `if/else` chain (see `/api/event-spots/`). CORS headers from `corsHeaders(origin)` are merged onto **every** handler response at the end of the `fetch` handler (lines ~285-289), so individual handlers do **not** set CORS themselves.
- Worker tests use Vitest (`cd worker && npm test`), pattern `vi.mock` / `vi.fn` (see `worker/src/cancel.test.ts`). The Drive calls use the global `fetch`, mocked with `vi.stubGlobal('fetch', ...)`.
- React islands read the worker base URL via `const WORKER_URL = import.meta.env.PUBLIC_WORKER_URL;` (see `src/components/EventList.tsx`).
- The **public site has no JS test runner** — frontend tasks are verified with `npm run build` (from repo root) plus a manual browser check via `npm run dev`.
- Button classes available in `src/styles/global.css`: base `.btn` plus `.btn-primary`, `.btn-secondary`, `.btn-black`, `.btn-nav`. There is **no** `.btn-outline`. `.section-tag` and the `--border` token exist.
- Parent Drive folder ID: `11e-Aibjt3IztaW-Qd1BU24T-V1ECPXn-`.
- All worker code is on branch `feat/event-photos-gallery` (already created).

## File structure

| File | Responsibility |
|---|---|
| `worker/src/event-photos.ts` (create) | Drive helpers (pure parse/build), `driveList`, `withCache`, and the 3 handlers |
| `worker/src/event-photos.test.ts` (create) | Vitest for pure helpers + handlers (Drive `fetch` mocked) |
| `worker/src/index.ts` (modify) | `Env` fields, imports, 3 routes in the public chain |
| `worker/wrangler.toml` (modify) | `EVENT_PHOTOS_FOLDER_ID` var |
| `src/lib/share.ts` (create) | Web Share helper + copy-link helper |
| `src/components/PhotoAlbum.tsx` (create) | Album image grid + lightbox + share/download/copy actions |
| `src/components/EventPhotos.tsx` (create) | Event grid, event-list fetch, `?event=` URL state, album switch |
| `src/pages/photos.astro` (create) | Static page shell + hero + island mount |
| `src/components/Nav.astro` (modify) | Add "Photos" nav link |

---

## Task 1: Worker — pure Drive helpers (TDD)

**Files:**
- Create: `worker/src/event-photos.ts`
- Test: `worker/src/event-photos.test.ts`

- [ ] **Step 1: Write the failing test**

Create `worker/src/event-photos.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  parseEventFolder,
  buildEventList,
  buildPhotoList,
  isValidDriveId,
} from './event-photos';

describe('parseEventFolder', () => {
  it('parses a trailing M/D/YYYY date into title + ISO date', () => {
    expect(
      parseEventFolder({ id: 'a', name: 'Story Mode: Blood on the Clocktower 5/24/2026' }),
    ).toEqual({ folderId: 'a', title: 'Story Mode: Blood on the Clocktower', date: '2026-05-24' });
  });

  it('returns null date when there is no parseable trailing date', () => {
    expect(parseEventFolder({ id: 'b', name: 'Misc Photos' })).toEqual({
      folderId: 'b',
      title: 'Misc Photos',
      date: null,
    });
  });
});

describe('buildEventList', () => {
  it('excludes Archive, sorts newest first, undated last', () => {
    const files = [
      { id: '1', name: 'Old Event 1/1/2026' },
      { id: '2', name: 'Archive' },
      { id: '3', name: 'New Event 5/24/2026' },
      { id: '4', name: 'Undated Folder' },
    ];
    expect(buildEventList(files).map((e) => e.folderId)).toEqual(['3', '1', '4']);
  });

  it('excludes the Archive folder case-insensitively', () => {
    expect(buildEventList([{ id: '2', name: 'archive' }])).toEqual([]);
  });
});

describe('buildPhotoList', () => {
  it('builds thumb/view/download URLs for each image', () => {
    expect(buildPhotoList([{ id: 'IMG1', name: 'a.jpg' }])).toEqual([
      {
        id: 'IMG1',
        name: 'a.jpg',
        thumbUrl: 'https://drive.google.com/thumbnail?id=IMG1&sz=w800',
        viewUrl: 'https://drive.google.com/file/d/IMG1/view',
        downloadUrl: 'https://drive.google.com/uc?export=download&id=IMG1',
      },
    ]);
  });
});

describe('isValidDriveId', () => {
  it('accepts real Drive IDs and rejects junk', () => {
    expect(isValidDriveId('11e-Aibjt3IztaW-Qd1BU24T-V1ECPXn-')).toBe(true);
    expect(isValidDriveId('abc')).toBe(false);
    expect(isValidDriveId('../etc/passwd')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd worker && npx vitest run src/event-photos.test.ts`
Expected: FAIL — cannot resolve `./event-photos` / exports not defined.

- [ ] **Step 3: Write the minimal implementation**

Create `worker/src/event-photos.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd worker && npx vitest run src/event-photos.test.ts`
Expected: PASS (all describe blocks green).

- [ ] **Step 5: Commit**

```bash
git add worker/src/event-photos.ts worker/src/event-photos.test.ts
git commit -m "feat(worker): Drive folder/photo parsing helpers for event photos

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 2: Worker — Drive handlers + caching (TDD)

**Files:**
- Modify: `worker/src/event-photos.ts`
- Test: `worker/src/event-photos.test.ts`

- [ ] **Step 1: Add the failing handler tests**

Append to `worker/src/event-photos.test.ts` (add the imports to the existing top import from `./event-photos`: `handleEventPhotos, handleEventPhotosFolder, handleEventPhotoImage`):

```ts
import { afterEach, vi } from 'vitest';

const env = { DRIVE_API_KEY: 'test-key', EVENT_PHOTOS_FOLDER_ID: 'PARENT' } as any;
const ctx = { waitUntil: () => {} } as any;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('handleEventPhotos', () => {
  it('queries the parent folder and returns the parsed event list', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ files: [{ id: '3', name: 'New 5/24/2026' }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await handleEventPhotos(new Request('https://api.test/api/event-photos'), env, ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      events: [{ folderId: '3', title: 'New', date: '2026-05-24' }],
    });

    const calledUrl = String(fetchMock.mock.calls[0][0]);
    expect(decodeURIComponent(calledUrl)).toContain("'PARENT' in parents");
    expect(calledUrl).toContain('key=test-key');
  });
});

describe('handleEventPhotosFolder', () => {
  it('rejects an invalid folder id with 400', async () => {
    const res = await handleEventPhotosFolder('bad!', new Request('https://api.test/'), env, ctx);
    expect(res.status).toBe(400);
  });

  it('returns the photo list for a valid folder', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ files: [{ id: 'IMG1234567', name: 'a.jpg' }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await handleEventPhotosFolder('FOLDER1234567', new Request('https://api.test/'), env, ctx);
    const body = (await res.json()) as { photos: Array<{ thumbUrl: string }> };
    expect(body.photos[0].thumbUrl).toBe('https://drive.google.com/thumbnail?id=IMG1234567&sz=w800');
  });
});

describe('handleEventPhotoImage', () => {
  it('rejects an invalid file id with 400', async () => {
    const res = await handleEventPhotoImage('x', new Request('https://api.test/'), env, ctx);
    expect(res.status).toBe(400);
  });

  it('proxies image bytes with the upstream content-type', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('binary-bytes', { status: 200, headers: { 'Content-Type': 'image/png' } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const res = await handleEventPhotoImage('FILE1234567', new Request('https://api.test/'), env, ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
    expect(await res.text()).toBe('binary-bytes');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd worker && npx vitest run src/event-photos.test.ts`
Expected: FAIL — `handleEventPhotos` / `handleEventPhotosFolder` / `handleEventPhotoImage` not exported.

- [ ] **Step 3: Implement the handlers**

Add to the top of `worker/src/event-photos.ts`:

```ts
import type { Env } from './index';

const DRIVE_API = 'https://www.googleapis.com/drive/v3/files';

async function driveList(query: string, env: Env): Promise<DriveFile[]> {
  const params = new URLSearchParams({
    q: query,
    fields: 'files(id,name)',
    orderBy: 'name',
    pageSize: '1000',
    key: env.DRIVE_API_KEY,
  });
  const res = await fetch(`${DRIVE_API}?${params.toString()}`);
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
```

Then add the three handlers at the bottom of the file:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd worker && npx vitest run src/event-photos.test.ts`
Expected: PASS (all blocks green). Note: `Env` is imported from `./index` but the new fields are added in Task 3 — TypeScript inside the test file uses `as any` for `env`, so the test run passes. If `tsc` complains here, proceed to Task 3 which adds the `Env` fields.

- [ ] **Step 5: Commit**

```bash
git add worker/src/event-photos.ts worker/src/event-photos.test.ts
git commit -m "feat(worker): event-photos Drive handlers with edge caching

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 3: Worker — wire routes + env

**Files:**
- Modify: `worker/src/index.ts` (Env interface ~line 41-57; imports ~line 1-36; public route chain ~line 116-128)
- Modify: `worker/wrangler.toml`

- [ ] **Step 1: Add the import**

In `worker/src/index.ts`, after the existing public-handler imports (e.g. after the `handleGuildStatus` import line), add:

```ts
import { handleEventPhotos, handleEventPhotosFolder, handleEventPhotoImage } from './event-photos';
```

- [ ] **Step 2: Add the Env fields**

In the `export interface Env { ... }` block, add:

```ts
  DRIVE_API_KEY: string;
  EVENT_PHOTOS_FOLDER_ID: string;
```

- [ ] **Step 3: Add the routes**

In the public `if/else` chain, immediately after the `/api/guild-status` branch (around line 128) and **before** the `else if (url.pathname.startsWith('/api/admin/'))` branch, insert:

```ts
      } else if (url.pathname === '/api/event-photos' && request.method === 'GET') {
        response = await handleEventPhotos(request, env, ctx);
      } else if (url.pathname.startsWith('/api/event-photos/folder/') && request.method === 'GET') {
        const folderId = decodeURIComponent(url.pathname.split('/api/event-photos/folder/')[1] ?? '');
        response = await handleEventPhotosFolder(folderId, request, env, ctx);
      } else if (url.pathname.startsWith('/api/event-photos/image/') && request.method === 'GET') {
        const fileId = decodeURIComponent(url.pathname.split('/api/event-photos/image/')[1] ?? '');
        response = await handleEventPhotoImage(fileId, request, env, ctx);
```

- [ ] **Step 4: Add the wrangler var**

In `worker/wrangler.toml`, under the `[vars]` table, add:

```toml
EVENT_PHOTOS_FOLDER_ID = "11e-Aibjt3IztaW-Qd1BU24T-V1ECPXn-"
```

- [ ] **Step 5: Typecheck + full test run**

Run: `cd worker && npx tsc --noEmit && npm test`
Expected: tsc clean (no errors — `Env` now has both fields), all Vitest suites pass.

- [ ] **Step 6: Commit**

```bash
git add worker/src/index.ts worker/wrangler.toml
git commit -m "feat(worker): route /api/event-photos endpoints + env

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 4: Frontend — share helper

**Files:**
- Create: `src/lib/share.ts`

(No JS test runner on the public site; verified by build in Task 7 and the manual check in Task 8.)

- [ ] **Step 1: Create the helper**

Create `src/lib/share.ts`:

```ts
const WORKER_URL = import.meta.env.PUBLIC_WORKER_URL;

export interface SharablePhoto {
  id: string;
  name: string;
  viewUrl: string;
}

export function canNativeShare(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.canShare === 'function';
}

// Attempt to share the actual image file via the OS share sheet (Instagram,
// WhatsApp, etc. on mobile). Bytes are pulled through the worker proxy so the
// cross-origin fetch().blob() is allowed. Returns true if the share was handled
// (including user-cancel), false if the caller should fall back to copy-link.
export async function sharePhotoFile(photo: SharablePhoto): Promise<boolean> {
  if (!canNativeShare()) return false;
  try {
    const res = await fetch(`${WORKER_URL}/api/event-photos/image/${photo.id}`);
    if (!res.ok) return false;
    const blob = await res.blob();
    const file = new File([blob], `${photo.name || 'bgc-photo'}`, {
      type: blob.type || 'image/jpeg',
    });
    if (!navigator.canShare({ files: [file] })) return false;
    await navigator.share({ files: [file], text: 'Board Game Company' });
    return true;
  } catch (err) {
    // User dismissed the share sheet — treat as handled, don't fall back.
    if (err instanceof DOMException && err.name === 'AbortError') return true;
    return false;
  }
}

export async function copyLink(url: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(url);
    return true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/share.ts
git commit -m "feat(site): web-share + copy-link helper for event photos

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 5: Frontend — PhotoAlbum component

**Files:**
- Create: `src/components/PhotoAlbum.tsx`

- [ ] **Step 1: Create the component**

Create `src/components/PhotoAlbum.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { sharePhotoFile, canNativeShare, copyLink } from '../lib/share';

const WORKER_URL = import.meta.env.PUBLIC_WORKER_URL;

interface Photo {
  id: string;
  name: string;
  thumbUrl: string;
  viewUrl: string;
  downloadUrl: string;
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
    const shared = await sharePhotoFile(photo);
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

      {error && <p className="py-10 text-[#1A1A1A]/70">Couldn’t load these photos. Try again later.</p>}

      {!loading && !error && photos.length === 0 && (
        <p className="py-10 text-[#1A1A1A]/70">No photos in this album yet.</p>
      )}

      {!loading && !error && photos.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {photos.map((p) => (
            <button
              key={p.id}
              onClick={() => setLightbox(p)}
              className="aspect-square overflow-hidden rounded-xl bg-black/5"
            >
              <img src={p.thumbUrl} alt={p.name} loading="lazy" className="w-full h-full object-cover" />
            </button>
          ))}
        </div>
      )}

      {lightbox && (
        <div
          className="fixed inset-0 z-[100] bg-black/80 flex flex-col items-center justify-center p-4"
          onClick={() => setLightbox(null)}
        >
          <img
            src={lightbox.thumbUrl}
            alt={lightbox.name}
            className="max-h-[75vh] max-w-full rounded-lg"
            onClick={(e) => e.stopPropagation()}
          />
          <div className="flex flex-wrap gap-3 mt-4 justify-center" onClick={(e) => e.stopPropagation()}>
            {canNativeShare() && (
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
```

- [ ] **Step 2: Commit**

```bash
git add src/components/PhotoAlbum.tsx
git commit -m "feat(site): PhotoAlbum grid + lightbox + share actions

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 6: Frontend — EventPhotos island

**Files:**
- Create: `src/components/EventPhotos.tsx`

- [ ] **Step 1: Create the component**

Create `src/components/EventPhotos.tsx`:

```tsx
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
        <p className="text-lg text-[#1A1A1A]/70 mb-4">Couldn’t load photos right now.</p>
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
```

- [ ] **Step 2: Commit**

```bash
git add src/components/EventPhotos.tsx
git commit -m "feat(site): EventPhotos island with event grid + album routing

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 7: Frontend — page + nav, build verify

**Files:**
- Create: `src/pages/photos.astro`
- Modify: `src/components/Nav.astro` (navLinks array, lines 4-9)

- [ ] **Step 1: Create the page**

Create `src/pages/photos.astro`:

```astro
---
import Layout from '../layouts/Layout.astro';
import EventPhotos from '../components/EventPhotos.tsx';
---

<Layout title="Photos" description="Photos from past Board Game Company events in Bangalore — find your snaps and share them.">
  <section class="py-14" style="background: #FFF8E7;">
    <div class="max-w-[1200px] mx-auto px-6 text-center">
      <span class="section-tag">Event Photos</span>
      <h1 class="font-heading font-bold" style="font-size: clamp(2.4rem, 5vw, 3.8rem); letter-spacing: -1px;">
        Past Event Photos
      </h1>
      <p class="text-lg text-[#1A1A1A]/70 mt-3">
        Relive the games — find your photos and share them.
      </p>
    </div>
  </section>

  <section class="pb-20 pt-10">
    <div class="max-w-[1200px] mx-auto px-6">
      <EventPhotos client:load />
    </div>
  </section>
</Layout>
```

- [ ] **Step 2: Add the nav link**

In `src/components/Nav.astro`, change the `navLinks` array to include Photos (after Calendar):

```ts
const navLinks = [
  { label: 'Home', href: '/' },
  { label: 'Library', href: '/library' },
  { label: 'Guild Path', href: '/guild-path' },
  { label: 'Calendar', href: '/calendar' },
  { label: 'Photos', href: '/photos' },
];
```

- [ ] **Step 3: Build to verify it compiles**

Run (from repo root): `npm run build`
Expected: build succeeds, output lists `/photos` among the built routes, no TypeScript/JSX errors.

- [ ] **Step 4: Commit**

```bash
git add src/pages/photos.astro src/components/Nav.astro
git commit -m "feat(site): /photos page + nav link

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 8: Manual end-to-end verification + deploy notes

**Files:** none (verification + operator setup)

This task is not auto-testable; it requires the real Drive folder + key. Record results in the final report.

- [ ] **Step 1: One-time Drive/worker setup (operator)**

- Create a Google Cloud API key with the **Google Drive API** enabled; restrict the key to the Drive API.
- Set it on the worker: `cd worker && npx wrangler secret put DRIVE_API_KEY`
- Confirm the parent Drive folder (and its subfolders/photos) is shared **"Anyone with the link – Viewer"**.
- Confirm `EVENT_PHOTOS_FOLDER_ID` is set in `worker/wrangler.toml` (Task 3).

- [ ] **Step 2: Local smoke test of the worker**

Run: `cd worker && npm run dev` then in another shell:
`curl -s "http://localhost:8787/api/event-photos" | head -c 400`
Expected: JSON `{ "events": [ ... ] }` with your real event folders, `Archive` absent, newest first.
Also spot-check: `curl -s "http://localhost:8787/api/event-photos/folder/<aFolderId>" | head -c 400` returns `{ "photos": [...] }`.

- [ ] **Step 3: Local browser check**

Run: `npm run dev` (root). Open `http://localhost:4321/photos`.
Verify: event cards render newest-first; clicking a card opens its album grid; URL shows `?event=...`; browser Back returns to the grid; clicking a thumbnail opens the lightbox; Download opens the Drive download; Copy link copies the Drive file URL; on a phone (or device emulation) the Share button appears and opens the native sheet.

- [ ] **Step 4: Deploy**

- Worker: `cd worker && npx wrangler deploy` (per the worker-deploy-shadowing memory, if the root `wrangler.jsonc` shadows the config, deploy with `--config worker/wrangler.toml`).
- Site: the `/photos` page + nav ships when the branch is merged and pushed to `main` (Cloudflare Pages auto-deploy).

- [ ] **Step 5: Production verification**

After deploy, load `https://boardgamecompany.in/photos` and repeat the Step 3 checks against production. Confirm `https://api.boardgamecompany.in/api/event-photos` returns the event list.

---

## Self-review notes (for the implementer)

- **Spec coverage:** `/photos` page + nav (T7); event grid (T6); album + lightbox (T5); share/download/copy (T4+T5); Web Share file path via worker proxy (T4 + handler T2); 3 worker endpoints (T2/T3); Archive exclusion (T1); date parse + newest-first sort (T1); config + Drive sharing requirement (T3/T8); caching (T2); empty/error/loading states (T5/T6). All present.
- **Naming consistency:** handler names (`handleEventPhotos`, `handleEventPhotosFolder`, `handleEventPhotoImage`), helper names (`parseEventFolder`, `buildEventList`, `buildPhotoList`, `isValidDriveId`), and the `EventFolder`/`EventPhoto`/`Photo` shapes match across worker, tests, and the React components.
- **Endpoint/URL consistency:** `/api/event-photos`, `/api/event-photos/folder/:id`, `/api/event-photos/image/:id` are identical in the handlers (T2), routes (T3), and the fetch calls in `share.ts` / `PhotoAlbum.tsx` / `EventPhotos.tsx`.
```
