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
