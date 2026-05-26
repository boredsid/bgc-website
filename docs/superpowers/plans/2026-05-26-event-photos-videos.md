# Event Photos Video Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make videos in event Drive folders appear in the `/photos` gallery — shown as poster tiles with a play badge, played inline in the lightbox via Drive's embedded player, and shared via link.

**Architecture:** Broaden the worker's Drive folder query to include `video/` mimetypes and tag each item `image`/`video` (videos also get a Drive `/preview` embed URL). The `PhotoAlbum` React component branches on that `kind`: a ▶ badge on video tiles, an `<iframe>` instead of `<img>` in the lightbox, and a URL-share (instead of file-share) for the Share button.

**Tech Stack:** Cloudflare Worker (TypeScript, Vitest), Google Drive API v3, Astro 5 + React 19 island, Tailwind utility classes.

**Spec:** `docs/superpowers/specs/2026-05-26-event-photos-videos-design.md`

---

## Context for the implementer

- This extends a shipped feature. The worker module `worker/src/event-photos.ts` already exposes `buildPhotoList`, `handleEventPhotosFolder`, the `EventPhoto` interface, and a private `driveList(query, env)` helper. Worker tests are Vitest: `cd worker && npm test` (or `npx vitest run src/event-photos.test.ts`). The Drive call uses global `fetch`, mocked with `vi.stubGlobal`.
- The public site (`src/`) has **no JS test runner** — frontend changes are verified with `npm run build` from the repo root, plus manual checks on the live page.
- `driveList` builds its URL by hand with `encodeURIComponent` per param (do not switch to `URLSearchParams` — a test asserts `%20`-style encoding via `decodeURIComponent`).
- Drive's `thumbnail?id=<id>&sz=w800` endpoint returns a poster frame for videos too, so the grid tile needs no special thumbnail handling.
- Branch `feat/event-photos-videos` is checked out.

## File structure

| File | Change |
|---|---|
| `worker/src/event-photos.ts` | Query includes `video/`; `driveList` fetches `mimeType`; `DriveFile` gains `mimeType?`; `EventPhoto` gains `kind` + `previewUrl?`; `buildPhotoList` sets them |
| `worker/src/event-photos.test.ts` | Update `buildPhotoList` test; add image/video kind cases; assert folder query includes `video/` |
| `src/lib/share.ts` | Add `canShareUrl()` + `shareUrlLink()` |
| `src/components/PhotoAlbum.tsx` | `Photo` gains `kind`/`previewUrl`; ▶ badge on video tiles; lightbox `<iframe>` for video; Share branches on kind |

---

## Task 1: Worker — include videos, tag kind, add preview URL (TDD)

**Files:**
- Modify: `worker/src/event-photos.ts`
- Test: `worker/src/event-photos.test.ts`

- [ ] **Step 1: Update + add the failing tests**

In `worker/src/event-photos.test.ts`, **replace** the entire existing `describe('buildPhotoList', ...)` block (currently:)

```ts
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
```

with this:

```ts
describe('buildPhotoList', () => {
  it('marks an item with no mimetype as an image with no previewUrl', () => {
    expect(buildPhotoList([{ id: 'IMG1', name: 'a.jpg' }])).toEqual([
      {
        id: 'IMG1',
        name: 'a.jpg',
        kind: 'image',
        thumbUrl: 'https://drive.google.com/thumbnail?id=IMG1&sz=w800',
        viewUrl: 'https://drive.google.com/file/d/IMG1/view',
        downloadUrl: 'https://drive.google.com/uc?export=download&id=IMG1',
      },
    ]);
  });

  it('marks an image/* mimetype as an image with no previewUrl', () => {
    const [item] = buildPhotoList([{ id: 'IMG2', name: 'b.png', mimeType: 'image/png' }]);
    expect(item.kind).toBe('image');
    expect(item.previewUrl).toBeUndefined();
  });

  it('marks a video/* mimetype as a video with a Drive preview URL', () => {
    const [item] = buildPhotoList([{ id: 'VID1', name: 'c.mp4', mimeType: 'video/mp4' }]);
    expect(item.kind).toBe('video');
    expect(item.previewUrl).toBe('https://drive.google.com/file/d/VID1/preview');
    expect(item.thumbUrl).toBe('https://drive.google.com/thumbnail?id=VID1&sz=w800');
  });
});
```

Then, in the `describe('handleEventPhotosFolder', ...)` block, **replace** the existing `it('returns the photo list for a valid folder', ...)` test with this version (adds a query assertion):

```ts
  it('returns the photo list for a valid folder and queries images + videos', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ files: [{ id: 'IMG1234567', name: 'a.jpg' }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await handleEventPhotosFolder('FOLDER1234567', new Request('https://api.test/'), env, ctx);
    const body = (await res.json()) as { photos: Array<{ thumbUrl: string }> };
    expect(body.photos[0].thumbUrl).toBe('https://drive.google.com/thumbnail?id=IMG1234567&sz=w800');

    const calledUrl = String(fetchMock.mock.calls[0][0]);
    expect(decodeURIComponent(calledUrl)).toContain(
      "mimeType contains 'image/' or mimeType contains 'video/'",
    );
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd worker && npx vitest run src/event-photos.test.ts`
Expected: FAIL — `buildPhotoList` output lacks `kind`/`previewUrl`; the folder query doesn't yet contain `video/`.

- [ ] **Step 3: Implement the worker changes**

In `worker/src/event-photos.ts`:

**(a)** Change `driveList`'s `fields` from `'files(id,name)'` to `'files(id,name,mimeType)'`:

```ts
    `&fields=${encodeURIComponent('files(id,name,mimeType)')}` +
```

**(b)** Add `mimeType` to the `DriveFile` interface:

```ts
export interface DriveFile {
  id: string;
  name: string;
  mimeType?: string;
}
```

**(c)** Add `kind` and `previewUrl` to the `EventPhoto` interface:

```ts
export interface EventPhoto {
  id: string;
  name: string;
  kind: 'image' | 'video';
  thumbUrl: string;
  viewUrl: string;
  downloadUrl: string;
  previewUrl?: string; // present only when kind === 'video'
}
```

**(d)** Replace `buildPhotoList` with:

```ts
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
```

**(e)** In `handleEventPhotosFolder`, broaden the query:

```ts
    const files = await driveList(
      `'${folderId}' in parents and (mimeType contains 'image/' or mimeType contains 'video/') and trashed=false`,
      env,
    );
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd worker && npx tsc --noEmit && npm test`
Expected: tsc clean, all suites pass (the 3 new/updated `buildPhotoList` cases + the folder query assertion green; nothing else regressed).

- [ ] **Step 5: Commit**

```bash
git add worker/src/event-photos.ts worker/src/event-photos.test.ts
git commit -m "feat(worker): include videos in event-photos folder listing

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 2: Frontend — URL-share helper

**Files:**
- Modify: `src/lib/share.ts`

(No JS test runner; verified by build in Task 3.)

- [ ] **Step 1: Add the helpers**

In `src/lib/share.ts`, after the `canNativeShare` function (before `sharePhotoFile`), add:

```ts
export function canShareUrl(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.share === 'function';
}

// Share a URL (e.g. a video's Drive link) via the OS share sheet. Returns true if
// handled (including user-cancel), false if the caller should fall back to copy-link.
export async function shareUrlLink(url: string, text = 'Board Game Company'): Promise<boolean> {
  if (!canShareUrl()) return false;
  try {
    await navigator.share({ url, text });
    return true;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return true;
    return false;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/share.ts
git commit -m "feat(site): add URL share helper for video links

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 3: Frontend — video tiles, inline player, video share

**Files:**
- Modify: `src/components/PhotoAlbum.tsx`

- [ ] **Step 1: Update the import**

Change line 2 of `src/components/PhotoAlbum.tsx` from:

```tsx
import { sharePhotoFile, canNativeShare, copyLink } from '../lib/share';
```

to:

```tsx
import { sharePhotoFile, canNativeShare, canShareUrl, shareUrlLink, copyLink } from '../lib/share';
```

- [ ] **Step 2: Extend the `Photo` interface**

Replace the `Photo` interface (lines 6-12) with:

```tsx
interface Photo {
  id: string;
  name: string;
  kind: 'image' | 'video';
  thumbUrl: string;
  viewUrl: string;
  downloadUrl: string;
  previewUrl?: string;
}
```

- [ ] **Step 3: Branch the share handler on kind**

Replace the `onShare` function (lines 54-57) with:

```tsx
  async function onShare(photo: Photo) {
    const shared =
      photo.kind === 'video' ? await shareUrlLink(photo.viewUrl) : await sharePhotoFile(photo);
    if (!shared) flashCopied(await copyLink(photo.viewUrl));
  }
```

- [ ] **Step 4: Add the play badge to video tiles**

Replace the grid `<button>` block (lines 83-91) with:

```tsx
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
```

- [ ] **Step 5: Render an iframe for video in the lightbox**

Replace the lightbox `<img>` element (lines 100-105) with this conditional:

```tsx
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
```

- [ ] **Step 6: Gate the Share button on the right capability per kind**

Replace the Share-button conditional (lines 107-111) with:

```tsx
            {(lightbox.kind === 'video' ? canShareUrl() : canNativeShare()) && (
              <button onClick={() => onShare(lightbox)} className="btn btn-primary">
                Share
              </button>
            )}
```

- [ ] **Step 7: Build to verify it compiles**

Run (from repo root): `npm run build`
Expected: build succeeds, `/photos` built, no TypeScript/JSX errors.

- [ ] **Step 8: Commit**

```bash
git add src/components/PhotoAlbum.tsx
git commit -m "feat(site): show + play videos in the photo album

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Self-review notes (for the implementer)

- **Spec coverage:** broadened query (T1e); `mimeType` in fields (T1a); `kind` + `previewUrl` on `EventPhoto`/`buildPhotoList` (T1c/T1d); grid ▶ badge (T3.4); lightbox iframe for video (T3.5); video share via link + image share unchanged (T3.3, T3.6); `canShareUrl`/`shareUrlLink` (T2); test updates (T1.1). Image proxy untouched. All present.
- **Type consistency:** worker `EventPhoto` (`kind: 'image' | 'video'`, optional `previewUrl`) matches the frontend `Photo` interface (T3.2) and the `shareUrlLink(url)` / `canShareUrl()` signatures match their call sites in `PhotoAlbum.tsx`. `DriveFile.mimeType` is optional, so the kind-detection (`f.mimeType?.startsWith('video/')`) handles missing mimetypes (defaults to image).
- **No placeholders.** Every step shows the exact replacement code.
```
