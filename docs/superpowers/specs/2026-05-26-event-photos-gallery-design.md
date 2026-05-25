# Past Event Photos Gallery — Design

**Date:** 2026-05-26
**Status:** Approved, pending implementation plan

## Goal

Let people find photos of themselves from past BGC events and easily share them
to social media (Instagram, WhatsApp) or send a link to friends. Photos live in a
single Google Drive folder with **one subfolder per event**.

**Drive folder naming convention:** `<event name> <M/D/YYYY>`
Example: `Story Mode: Blood on the Clocktower 5/24/2026`

**Parent Drive folder:** `11e-Aibjt3IztaW-Qd1BU24T-V1ECPXn-`

## User experience

New page at `/photos` (nav label "Photos"). Static Astro shell hosting a React
island that fetches at runtime from the worker, so newly-added Drive folders
appear immediately without a site redeploy.

Two levels:

1. **Event grid** — cards generated from the Drive subfolders, each showing the
   event title and a formatted date (e.g. "May 24, 2026"), newest first. Styled
   in the Orange Energy palette / board-game motif. Click a card → album.
2. **Album** — a responsive grid of low-quality photo thumbnails for that event,
   loaded on demand (only when the album is opened). The selected album is
   reflected in the URL as `?event=<folderId>` so it is bookmarkable and works
   with the browser back button.
3. **Lightbox** — clicking a thumbnail opens a larger preview with action
   buttons: **Share**, **Download**, **Copy link**.

### States

- **Loading:** skeleton cards / skeleton thumbnails.
- **Fetch error:** friendly message + a direct "Browse on Google Drive" button to
  the parent folder.
- **Empty:** "Photos coming soon" message (no folders, or a folder with no images).

## Sharing

The goal is "share to Instagram / send to friends." Reality: **no website can
post directly to an Instagram feed** — Instagram exposes no web share intent. The
working mechanism is the device's native share sheet.

- **Share** → Web Share API (`navigator.share`). On mobile this opens the OS share
  sheet, which lists Instagram, WhatsApp, etc., and we hand it the actual image
  **file** so Instagram receives the photo. Uses `navigator.canShare({ files })`
  to feature-detect.
- **Copy link** → the photo's public Drive file link
  (`https://drive.google.com/file/d/<id>/view`). Most chat apps auto-generate a
  thumbnail preview for these.
- **Download** → `https://drive.google.com/uc?export=download&id=<id>`.
- **Desktop fallback:** when `navigator.share`/file-share is unavailable, the
  Share button is hidden and Copy link + Download remain.

### CORS gotcha (designed around)

To hand Instagram an actual file, the browser must read the image bytes via
`fetch().blob()`. Drive's thumbnail/file URLs do not return CORS headers, so a
cross-origin fetch fails. Therefore the worker exposes a small **image-proxy**
route that fetches the image from Drive and returns the bytes **with CORS
headers**. It is only invoked when a user taps Share (never during grid render,
because `<img>` display is not subject to CORS), so it stays cheap.

## Architecture & data flow

```
src/pages/photos.astro  (static shell)
  └─ <EventPhotos client:load />              React island
        ├─ GET {WORKER_URL}/api/event-photos                 → event folders
        └─ <PhotoAlbum> on selection
              ├─ GET {WORKER_URL}/api/event-photos/folder/:folderId  → images
              └─ Share → src/lib/share.ts
                    └─ (file share) GET {WORKER_URL}/api/event-photos/image/:fileId
```

Worker calls the Google Drive API with `DRIVE_API_KEY` (a secret); the key is
never exposed to the browser. This matches the existing pattern: anything
needing a secret goes through the worker.

## Worker endpoints (public)

New module `worker/src/event-photos.ts`, wired into the flat `if/else` chain in
`worker/src/index.ts`. All responses edge-cached via `caches.default` (~10 min TTL).

### `GET /api/event-photos`

Lists the event subfolders of the parent folder.

- Drive call:
  `files.list?q='<EVENT_PHOTOS_FOLDER_ID>' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false&fields=files(id,name)&orderBy=name&pageSize=1000&key=<DRIVE_API_KEY>`
- Exclude the reserved `Archive` folder (case-insensitive exact name match) — it
  is not an event.
- For each remaining folder, parse the name: strip a trailing `M/D/YYYY` token →
  `{ title, date }`. Folders whose name has no parseable trailing date keep the
  full name as `title`, `date: null`, and sort last.
- Sort by date descending (newest first); null dates at the end.
- Response: `{ events: [{ folderId, title, date }] }` where `date` is ISO
  (`YYYY-MM-DD`) or null.

### `GET /api/event-photos/folder/:folderId`

Lists the images inside one event folder.

- Drive call:
  `files.list?q='<folderId>' in parents and mimeType contains 'image/' and trashed=false&fields=files(id,name)&orderBy=name&pageSize=1000&key=<DRIVE_API_KEY>`
- For each image, construct:
  - `thumbUrl`: `https://drive.google.com/thumbnail?id=<id>&sz=w800`
  - `viewUrl`: `https://drive.google.com/file/d/<id>/view`
  - `downloadUrl`: `https://drive.google.com/uc?export=download&id=<id>`
- Response: `{ photos: [{ id, name, thumbUrl, viewUrl, downloadUrl }] }`.
- `folderId` is validated to look like a Drive ID before use.

### `GET /api/event-photos/image/:fileId`

CORS image proxy for Web Share file sharing.

- Fetches `https://drive.google.com/thumbnail?id=<fileId>&sz=w1200` (a share-
  appropriate resolution) from Drive.
- Streams the bytes back with the upstream `Content-Type` and CORS headers.
- Edge-cached. `fileId` validated as a Drive ID.

## Frontend components

- `src/pages/photos.astro` — Layout + hero section (mirrors `library.astro`) +
  `<EventPhotos client:load />`.
- `src/components/EventPhotos.tsx` — top-level island. Fetches the event list,
  renders the event grid, owns the `?event=` URL state, and switches between the
  grid and `<PhotoAlbum>`.
- `src/components/PhotoAlbum.tsx` — fetches and renders one folder's image grid,
  owns the lightbox, and renders the Share / Download / Copy-link actions.
- `src/lib/share.ts` — `sharePhoto()` helper: feature-detects `navigator.canShare`,
  fetches the image via the worker proxy to build a `File`, calls
  `navigator.share({ files })`; falls back to copy-link when unsupported.

`worker/src/index.ts` and `src/components/Nav.astro` are edited (routes + `Env`,
and the "Photos" nav link, which also flows to `MobileMenu` via its prop).

## Configuration (one-time, manual)

- `worker/wrangler.toml` `[vars]`: `EVENT_PHOTOS_FOLDER_ID = "11e-Aibjt3IztaW-Qd1BU24T-V1ECPXn-"`
- Worker secret: `wrangler secret put DRIVE_API_KEY` — a Google Cloud API key with
  the **Google Drive API** enabled (restricted to the Drive API).
- The Drive folder must be shared **"Anyone with the link – Viewer"** so an
  API-key-only (unauthenticated) request can read it. Subfolders and photos
  inherit this.
- `Env` interface in `worker/src/index.ts` gains `DRIVE_API_KEY: string` and
  `EVENT_PHOTOS_FOLDER_ID: string`.

## Testing

Vitest on the worker (`worker/src/event-photos.test.ts`), with the Drive `fetch`
mocked:

- Folder-name parsing: trailing `M/D/YYYY` split into title + ISO date.
- Unparseable folder name → full name as title, `date: null`, sorted last.
- `Archive` folder is excluded from the event list (case-insensitive).
- Sort order: newest event first.
- Image list mapping: correct `thumbUrl` / `viewUrl` / `downloadUrl` construction.
- Image proxy: returns upstream content-type + CORS headers; validates `fileId`.

Frontend logic is light; the share helper's fallback path can be unit-tested if
convenient, but worker tests are the priority (matches existing Vitest setup).

## Out of scope (v1)

- Per-photo on-site deep links with OpenGraph preview cards (would require SSR or
  prerendering). Sharing uses the public Drive file link instead.
- Cover thumbnails on the event cards (event cards are text-on-styled-background).
- Face recognition / tagging to auto-find "photos of me".
- Combined cross-event photo feed.
