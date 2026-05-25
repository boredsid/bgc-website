import type { Env } from '../index';
import { getSupabase } from '../supabase';
import { sanitizePhone, jsonResponse } from '../validation';

export async function handleGuestLookupPhone(
  request: Request,
  env: Env,
  allowedEvents: Set<string>,
): Promise<Response> {
  const body = await request.json<{ phone?: string; event_id?: string }>().catch(() => null);
  const phone = sanitizePhone(body?.phone || '');
  if (!phone) return jsonResponse({ error: 'Invalid phone number' }, 400);
  if (body?.event_id && !allowedEvents.has(body.event_id)) {
    return jsonResponse({ error: 'Forbidden' }, 403);
  }

  const supabase = getSupabase(env);
  const { data: user } = await supabase
    .from('users')
    .select('id, name, email')
    .eq('phone', phone)
    .maybeSingle();

  let existingSeats = 0;
  if (user && body?.event_id) {
    const { data: priorRegs } = await supabase
      .from('registrations')
      .select('seats')
      .eq('event_id', body.event_id)
      .eq('user_id', user.id)
      .neq('payment_status', 'cancelled');
    existingSeats = (priorRegs || []).reduce((sum: number, r: { seats: number }) => sum + r.seats, 0);
  }

  return jsonResponse({
    user: { found: !!user, name: user?.name || null, email: user?.email || null },
    existing_seats_for_event: existingSeats,
  });
}
