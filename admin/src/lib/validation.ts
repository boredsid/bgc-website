export type ValidationErrors = Record<string, string | undefined>;

const PHONE_REGEX = /^\d{10}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parsePhone(input: string): string {
  const digits = (input || '').replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  return digits;
}

export function parseRupees(input: string): number | null {
  if (typeof input !== 'string') return null;
  const cleaned = input.replace(/[₹,\s]/g, '');
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

interface EventInput {
  name?: string | null;
  date?: string | null;
  end_date?: string | null;
  capacity?: number | null;
  price?: number | null;
  venue_name?: string | null;
  externally_managed?: boolean | null;
  external_registration_url?: string | null;
  google_photos_url?: string | null;
}

// Mirrors normalizeGooglePhotosUrl in worker/src/google-photos.ts, which has the
// final say; this only exists to name the likely mix-up before Save.
function googlePhotosUrlError(raw: string): string | null {
  const value = raw.trim();
  if (/^https:\/\/photos\.app\.goo\.gl\/[A-Za-z0-9]+\/?$/.test(value)) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return 'Paste the whole link, starting with https://photos.app.goo.gl/';
  }
  if (url.hostname === 'drive.google.com') {
    return 'That\'s a Google Drive link. Drive folders show on the Photos page by themselves — this box is only for Google Photos albums.';
  }
  if (url.hostname !== 'photos.google.com') {
    return 'That isn\'t a Google Photos link. It should start with https://photos.app.goo.gl/';
  }
  if (/\/photo\//.test(url.pathname)) {
    return 'That link opens one photo. Open the whole album, tap Share → Create link, and paste that instead.';
  }
  if (/^\/(u\/\d+\/)?share\/[A-Za-z0-9_-]+\/?$/.test(url.pathname) && url.searchParams.get('key')) return null;
  return 'That\'s the album\'s private address, which only you can open. In Google Photos, open the album, tap Share → Create link, and paste that link here.';
}

export function validateEvent(e: EventInput): ValidationErrors {
  const errs: ValidationErrors = {};
  if (!e.name || !e.name.trim()) errs.name = 'Please enter a name.';
  if (!e.date) errs.date = 'Please pick a date and time.';
  if (e.end_date) {
    if (!e.date) {
      errs.end_date = 'Pick the start first.';
    } else if (Date.parse(e.end_date) < Date.parse(e.date)) {
      errs.end_date = 'The end must be on or after the start.';
    }
  }
  if (e.externally_managed) {
    const value = e.external_registration_url?.trim();
    if (!value) {
      errs.external_registration_url = 'Please enter the partner registration URL.';
    } else {
      try {
        const url = new URL(value);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
          errs.external_registration_url = 'Use a full http:// or https:// URL.';
        }
      } catch {
        errs.external_registration_url = 'Enter a valid URL, including https://.';
      }
    }
  } else {
    if (e.capacity == null || e.capacity < 1) errs.capacity = 'Capacity must be at least 1.';
    if (e.price != null && e.price < 0) errs.price = 'Price cannot be negative.';
  }
  if (e.google_photos_url?.trim()) {
    const photosError = googlePhotosUrlError(e.google_photos_url);
    if (photosError) errs.google_photos_url = photosError;
  }
  return errs;
}

interface GameInput { title?: string | null }
export function validateGame(g: GameInput): ValidationErrors {
  const errs: ValidationErrors = {};
  if (!g.title || !g.title.trim()) errs.title = 'Please enter a title.';
  return errs;
}

interface GuildMemberInput {
  tier?: string;
  amount?: number;
  status?: string;
  starts_at?: string;
  expires_at?: string;
  plus_ones_used?: number;
}
export function validateGuildMember(m: GuildMemberInput): ValidationErrors {
  const errs: ValidationErrors = {};
  if (!m.tier) errs.tier = 'Please pick a tier.';
  if (!m.status) errs.status = 'Please pick a status.';
  if (!m.starts_at) errs.starts_at = 'Please pick a start date.';
  if (!m.expires_at) errs.expires_at = 'Please pick an expiry date.';
  if (m.starts_at && m.expires_at && m.expires_at < m.starts_at) {
    errs.expires_at = 'Expiry must be after the start date.';
  }
  if (m.amount != null && m.amount < 0) errs.amount = 'Amount cannot be negative.';
  if (m.plus_ones_used != null && m.plus_ones_used < 0) errs.plus_ones_used = 'Plus-ones used cannot be negative.';
  return errs;
}

interface RegistrationInput {
  name?: string;
  phone?: string;
  email?: string | null;
  seats?: number;
  total_amount?: number;
  payment_status?: 'pending' | 'confirmed' | 'cancelled';
}
export function validateRegistration(r: RegistrationInput): ValidationErrors {
  const errs: ValidationErrors = {};
  if (!r.name || !r.name.trim()) errs.name = 'Please enter a name.';
  const phoneDigits = parsePhone(r.phone || '');
  if (!PHONE_REGEX.test(phoneDigits)) errs.phone = 'Phone must be 10 digits.';
  if (r.email && !EMAIL_REGEX.test(r.email)) errs.email = 'Please enter a valid email.';
  if (r.seats == null || r.seats < 1) errs.seats = 'Seats must be at least 1.';
  if (r.total_amount != null && r.total_amount < 0) errs.total_amount = 'Total cannot be negative.';
  return errs;
}

interface ManualRegistrationInput extends RegistrationInput { event_id?: string }
export function validateManualRegistration(r: ManualRegistrationInput): ValidationErrors {
  const errs = validateRegistration(r);
  if (!r.event_id) errs.event_id = 'Please pick an event.';
  return errs;
}

interface UserInput { name?: string | null; phone?: string; email?: string | null }
export function validateUser(u: UserInput): ValidationErrors {
  const errs: ValidationErrors = {};
  const phoneDigits = parsePhone(u.phone || '');
  if (!PHONE_REGEX.test(phoneDigits)) errs.phone = 'Phone must be 10 digits.';
  if (u.email && !EMAIL_REGEX.test(u.email)) errs.email = 'Please enter a valid email.';
  return errs;
}
