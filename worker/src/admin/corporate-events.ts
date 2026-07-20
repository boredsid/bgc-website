// worker/src/admin/corporate-events.ts
// CRUD for corporate (B2B) events shown on the public /corporate page, plus
// logo upload into the public `corporate-logos` storage bucket. Display-only
// records — no registration or capacity logic attaches to these rows.
import type { Env } from '../index';
import { getSupabase } from '../supabase';
import { jsonResponse } from '../validation';

const LOGO_BUCKET = 'corporate-logos';
const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const LOGO_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
};

interface CorporateEventInput {
  company_name?: string;
  title?: string | null;
  event_date?: string;
  headcount?: number | null;
  description?: string | null;
  logo_url?: string | null;
  testimonial?: string | null;
  is_published?: boolean;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function validate(body: CorporateEventInput, isCreate: boolean): string | null {
  if (isCreate || 'company_name' in body) {
    if (typeof body.company_name !== 'string' || !body.company_name.trim()) {
      return 'Company name is required';
    }
  }
  if (isCreate || 'event_date' in body) {
    if (typeof body.event_date !== 'string' || !DATE_RE.test(body.event_date) || isNaN(Date.parse(body.event_date))) {
      return 'Event date must be a valid date';
    }
  }
  if ('headcount' in body && body.headcount !== null) {
    if (typeof body.headcount !== 'number' || !Number.isInteger(body.headcount) || body.headcount < 1) {
      return 'Headcount must be a whole number of 1 or more';
    }
  }
  if ('is_published' in body && typeof body.is_published !== 'boolean') {
    return 'is_published must be true or false';
  }
  return null;
}

function toRow(body: CorporateEventInput): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if ('company_name' in body) row.company_name = body.company_name!.trim();
  if ('title' in body) row.title = body.title?.trim() || null;
  if ('event_date' in body) row.event_date = body.event_date;
  if ('headcount' in body) row.headcount = body.headcount ?? null;
  if ('description' in body) row.description = body.description?.trim() || null;
  if ('logo_url' in body) row.logo_url = body.logo_url?.trim() || null;
  if ('testimonial' in body) row.testimonial = body.testimonial?.trim() || null;
  if ('is_published' in body) row.is_published = body.is_published;
  return row;
}

export async function handleListCorporateEvents(env: Env): Promise<Response> {
  const supabase = getSupabase(env);
  const { data, error } = await supabase
    .from('corporate_events')
    .select('*')
    .order('event_date', { ascending: false });
  if (error) return jsonResponse({ error: 'Failed to load corporate events' }, 500);
  return jsonResponse({ corporate_events: data || [] });
}

export async function handleCreateCorporateEvent(request: Request, env: Env): Promise<Response> {
  const body = (await request.json().catch(() => null)) as CorporateEventInput | null;
  if (!body) return jsonResponse({ error: 'Invalid request body' }, 400);
  const err = validate(body, true);
  if (err) return jsonResponse({ error: err }, 400);

  const supabase = getSupabase(env);
  const { data, error } = await supabase
    .from('corporate_events')
    .insert(toRow(body))
    .select('*')
    .single();
  if (error) {
    console.error('[corporate-events] create failed', error);
    return jsonResponse({ error: 'Failed to create corporate event' }, 500);
  }
  return jsonResponse({ corporate_event: data });
}

export async function handleUpdateCorporateEvent(id: string, request: Request, env: Env): Promise<Response> {
  const body = (await request.json().catch(() => null)) as CorporateEventInput | null;
  if (!body) return jsonResponse({ error: 'Invalid request body' }, 400);
  const err = validate(body, false);
  if (err) return jsonResponse({ error: err }, 400);

  const updates = toRow(body);
  if (Object.keys(updates).length === 0) {
    return jsonResponse({ error: 'No fields to update' }, 400);
  }
  updates.updated_at = new Date().toISOString();

  const supabase = getSupabase(env);
  const { data, error } = await supabase
    .from('corporate_events')
    .update(updates)
    .eq('id', id)
    .select('*')
    .maybeSingle();
  if (error) return jsonResponse({ error: 'Failed to update corporate event' }, 500);
  if (!data) return jsonResponse({ error: 'Corporate event not found' }, 404);
  return jsonResponse({ corporate_event: data });
}

export async function handleDeleteCorporateEvent(id: string, env: Env): Promise<Response> {
  const supabase = getSupabase(env);
  const { error } = await supabase.from('corporate_events').delete().eq('id', id);
  if (error) return jsonResponse({ error: 'Failed to delete corporate event' }, 500);
  return jsonResponse({ success: true });
}

// Accepts { content_type, data_base64 } (JSON, so it rides the same
// fetchAdmin/Content-Type path as every other admin call), stores the image
// in the public bucket under a random name, and returns its public URL.
export async function handleUploadCorporateLogo(request: Request, env: Env): Promise<Response> {
  const body = (await request.json().catch(() => null)) as
    | { content_type?: string; data_base64?: string }
    | null;
  if (!body || typeof body.content_type !== 'string' || typeof body.data_base64 !== 'string') {
    return jsonResponse({ error: 'Invalid request body' }, 400);
  }

  const ext = LOGO_TYPES[body.content_type];
  if (!ext) return jsonResponse({ error: 'Logo must be a PNG, JPG, WebP or SVG image' }, 400);

  let bytes: Uint8Array;
  try {
    const binary = atob(body.data_base64);
    bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  } catch {
    return jsonResponse({ error: 'Invalid image data' }, 400);
  }
  if (bytes.length === 0) return jsonResponse({ error: 'Invalid image data' }, 400);
  if (bytes.length > MAX_LOGO_BYTES) {
    return jsonResponse({ error: 'Logo must be under 2 MB' }, 400);
  }

  const path = `${crypto.randomUUID()}.${ext}`;
  const supabase = getSupabase(env);
  const { error } = await supabase.storage
    .from(LOGO_BUCKET)
    .upload(path, bytes, { contentType: body.content_type });
  if (error) {
    console.error('[corporate-events] logo upload failed', error);
    return jsonResponse({ error: 'Failed to upload logo' }, 500);
  }

  const { data } = supabase.storage.from(LOGO_BUCKET).getPublicUrl(path);
  return jsonResponse({ url: data.publicUrl });
}
