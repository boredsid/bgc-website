import type { Env } from '../index';
import { getSupabase } from '../supabase';
import { jsonResponse } from '../validation';
import { syncCfAccessGroup } from '../guest/cf-access';
import { normalizeGooglePhotosUrl } from '../google-photos';

export async function handleListEvents(env: Env): Promise<Response> {
  const supabase = getSupabase(env);
  const { data, error } = await supabase
    .from('events')
    .select('*')
    .order('date', { ascending: false });
  if (error) return jsonResponse({ error: 'Failed to load events' }, 500);
  return jsonResponse({ events: data || [] });
}

export async function handleGetEvent(id: string, env: Env, includeGuestAdmins = true): Promise<Response> {
  const supabase = getSupabase(env);
  const { data, error } = await supabase
    .from('events')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) return jsonResponse({ error: 'Failed to load event' }, 500);
  if (!data) return jsonResponse({ error: 'Event not found' }, 404);

  // Guest admins must not see the co-partner email list, so the guest path
  // omits it. Only the full-admin editor needs it to populate the form.
  if (!includeGuestAdmins) return jsonResponse({ event: data });

  const { data: guests } = await supabase
    .from('event_guest_admins')
    .select('email')
    .eq('event_id', id);

  // The editor needs to know whether the delete option applies before it offers
  // it, and what would go with the event if it did.
  const deletable = await getEventDeletability(supabase, data as { id: string; is_published: boolean; ends_at: string });

  return jsonResponse({
    event: { ...data, guest_admins: (guests || []).map((g: { email: string }) => g.email) },
    deletable,
  });
}

function normalizeEmails(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out = new Set<string>();
  for (const raw of input) {
    if (typeof raw !== 'string') continue;
    const email = raw.trim().toLowerCase();
    if (email.includes('@') && email.length <= 254) out.add(email);
  }
  return [...out];
}

async function syncEventGuests(
  supabase: ReturnType<typeof getSupabase>,
  eventId: string,
  emails: string[],
  createdBy: string,
): Promise<void> {
  const { data: existing } = await supabase
    .from('event_guest_admins')
    .select('email')
    .eq('event_id', eventId);
  const existingEmails = (existing || []).map((r: { email: string }) => r.email);

  const toAdd = emails.filter((e) => !existingEmails.includes(e));
  const toRemove = existingEmails.filter((e) => !emails.includes(e));

  if (toRemove.length > 0) {
    await supabase.from('event_guest_admins').delete().eq('event_id', eventId).in('email', toRemove);
  }
  if (toAdd.length > 0) {
    await supabase.from('event_guest_admins').upsert(
      toAdd.map((email) => ({ event_id: eventId, email, created_by: createdBy })),
    );
  }
}

// `ends_at` is deliberately absent: the database trigger derives it from
// date / end_date / is_all_day and clients must not set it.
const EVENT_FIELDS = [
  'name', 'description', 'date', 'end_date', 'is_all_day', 'venue_name', 'venue_area',
  'price', 'capacity', 'custom_questions', 'price_includes', 'llm_notes', 'is_published',
  'guild_path_exclusive', 'replay_pass_free', 'is_collaboration', 'externally_managed', 'external_registration_url',
  'google_photos_url',
] as const;

type EventField = (typeof EVENT_FIELDS)[number];

function pickEventFields(body: Record<string, unknown>): Partial<Record<EventField, unknown>> {
  const out: Partial<Record<EventField, unknown>> = {};
  for (const f of EVENT_FIELDS) if (f in body) out[f] = body[f];
  return out;
}

function normalizeTimingFields(payload: Partial<Record<EventField, unknown>>): void {
  if (typeof payload.end_date === 'string' && payload.end_date.trim() === '') {
    payload.end_date = null;
  }
}

function normalizeExternalFields(payload: Partial<Record<EventField, unknown>>): void {
  if (typeof payload.external_registration_url === 'string') {
    payload.external_registration_url = payload.external_registration_url.trim();
  }
  if (payload.externally_managed === true) {
    payload.price = 0;
    payload.capacity = 0;
    payload.custom_questions = [];
    payload.price_includes = null;
    payload.guild_path_exclusive = false;
    payload.replay_pass_free = false;
    payload.is_collaboration = false;
  } else if (payload.externally_managed === false) {
    payload.external_registration_url = null;
  }
}

// Blank clears the album. Anything else is stored in its canonical share-link
// form; a link that isn't one stays as typed so validation can reject it.
function normalizePhotosField(payload: Partial<Record<EventField, unknown>>): void {
  if (typeof payload.google_photos_url !== 'string') return;
  const trimmed = payload.google_photos_url.trim();
  payload.google_photos_url = trimmed === '' ? null : normalizeGooglePhotosUrl(trimmed) ?? trimmed;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

// The end can only be checked against the start, and a PATCH may carry just one
// of the two, so the caller supplies whatever the stored row already holds.
interface ExistingTiming { date?: string | null; end_date?: string | null }

function validateEventPayload(
  payload: Partial<Record<EventField, unknown>>,
  requireAll: boolean,
  existing: ExistingTiming = {},
): string | null {
  if (requireAll || 'name' in payload) {
    if (typeof payload.name !== 'string' || payload.name.trim().length === 0) return 'Name is required';
  }
  if (requireAll || 'date' in payload) {
    if (typeof payload.date !== 'string' || isNaN(Date.parse(payload.date as string))) return 'Date is required and must be a valid date';
  }
  if ('is_all_day' in payload && typeof payload.is_all_day !== 'boolean') {
    return 'All day must be true or false';
  }
  if ('end_date' in payload && payload.end_date !== null) {
    if (typeof payload.end_date !== 'string' || isNaN(Date.parse(payload.end_date))) {
      return 'End date must be a valid date, or empty for a single-day event';
    }
  }
  const startIso = 'date' in payload ? (payload.date as string) : existing.date;
  const endIso = 'end_date' in payload ? (payload.end_date as string | null) : existing.end_date;
  if (typeof startIso === 'string' && typeof endIso === 'string') {
    if (Date.parse(endIso) < Date.parse(startIso)) return 'End date must be on or after the start date';
  }
  if ('price' in payload && (typeof payload.price !== 'number' || payload.price < 0)) return 'Price must be a non-negative number';
  if ('capacity' in payload && (typeof payload.capacity !== 'number' || payload.capacity < 0)) return 'Capacity must be a non-negative number';
  if ('custom_questions' in payload && payload.custom_questions !== null && !Array.isArray(payload.custom_questions)) return 'Custom questions must be a list';
  if ('externally_managed' in payload && typeof payload.externally_managed !== 'boolean') {
    return 'Externally managed must be true or false';
  }
  if ('external_registration_url' in payload && payload.external_registration_url !== null) {
    if (typeof payload.external_registration_url !== 'string' || !isHttpUrl(payload.external_registration_url)) {
      return 'External registration URL must be a full http:// or https:// URL';
    }
  }
  if (payload.externally_managed === true && typeof payload.external_registration_url !== 'string') {
    return 'External registration URL is required';
  }
  if ('google_photos_url' in payload && payload.google_photos_url !== null) {
    if (typeof payload.google_photos_url !== 'string' || !normalizeGooglePhotosUrl(payload.google_photos_url)) {
      return 'Google Photos album link must be the album\'s share link (Share → Create link in Google Photos), starting with https://photos.app.goo.gl/';
    }
  }
  return null;
}

export async function handleCreateEvent(request: Request, env: Env): Promise<Response> {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return jsonResponse({ error: 'Invalid request body' }, 400);
  const payload = pickEventFields(body);
  normalizeTimingFields(payload);
  normalizeExternalFields(payload);
  normalizePhotosField(payload);
  const err = validateEventPayload(payload, true);
  if (err) return jsonResponse({ error: err }, 400);

  const supabase = getSupabase(env);
  const { data, error } = await supabase
    .from('events')
    .insert(payload)
    .select('*')
    .single();
  if (error || !data) return jsonResponse({ error: 'Failed to create event' }, 500);
  return jsonResponse({ event: data }, 201);
}

export async function handleUpdateEvent(
  id: string,
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  adminEmail: string,
): Promise<Response> {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return jsonResponse({ error: 'Invalid request body' }, 400);
  const payload = pickEventFields(body);
  normalizeTimingFields(payload);
  normalizeExternalFields(payload);
  normalizePhotosField(payload);
  const hasGuests = 'guest_admins' in body || payload.externally_managed === true;
  if (Object.keys(payload).length === 0 && !hasGuests) return jsonResponse({ error: 'No fields to update' }, 400);

  const supabase = getSupabase(env);

  // Only one half of the start/end pair may be changing; read the other half so
  // the ordering check runs against what the row will actually look like.
  let existingTiming: ExistingTiming = {};
  const touchesTiming = 'date' in payload || 'end_date' in payload;
  if (touchesTiming && !('date' in payload && 'end_date' in payload)) {
    const { data: current } = await supabase.from('events').select('date, end_date').eq('id', id).maybeSingle();
    if (!current) return jsonResponse({ error: 'Event not found' }, 404);
    existingTiming = current as ExistingTiming;
  }

  const err = validateEventPayload(payload, false, existingTiming);
  if (err) return jsonResponse({ error: err }, 400);

  let data: Record<string, unknown> | null = null;
  if (Object.keys(payload).length > 0) {
    const result = await supabase.from('events').update(payload).eq('id', id).select('*').maybeSingle();
    if (result.error) return jsonResponse({ error: 'Failed to update event' }, 500);
    if (!result.data) return jsonResponse({ error: 'Event not found' }, 404);
    data = result.data;
  } else {
    const result = await supabase.from('events').select('*').eq('id', id).maybeSingle();
    if (!result.data) return jsonResponse({ error: 'Event not found' }, 404);
    data = result.data;
  }

  if (hasGuests) {
    await syncEventGuests(supabase, id, normalizeEmails(body.guest_admins), adminEmail);
    ctx.waitUntil(syncCfAccessGroup(env));
  }

  return jsonResponse({ event: data });
}

// ---------------------------------------------------------------------------
// Deletion
//
// Deleting an event is only ever allowed to tidy up a mistake: a draft that was
// never shown to anyone and hasn't happened yet. Anything a person or the books
// touched stays put, so the reason for the block is phrased as the next thing
// the admin should do about it.
// ---------------------------------------------------------------------------

export type DeleteBlocker = 'published' | 'past' | 'registrations' | 'finance';

export interface EventDeletability {
  allowed: boolean;
  /** Plain-English reason plus the fix, when something blocks the delete. */
  reason: string | null;
  blocked_by: DeleteBlocker | null;
  /** Rows that would be deleted along with the event, for the confirmation. */
  leads: number;
  guest_admins: number;
}

async function countRows(
  supabase: ReturnType<typeof getSupabase>,
  table: string,
  eventId: string,
): Promise<number> {
  const { count } = await supabase
    .from(table)
    .select('id', { count: 'exact', head: true })
    .eq('event_id', eventId);
  return count || 0;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export async function getEventDeletability(
  supabase: ReturnType<typeof getSupabase>,
  event: { id: string; is_published?: boolean | null; ends_at?: string | null },
): Promise<EventDeletability> {
  const blocked = (blocked_by: DeleteBlocker, reason: string): EventDeletability =>
    ({ allowed: false, reason, blocked_by, leads: 0, guest_admins: 0 });

  if (event.is_published) {
    return blocked('published', 'This event is live on the website. Switch Published off and save, then you can delete it.');
  }
  // Upcoming is judged on ends_at, never date, so an event part-way through its
  // run still counts as happening rather than as a deletable draft.
  const endsAt = event.ends_at ? Date.parse(event.ends_at) : NaN;
  if (!Number.isNaN(endsAt) && endsAt <= Date.now()) {
    return blocked('past', "This event has already finished. Past events are kept for the records, so it can't be deleted.");
  }

  const registrations = await countRows(supabase, 'registrations', event.id);
  if (registrations > 0) {
    return blocked(
      'registrations',
      `${plural(registrations, 'person has', 'people have')} registered for this event. Cancel their registrations first, then you can delete it.`,
    );
  }

  const financeEntries = await countRows(supabase, 'finance_transactions', event.id);
  if (financeEntries > 0) {
    return blocked(
      'finance',
      `${plural(financeEntries, 'money entry is', 'money entries are')} linked to this event. Unlink them in Finance first, then you can delete it.`,
    );
  }

  const [leads, guestAdmins] = await Promise.all([
    countRows(supabase, 'leads', event.id),
    countRows(supabase, 'event_guest_admins', event.id),
  ]);

  return { allowed: true, reason: null, blocked_by: null, leads, guest_admins: guestAdmins };
}

export async function handleDeleteEvent(id: string, env: Env, ctx: ExecutionContext): Promise<Response> {
  const supabase = getSupabase(env);
  const { data: event, error } = await supabase
    .from('events')
    .select('id, name, is_published, ends_at')
    .eq('id', id)
    .maybeSingle();
  if (error) return jsonResponse({ error: 'Failed to load event' }, 500);
  if (!event) return jsonResponse({ error: 'Event not found' }, 404);

  // Re-checked here rather than trusted from the editor: the browser's copy can
  // be minutes old, and by then someone may have registered.
  const deletable = await getEventDeletability(supabase, event as { id: string; is_published: boolean; ends_at: string });
  if (!deletable.allowed) return jsonResponse({ error: deletable.reason }, 409);

  const { error: deleteError } = await supabase.from('events').delete().eq('id', id);
  if (deleteError) return jsonResponse({ error: 'Failed to delete event' }, 500);

  // Guest admins go with the event via cascade, so the Access group that lets
  // them reach the admin tool at all has to be rebuilt without them.
  if (deletable.guest_admins > 0) ctx.waitUntil(syncCfAccessGroup(env));

  return jsonResponse({ success: true, deleted: { leads: deletable.leads, guest_admins: deletable.guest_admins } });
}
