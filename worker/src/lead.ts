// worker/src/lead.ts
import type { Env } from './index';
import { getSupabase } from './supabase';
import { sanitizePhone, jsonResponse } from './validation';

const VALID_STEPS = new Set(['phone_entered', 'name_entered', 'details_entered']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Best-effort, per-isolate dedup of debounce-storms. Map(`${phone}|${event_id}` -> last ms).
const RATE_LIMIT_MS = 2000;
const lastSeen = new Map<string, number>();

export function _resetLeadRateLimit(): void {
  lastSeen.clear();
}

interface LeadBody {
  phone?: string;
  name?: string | null;
  event_id?: string;
  last_step?: string;
  source?: unknown;
  user_agent?: string | null;
}

export async function handleLead(request: Request, env: Env): Promise<Response> {
  let body: LeadBody;
  try {
    body = (await request.json()) as LeadBody;
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400);
  }

  const phone = sanitizePhone(body.phone || '');
  if (!phone) return jsonResponse({ error: 'Invalid phone number' }, 400);

  const eventId = (body.event_id || '').trim();
  if (!UUID_RE.test(eventId)) return jsonResponse({ error: 'Invalid event id' }, 400);

  const lastStep = body.last_step || '';
  if (!VALID_STEPS.has(lastStep)) return jsonResponse({ error: 'Invalid last_step' }, 400);

  // Rate-limit drop
  const key = `${phone}|${eventId}`;
  const now = Date.now();
  const prev = lastSeen.get(key);
  if (prev && now - prev < RATE_LIMIT_MS) {
    return jsonResponse({ ok: true });
  }
  lastSeen.set(key, now);

  const supabase = getSupabase(env);

  // Skip if already converted.
  const { data: existing } = await supabase
    .from('leads')
    .select('converted_at')
    .eq('phone', phone)
    .eq('event_id', eventId)
    .maybeSingle();

  if (existing && existing.converted_at) {
    return jsonResponse({ ok: true });
  }

  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 200) : null;
  const source = body.source && typeof body.source === 'object' ? body.source : null;
  const userAgent = typeof body.user_agent === 'string' ? body.user_agent.slice(0, 500) : null;

  const row: Record<string, unknown> = {
    phone,
    event_id: eventId,
    last_step: lastStep,
    updated_at: new Date().toISOString(),
  };
  if (name) row.name = name;
  if (source) row.source = source;
  if (userAgent) row.user_agent = userAgent;

  const { error } = await supabase
    .from('leads')
    .upsert(row, { onConflict: 'phone,event_id', ignoreDuplicates: false });

  if (error) {
    return jsonResponse({ ok: true });
  }
  return jsonResponse({ ok: true });
}
