// worker/src/waitlist.ts
import type { Env } from './index';
import { getSupabase } from './supabase';
import { sanitizePhone, sanitizeEmail, sanitizeName, sanitizeSource, jsonResponse } from './validation';
import { sendWaitlistEmail } from './email';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Best-effort, per-isolate dedup of double-submits. Map(`${phone}|${event_id}` -> last ms).
const RATE_LIMIT_MS = 2000;
const lastSeen = new Map<string, number>();

export function _resetWaitlistRateLimit(): void {
  lastSeen.clear();
}

interface WaitlistBody {
  event_id?: string;
  name?: string;
  phone?: string;
  email?: string;
  seats?: number;
  source?: unknown;
  user_agent?: string | null;
}

export async function handleWaitlist(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  let body: WaitlistBody;
  try {
    body = (await request.json()) as WaitlistBody;
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400);
  }

  const phone = sanitizePhone(body.phone || '');
  if (!phone) return jsonResponse({ error: 'Invalid phone number' }, 400);

  const name = sanitizeName(body.name || '');
  if (!name) return jsonResponse({ error: 'Invalid name' }, 400);

  const email = sanitizeEmail(body.email || '');
  if (!email) return jsonResponse({ error: 'Invalid email' }, 400);

  const seats = Math.floor(Number(body.seats));
  if (!Number.isFinite(seats) || seats < 1 || seats > 20) {
    return jsonResponse({ error: 'Invalid seat count' }, 400);
  }

  const eventId = (body.event_id || '').trim();
  if (!UUID_RE.test(eventId)) return jsonResponse({ error: 'Invalid event id' }, 400);

  const supabase = getSupabase(env);

  // Fetch the published event (covers existence + gives email content).
  const { data: event } = await supabase
    .from('events')
    .select('id, name, date, venue_name, venue_area, capacity, externally_managed, external_registration_url')
    .eq('id', eventId)
    .eq('is_published', true)
    .maybeSingle();

  if (!event) return jsonResponse({ error: 'Event not found' }, 404);
  if (event.externally_managed) {
    return jsonResponse({
      error: 'Registrations for this event are managed by the event partner.',
      code: 'external_registration',
      external_registration_url: event.external_registration_url,
    }, 409);
  }

  // Per-isolate rate-limit drop (double-submit guard). This happens after the
  // event-management check so a rejected external event can never look like a
  // successful waitlist join on a quick retry.
  const key = `${phone}|${eventId}`;
  const now = Date.now();
  const prev = lastSeen.get(key);
  if (prev && now - prev < RATE_LIMIT_MS) {
    return jsonResponse({ success: true });
  }
  lastSeen.set(key, now);

  // Re-check capacity server-side (same weighting as register.ts). If the event
  // is not actually full, tell the client to refresh and register normally.
  const { data: regs } = await supabase
    .from('registrations')
    .select('seats')
    .eq('event_id', eventId)
    .neq('payment_status', 'cancelled');

  const registered = (regs || []).reduce((sum: number, r: { seats: number }) => sum + r.seats, 0);
  const remaining = event.capacity - registered;
  if (remaining >= 1) {
    return jsonResponse({ available: true });
  }

  // Don't touch a lead that already converted (they're actually registered).
  const { data: existing } = await supabase
    .from('leads')
    .select('converted_at, waitlist_at')
    .eq('phone', phone)
    .eq('event_id', eventId)
    .maybeSingle();

  if (existing && existing.converted_at) {
    return jsonResponse({ success: true });
  }

  const sourceStr = sanitizeSource(body.source);
  const source = sourceStr ? { utm_source: sourceStr } : null;
  const userAgent = typeof body.user_agent === 'string' ? body.user_agent.slice(0, 500) : null;

  const nowIso = new Date().toISOString();
  const row: Record<string, unknown> = {
    phone,
    event_id: eventId,
    name,
    email,
    seats,
    last_step: 'details_entered',
    // Preserve the original join time on re-submit so FIFO position is kept.
    waitlist_at: existing?.waitlist_at ?? nowIso,
    updated_at: nowIso,
  };
  if (source) row.source = source;
  if (userAgent) row.user_agent = userAgent;

  const { error } = await supabase
    .from('leads')
    .upsert(row, { onConflict: 'phone,event_id', ignoreDuplicates: false });

  if (error) {
    return jsonResponse({ error: 'Could not join waitlist' }, 500);
  }

  ctx.waitUntil(
    sendWaitlistEmail(
      {
        to: email,
        name,
        seats,
        event: {
          name: event.name,
          date: event.date,
          venue_name: event.venue_name,
          venue_area: event.venue_area ?? null,
        },
      },
      env
    ).catch((err) => console.error('[email] waitlist send error', err))
  );

  return jsonResponse({ success: true });
}
