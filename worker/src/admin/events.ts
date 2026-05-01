import type { Env } from '../index';
import { getSupabase } from '../supabase';
import { jsonResponse } from '../validation';

export async function handleListEvents(env: Env): Promise<Response> {
  const supabase = getSupabase(env);
  const { data, error } = await supabase
    .from('events')
    .select('*')
    .order('date', { ascending: false });
  if (error) return jsonResponse({ error: 'Failed to load events' }, 500);
  return jsonResponse({ events: data || [] });
}

export async function handleGetEvent(id: string, env: Env): Promise<Response> {
  const supabase = getSupabase(env);
  const { data, error } = await supabase
    .from('events')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) return jsonResponse({ error: 'Failed to load event' }, 500);
  if (!data) return jsonResponse({ error: 'Event not found' }, 404);
  return jsonResponse({ event: data });
}

const EVENT_FIELDS = [
  'name', 'description', 'date', 'venue_name', 'venue_area',
  'price', 'capacity', 'custom_questions', 'price_includes', 'is_published',
] as const;

type EventField = (typeof EVENT_FIELDS)[number];

function pickEventFields(body: Record<string, unknown>): Partial<Record<EventField, unknown>> {
  const out: Partial<Record<EventField, unknown>> = {};
  for (const f of EVENT_FIELDS) if (f in body) out[f] = body[f];
  return out;
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
  return null;
}

export async function handleCreateEvent(request: Request, env: Env): Promise<Response> {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return jsonResponse({ error: 'Invalid request body' }, 400);
  const payload = pickEventFields(body);
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

export async function handleUpdateEvent(id: string, request: Request, env: Env): Promise<Response> {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return jsonResponse({ error: 'Invalid request body' }, 400);
  const payload = pickEventFields(body);
  if (Object.keys(payload).length === 0) return jsonResponse({ error: 'No fields to update' }, 400);
  const err = validateEventPayload(payload, false);
  if (err) return jsonResponse({ error: err }, 400);

  const supabase = getSupabase(env);
  const { data, error } = await supabase
    .from('events')
    .update(payload)
    .eq('id', id)
    .select('*')
    .maybeSingle();
  if (error) return jsonResponse({ error: 'Failed to update event' }, 500);
  if (!data) return jsonResponse({ error: 'Event not found' }, 404);
  return jsonResponse({ event: data });
}
