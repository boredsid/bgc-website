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
  capacity?: number | null;
  price?: number | null;
  venue_name?: string | null;
}

export function validateEvent(e: EventInput): ValidationErrors {
  const errs: ValidationErrors = {};
  if (!e.name || !e.name.trim()) errs.name = 'Please enter a name.';
  if (!e.date) errs.date = 'Please pick a date and time.';
  if (e.capacity == null || e.capacity < 1) errs.capacity = 'Capacity must be at least 1.';
  if (e.price != null && e.price < 0) errs.price = 'Price cannot be negative.';
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
