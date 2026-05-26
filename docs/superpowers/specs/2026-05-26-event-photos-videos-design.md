# Event Photos — Video Support Design

**Date:** 2026-05-26
**Status:** Approved, pending implementation plan
**Extends:** [2026-05-26-event-photos-gallery-design.md](2026-05-26-event-photos-gallery-design.md)

## Goal

The shipped `/photos` gallery shows only images, because the worker's folder query
filters `mimeType contains 'image/'`. Event Drive folders also contain videos
(`video/mp4`, `video/quicktime`, etc.), which are silently excluded. This change
makes videos appear alongside photos: visible in the album grid (poster + a play
badge), playable inline in the lightbox, and shareable via link.

No new endpoints, no new files, no migration — a contained change to 4 existing
files reusing the same Drive API key.

## Worker (`worker/src/event-photos.ts`)

1. **Broaden the folder image query** in `handleEventPhotosFolder`:
   - From: `'<folderId>' in parents and mimeType contains 'image/' and trashed=false`
   - To:   `'<folderId>' in parents and (mimeType contains 'image/' or mimeType contains 'video/') and trashed=false`
2. **Request mimetype.** `driveList` currently sets `fields=files(id,name)`; change to
   `fields=files(id,name,mimeType)`. `DriveFile` gains `mimeType?: string`. This helper
   is shared with `handleEventPhotos` (folder listing) — adding `mimeType` is harmless
   there (`buildEventList` ignores it).
3. **`buildPhotoList` gains `kind`.** Each `EventPhoto` gets `kind: 'image' | 'video'`,
   derived from `mimeType`: starts with `video/` → `'video'`, otherwise `'image'`
   (missing/unknown mimetype defaults to `'image'`). Video items additionally get
   `previewUrl: https://drive.google.com/file/d/<id>/preview` (the embeddable Drive
   player). Image items have no `previewUrl`.
   - `thumbUrl` (`thumbnail?id=<id>&sz=w800`), `viewUrl` (`/view`), and `downloadUrl`
     (`uc?export=download&id=<id>`) are built identically for both kinds — Drive's
     thumbnail endpoint returns a poster frame for videos.

Resulting `EventPhoto` shape:
```ts
interface EventPhoto {
  id: string;
  name: string;
  kind: 'image' | 'video';
  thumbUrl: string;
  viewUrl: string;
  downloadUrl: string;
  previewUrl?: string; // present only when kind === 'video'
}
```

## Frontend

### `src/components/PhotoAlbum.tsx`
- `Photo` interface gains `kind: 'image' | 'video'` and `previewUrl?: string`.
- **Grid tile:** unchanged `<img src={thumbUrl}>`; for `kind === 'video'`, overlay a
  centered play badge (▶) so videos are distinguishable from photos.
- **Lightbox:** branch on `kind`:
  - `image` → `<img src={thumbUrl}>` (current behavior).
  - `video` → `<iframe src={previewUrl} allow="autoplay" allowFullScreen>` sized like
    the image (max-h-[75vh]), so it plays inline. Click-out still closes; iframe
    stops propagation.
- **Action buttons:**
  - `image`: Share (file via worker proxy) + Download + Copy link — unchanged.
  - `video`: Share (shares the Drive `viewUrl` **link** via the native share sheet) +
    Download + Copy link.
  - `onShare(photo)` branches: `video` → `shareUrlLink(photo.viewUrl)`; `image` →
    existing `sharePhotoFile(photo)`. Both fall back to `copyLink(photo.viewUrl)` +
    "Copied!" flash when the share is unavailable/fails.
  - Share button visibility: `image` shows when `canNativeShare()`; `video` shows when
    `canShareUrl()`.

### `src/lib/share.ts`
- Add `canShareUrl(): boolean` → `typeof navigator !== 'undefined' && typeof navigator.share === 'function'`.
- Add `shareUrlLink(url: string, text = 'Board Game Company'): Promise<boolean>` →
  if `!canShareUrl()` return false; else `navigator.share({ url, text })`; on
  `AbortError` return true (user dismissed = handled); on other error return false.
- `sharePhotoFile` (images) is unchanged.

### Image proxy (`/api/event-photos/image/:fileId`)
Untouched. Only the image file-share path uses it; videos share a link, never bytes.

## Testing (`worker/src/event-photos.test.ts`)

- **Update** the existing `buildPhotoList` test: output now includes `kind: 'image'`
  for a `.jpg` with no mimetype, and no `previewUrl`.
- **Add** a video case: `{ id, name, mimeType: 'video/mp4' }` → `kind: 'video'` and
  `previewUrl: https://drive.google.com/file/d/<id>/preview`.
- **Add** an image-with-mimetype case: `mimeType: 'image/jpeg'` → `kind: 'image'`,
  no `previewUrl`.
- **Update/Add** a `handleEventPhotosFolder` assertion: the Drive query now contains
  both `image/` and `video/` (decode the called URL and assert it includes
  `mimeType contains 'image/' or mimeType contains 'video/'`).

Frontend has no JS test runner (per the gallery spec) — `PhotoAlbum`/`share.ts`
changes are verified by `npm run build` and manual lightbox checks on the live page.

## Files touched

- `worker/src/event-photos.ts` (query, `DriveFile.mimeType`, `buildPhotoList` kind/previewUrl)
- `worker/src/event-photos.test.ts` (update + add cases)
- `src/lib/share.ts` (`canShareUrl`, `shareUrlLink`)
- `src/components/PhotoAlbum.tsx` (`Photo` type, grid badge, lightbox iframe branch, share branch)

## Out of scope (v1)

- Custom video player chrome (we embed Google's Drive player).
- Streaming/transcoding or hosting video bytes ourselves.
- Web Share of the actual video file (too large to proxy; link share instead).
- Autoplay of videos in the grid (poster only; plays on open).
