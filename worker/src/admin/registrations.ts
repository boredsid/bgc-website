import type { Env } from '../index';
import { getSupabase } from '../supabase';
import { jsonResponse } from '../validation';

const REG_FIELDS = [
  'event_id', 'name', 'phone', 'email', 'seats', 'total_amount',
  'discount_applied', 'custom_answers', 'payment_status', 'plus_ones_consumed', 'source',
] as const;

type RegField = (typeof REG_FIELDS)[number];

function pickRegFields(body: Record<string, unknown>): Partial<Record<RegField, unknown>> {
  const out: Partial<Record<RegField, unknown>> = {};
  for (const f of REG_FIELDS) if (f in body) out[f] = body[f];
  return out;
}

function validateRegPayload(p: Partial<Record<RegField, unknown>>): string | null {
  if ('payment_status' in p && !['pending', 'confirmed', 'cancelled'].includes(p.payment_status as string)) {
    return 'Payment status must be pending, confirmed, or cancelled';
  }
  if ('seats' in p && (typeof p.seats !== 'number' || p.seats < 1)) return 'Seats must be at least 1';
  if ('total_amount' in p && (typeof p.total_amount !== 'number' || p.total_amount < 0)) return 'Total amount must be non-negative';
  return null;
}

export async function handleListRegistrations(url: URL, env: Env): Promise<Response> {
  const supabase = getSupabase(env);
  const eventId = url.searchParams.get('event_id');
  const status = url.searchParams.get('status');

  let q = supabase.from('registrations').select('*').order('created_at', { ascending: false });
  if (eventId) q = q.eq('event_id', eventId);
  if (status) q = q.eq('payment_status', status);

  const { data, error } = await q;
  if (error) return jsonResponse({ error: 'Failed to load registrations' }, 500);
  return jsonResponse({ registrations: data || [] });
}

export async function handleGetRegistration(id: string, env: Env): Promise<Response> {
  const supabase = getSupabase(env);
  const { data, error } = await supabase.from('registrations').select('*').eq('id', id).maybeSingle();
  if (error) return jsonResponse({ error: 'Failed to load registration' }, 500);
  if (!data) return jsonResponse({ error: 'Registration not found' }, 404);
  return jsonResponse({ registration: data });
}

export async function handleUpdateRegistration(id: string, request: Request, env: Env): Promise<Response> {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return jsonResponse({ error: 'Invalid request body' }, 400);
  const payload = pickRegFields(body);
  if (Object.keys(payload).length === 0) return jsonResponse({ error: 'No fields to update' }, 400);
  const err = validateRegPayload(payload);
  if (err) return jsonResponse({ error: err }, 400);
  const supabase = getSupabase(env);
  const { data, error } = await supabase.from('registrations').update(payload).eq('id', id).select('*').maybeSingle();
  if (error) return jsonResponse({ error: 'Failed to update registration' }, 500);
  if (!data) return jsonResponse({ error: 'Registration not found' }, 404);
  return jsonResponse({ registration: data });
}
