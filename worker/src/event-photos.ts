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
