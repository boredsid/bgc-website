import type { Env } from '../index';
import { getSupabase } from '../supabase';
import { jsonResponse } from '../validation';
import { syncCfAccessGroup } from '../guest/cf-access';

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
  return jsonResponse({ event: { ...data, guest_admins: (guests || []).map((g: { email: string }) => g.email) } });
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

const EVENT_FIELDS = [
  'name', 'description', 'date', 'venue_name', 'venue_area',
  'price', 'capacity', 'custom_questions', 'price_includes', 'llm_notes', 'is_published',
  'guild_path_exclusive', 'is_collaboration', 'externally_managed', 'external_registration_url',
] as const;

type EventField = (typeof EVENT_FIELDS)[number];

function pickEventFields(body: Record<string, unknown>): Partial<Record<EventField, unknown>> {
  const out: Partial<Record<EventField, unknown>> = {};
  for (const f of EVENT_FIELDS) if (f in body) out[f] = body[f];
  return out;
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
    payload.is_collaboration = false;
  } else if (payload.externally_managed === false) {
    payload.external_registration_url = null;
  }
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function validateEventPayload(payload: Partial<Record<EventField, unknown>>, requireAll: boolean): string | null {
  if (requireAll || 'name' in payload) {
    if (typeof payload.name !== 'string' || payload.name.trim().length === 0) return 'Name is required';
  }
  if (requireAll || 'date' in payload) {
    if (typeof payload.date !== 'string' || isNaN(Date.parse(payload.date as string))) return 'Date is required and must be a valid date';
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
  return null;
}

export async function handleCreateEvent(request: Request, env: Env): Promise<Response> {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return jsonResponse({ error: 'Invalid request body' }, 400);
  const payload = pickEventFields(body);
  normalizeExternalFields(payload);
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
  normalizeExternalFields(payload);
  const hasGuests = 'guest_admins' in body || payload.externally_managed === true;
  if (Object.keys(payload).length === 0 && !hasGuests) return jsonResponse({ error: 'No fields to update' }, 400);
  const err = validateEventPayload(payload, false);
  if (err) return jsonResponse({ error: err }, 400);

  const supabase = getSupabase(env);

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
