import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./supabase', () => ({ getSupabase: vi.fn() }));

import { getSupabase } from './supabase';
import {
  parseEventFolder,
  buildEventList,
  buildAlbumList,
  buildPhotoList,
  buildGooglePhotoList,
  isValidDriveId,
  handleEventPhotos,
  handleEventPhotosFolder,
  handleEventPhotoImage,
  handleGooglePhotosAlbum,
  handleGooglePhotoImage,
  pickDriveCover,
  handleDriveCover,
  handleGooglePhotosCover,
  type DriveFile,
} from './event-photos';

const env = { DRIVE_API_KEY: 'test-key', EVENT_PHOTOS_FOLDER_ID: 'PARENT' } as any;

// A chainable query mock: filters return itself; awaiting (or maybeSingle)
// resolves with `result`. Records filter calls for assertions.
function queryMock(result: { data: unknown; error: unknown }) {
  const calls: Array<[string, ...unknown[]]> = [];
  const q: any = {
    calls,
    then: (resolve: any) => resolve(result),
    maybeSingle: async () => result,
  };
  for (const m of ['select', 'eq', 'not']) {
    q[m] = (...a: unknown[]) => { calls.push([m, ...a]); return q; };
  }
  return q;
}
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

describe('buildAlbumList', () => {
  it('mixes Google Photos events in with Drive folders by date, in venue time', () => {
    const albums = buildAlbumList(
      [
        { folderId: 'F1', title: 'May Meetup', date: '2026-05-24' },
        { folderId: 'F2', title: 'Loose Photos', date: null },
      ],
      [
        // 20:30 UTC on the 10th is already the 11th in Bangalore.
        { id: 'E1', name: 'Wingspan Night', date: '2026-06-10T20:30:00Z', google_photos_url: 'https://photos.app.goo.gl/abc' },
        { id: 'E2', name: 'April Social', date: '2026-04-02T12:00:00Z', google_photos_url: 'https://photos.app.goo.gl/def' },
      ],
    );
    expect(albums).toEqual([
      { source: 'google_photos', eventId: 'E1', title: 'Wingspan Night', date: '2026-06-11', albumUrl: 'https://photos.app.goo.gl/abc' },
      { source: 'drive', folderId: 'F1', title: 'May Meetup', date: '2026-05-24' },
      { source: 'google_photos', eventId: 'E2', title: 'April Social', date: '2026-04-02', albumUrl: 'https://photos.app.goo.gl/def' },
      { source: 'drive', folderId: 'F2', title: 'Loose Photos', date: null },
    ]);
  });
});

describe('buildGooglePhotoList', () => {
  it('builds sized, download and photo-page links; videos play on Google Photos', () => {
    const base = 'https://lh3.googleusercontent.com/pw/TOKEN';
    const photos = buildGooglePhotoList({
      albumKey: 'ALBUM',
      authKey: 'KEY',
      complete: true,
      items: [
        { mediaKey: 'M1', token: 'TOKEN', baseUrl: base, isVideo: false },
        { mediaKey: 'M2', token: 'TOKEN', baseUrl: base, isVideo: true },
      ],
    });
    expect(photos[0]).toEqual({
      id: 'TOKEN',
      name: 'bgc-photo-1.jpg',
      kind: 'image',
      thumbUrl: `${base}=w800`,
      viewUrl: 'https://photos.google.com/share/ALBUM/photo/M1?key=KEY',
      downloadUrl: `${base}=d`,
    });
    expect(photos[1]).toMatchObject({ kind: 'video', name: 'bgc-video-2.mp4', downloadUrl: `${base}=dv` });
    expect(photos[1].previewUrl).toBeUndefined();
  });
});

describe('handleEventPhotos', () => {
  it('lists Drive folders plus published events that have a Google Photos album', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ files: [{ id: '3', name: 'New 5/24/2026' }] }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const q = queryMock({
      data: [{ id: 'E1', name: 'Catan Night', date: '2026-06-01T13:00:00Z', google_photos_url: 'https://photos.app.goo.gl/abc' }],
      error: null,
    });
    (getSupabase as any).mockReturnValue({ from: () => q });

    const res = await handleEventPhotos(new Request('https://api.test/api/event-photos'), env, ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      events: [
        { source: 'google_photos', eventId: 'E1', title: 'Catan Night', date: '2026-06-01', albumUrl: 'https://photos.app.goo.gl/abc' },
        { source: 'drive', folderId: '3', title: 'New', date: '2026-05-24' },
      ],
    });

    const calledUrl = String(fetchMock.mock.calls[0][0]);
    expect(decodeURIComponent(calledUrl)).toContain("'PARENT' in parents");
    expect(calledUrl).toContain('key=test-key');
    expect(q.calls).toContainEqual(['eq', 'is_published', true]);
    expect(q.calls).toContainEqual(['not', 'google_photos_url', 'is', null]);
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=600');
  });

  it('still lists the Drive folders, uncached, when the event lookup fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ files: [{ id: '3', name: 'New 5/24/2026' }] }),
    }));
    (getSupabase as any).mockReturnValue({
      from: () => queryMock({ data: null, error: { message: 'column events.google_photos_url does not exist' } }),
    });

    const res = await handleEventPhotos(new Request('https://api.test/api/event-photos'), env, ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await res.json()).toEqual({ events: [{ source: 'drive', folderId: '3', title: 'New', date: '2026-05-24' }] });
  });
});

describe('handleGooglePhotosAlbum', () => {
  const EVENT_ID = '5f0c3a52-8a8e-4d9b-9a53-1d2e3f4a5b6c';

  it('rejects a malformed event id with 400', async () => {
    const res = await handleGooglePhotosAlbum('../x', new Request('https://api.test/'), env, ctx);
    expect(res.status).toBe(400);
  });

  it('404s when the event has no album or is not published', async () => {
    const q = queryMock({ data: null, error: null });
    (getSupabase as any).mockReturnValue({ from: () => q });
    const res = await handleGooglePhotosAlbum(EVENT_ID, new Request('https://api.test/'), env, ctx);
    expect(res.status).toBe(404);
    expect(q.calls).toContainEqual(['eq', 'is_published', true]);
  });

  it('502s with the album link when the album cannot be read', async () => {
    (getSupabase as any).mockReturnValue({
      from: () => queryMock({ data: { google_photos_url: 'https://photos.app.goo.gl/abc' }, error: null }),
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404, url: '', text: async () => '' }));
    const res = await handleGooglePhotosAlbum(EVENT_ID, new Request('https://api.test/'), env, ctx);
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ albumUrl: 'https://photos.app.goo.gl/abc' });
  });

  it('returns the album photos', async () => {
    (getSupabase as any).mockReturnValue({
      from: () => queryMock({ data: { google_photos_url: 'https://photos.app.goo.gl/abc' }, error: null }),
    });
    const token = 'AP1GczOoi8SGudg1gPQuNajLa9kImwVpU8S29QuKfi42';
    const data = [null, [['M1', [`https://lh3.googleusercontent.com/pw/${token}`, 10, 10], 1, 'd', 0, 1, [], [], 2, {}]], ''];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      url: 'https://photos.google.com/share/ALBUMKEY?key=AUTHKEY',
      text: async () => `<script>AF_initDataCallback({key: 'ds:1', hash: '2', data:${JSON.stringify(data)}, sideChannel: {}});</script>`,
    }));
    const res = await handleGooglePhotosAlbum(EVENT_ID, new Request('https://api.test/'), env, ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { photos: Array<{ id: string; viewUrl: string }>; albumUrl: string; complete: boolean };
    expect(body.complete).toBe(true);
    expect(body.albumUrl).toBe('https://photos.app.goo.gl/abc');
    expect(body.photos).toHaveLength(1);
    expect(body.photos[0].viewUrl).toBe('https://photos.google.com/share/ALBUMKEY/photo/M1?key=AUTHKEY');
  });
});

describe('handleGooglePhotoImage', () => {
  it('rejects anything that is not an lh3 media token', async () => {
    const res = await handleGooglePhotoImage('x/../y', new Request('https://api.test/'), env, ctx);
    expect(res.status).toBe(400);
  });

  it('proxies the shared-album image', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('jpeg-bytes', { status: 200, headers: { 'Content-Type': 'image/jpeg' } }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const token = 'AP1GczOoi8SGudg1gPQuNajLa9kImwVpU8S29QuKfi42';
    const res = await handleGooglePhotoImage(token, new Request('https://api.test/'), env, ctx);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('jpeg-bytes');
    expect(fetchMock.mock.calls[0][0]).toBe(`https://lh3.googleusercontent.com/pw/${token}=w1200`);
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

  it('includes photos filed in subfolders, keeping each subfolder together', async () => {
    const folder = (id: string, name: string) => ({ id, name, mimeType: 'application/vnd.google-apps.folder' });
    const tree: Record<string, DriveFile[]> = {
      ALBUM123456: [photo('TOP'), folder('AMRIT12345', 'Amrit'), folder('YOGESH1234', 'Yogesh')],
      AMRIT12345: [photo('A1'), photo('A2')],
      YOGESH1234: [photo('Y1'), folder('DAY2123456', 'Day 2')],
      DAY2123456: [photo('Y2')],
    };
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const parent = decodeURIComponent(url).match(/'([^']+)' in parents/)![1];
      return { ok: true, status: 200, json: async () => ({ files: tree[parent] }) };
    }));

    const res = await handleEventPhotosFolder('ALBUM123456', new Request('https://api.test/'), env, ctx);
    const body = (await res.json()) as { photos: Array<{ id: string }> };
    expect(body.photos.map((p) => p.id)).toEqual(['TOP', 'A1', 'A2', 'Y1', 'Y2']);
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

function photo(id: string, meta?: DriveFile['imageMediaMetadata'], name = `${id}.jpg`): DriveFile {
  return { id, name, mimeType: 'image/jpeg', imageMediaMetadata: meta };
}
const wide = (time?: string) => ({ width: 4000, height: 3000, time });
const tall = (time?: string) => ({ width: 3000, height: 4000, time });

describe('pickDriveCover', () => {
  it('takes a photo named "cover" over everything else', () => {
    const files = [photo('A', wide()), photo('B', tall(), 'Cover - group.jpg'), photo('C', wide())];
    expect(pickDriveCover(files)?.id).toBe('B');
    const notCovers = [
      photo('B', wide('2026:09:20 15:00:00'), 'coverage.jpg'),
      photo('A', wide('2026:09:20 17:00:00')),
      photo('C', wide('2026:09:20 19:00:00')),
    ];
    expect(pickDriveCover(notCovers)?.id).toBe('A');
  });

  it('takes a video named "cover" too, for its frame', () => {
    const clip: DriveFile = { id: 'V', name: 'cover - IMG_1241.mov', mimeType: 'video/quicktime' };
    expect(pickDriveCover([photo('A', wide()), clip])?.id).toBe('V');
  });

  it('takes the middle landscape shot by capture time', () => {
    const files = [
      photo('late', wide('2026:09:20 19:00:00')),
      photo('portrait', tall('2026:09:20 17:00:00')),
      photo('early', wide('2026:09:20 15:00:00')),
      photo('mid', wide('2026:09:20 17:30:00')),
    ];
    expect(pickDriveCover(files)?.id).toBe('mid');
  });

  it('reads a quarter-turned photo as the shape it displays at', () => {
    const turnedWide = { width: 3000, height: 4000, rotation: 1 };
    const turnedTall = { width: 4000, height: 3000, rotation: 3 };
    expect(pickDriveCover([photo('A', turnedTall), photo('B', turnedWide)])?.id).toBe('B');
  });

  it('falls back to any photo when none are landscape, then to a video frame', () => {
    const clip: DriveFile = { id: 'V', name: 'clip.mp4', mimeType: 'video/mp4' };
    expect(pickDriveCover([clip, photo('A', tall())])?.id).toBe('A');
    expect(pickDriveCover([clip])?.id).toBe('V');
    expect(pickDriveCover([])).toBeNull();
  });
});

describe('handleDriveCover', () => {
  it('rejects an invalid folder id with 400', async () => {
    const res = await handleDriveCover('bad!', new Request('https://api.test/'), env, ctx);
    expect(res.status).toBe(400);
  });

  it('asks Drive for photo shapes and serves the chosen thumbnail', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ files: [photo('IMG1234567', wide())] }) })
      .mockResolvedValueOnce(new Response('jpeg-bytes', { status: 200, headers: { 'Content-Type': 'image/jpeg' } }));
    vi.stubGlobal('fetch', fetchMock);

    const res = await handleDriveCover('FOLDER1234567', new Request('https://api.test/'), env, ctx);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('jpeg-bytes');
    const listUrl = decodeURIComponent(String(fetchMock.mock.calls[0][0]));
    expect(listUrl).toContain("mimeType contains 'image/' or mimeType contains 'video/'");
    expect(listUrl).toContain('imageMediaMetadata(width,height,rotation,time)');
    expect(fetchMock.mock.calls[1][0]).toBe('https://drive.google.com/thumbnail?id=IMG1234567&sz=w800');
  });

  it('404s when the folder is empty', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ files: [] }) }));
    const res = await handleDriveCover('FOLDER1234567', new Request('https://api.test/'), env, ctx);
    expect(res.status).toBe(404);
  });
});

describe('handleGooglePhotosCover', () => {
  const EVENT_ID = '5f0c3a52-8a8e-4d9b-9a53-1d2e3f4a5b6c';
  const TOKEN = 'AP1GczOoi8SGudg1gPQuNajLa9kImwVpU8S29QuKfi42';

  it('rejects a malformed event id with 400', async () => {
    const res = await handleGooglePhotosCover('../x', new Request('https://api.test/'), env, ctx);
    expect(res.status).toBe(400);
  });

  it('serves the album cover the share page names', async () => {
    (getSupabase as any).mockReturnValue({
      from: () => queryMock({ data: { google_photos_url: 'https://photos.app.goo.gl/abc' }, error: null }),
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          `<meta property="og:image" content="https://lh3.googleusercontent.com/pw/${TOKEN}=w600-h315-p-k">`,
      })
      .mockResolvedValueOnce(new Response('jpeg-bytes', { status: 200, headers: { 'Content-Type': 'image/jpeg' } }));
    vi.stubGlobal('fetch', fetchMock);

    const res = await handleGooglePhotosCover(EVENT_ID, new Request('https://api.test/'), env, ctx);
    expect(res.status).toBe(200);
    expect(fetchMock.mock.calls[1][0]).toBe(`https://lh3.googleusercontent.com/pw/${TOKEN}=w800`);
  });

  it('404s when the event has no album, or the album cannot be read', async () => {
    (getSupabase as any).mockReturnValue({ from: () => queryMock({ data: null, error: null }) });
    expect((await handleGooglePhotosCover(EVENT_ID, new Request('https://api.test/'), env, ctx)).status).toBe(404);

    (getSupabase as any).mockReturnValue({
      from: () => queryMock({ data: { google_photos_url: 'https://photos.app.goo.gl/abc' }, error: null }),
    });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));
    expect((await handleGooglePhotosCover(EVENT_ID, new Request('https://api.test/'), env, ctx)).status).toBe(404);
  });
});
