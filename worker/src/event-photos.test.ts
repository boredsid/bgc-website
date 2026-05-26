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
