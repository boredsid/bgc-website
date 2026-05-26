import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  parseEventFolder,
  buildEventList,
  buildPhotoList,
  isValidDriveId,
  handleEventPhotos,
  handleEventPhotosFolder,
  handleEventPhotoImage,
} from './event-photos';

const env = { DRIVE_API_KEY: 'test-key', EVENT_PHOTOS_FOLDER_ID: 'PARENT' } as any;
const ctx = { waitUntil: () => {} } as any;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

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

describe('isValidDriveId', () => {
  it('accepts real Drive IDs and rejects junk', () => {
    expect(isValidDriveId('11e-Aibjt3IztaW-Qd1BU24T-V1ECPXn-')).toBe(true);
    expect(isValidDriveId('abc')).toBe(false);
    expect(isValidDriveId('../etc/passwd')).toBe(false);
  });
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
