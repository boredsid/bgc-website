import type { Env } from './index';
import { getSupabase } from './supabase';
import { sanitizePhone, jsonResponse } from './validation';
import { fetchReplayPassStatus } from './replay-client';
import { fetchClaimedPhones } from './replay-pass-claims';

/**
 * Check whether one number can still claim a free seat on a REPLAY-perk event.
 *
 * This is how the booking form checks the people sitting *with* the purchaser,
 * so it deliberately answers far less than `/api/lookup-phone`: a yes/no on the
 * pass and whether it has already been spent here, and nothing about who the
 * number belongs to. The purchaser is typing in somebody else's number.
 *
 * Advisory only — the price is settled by `/api/register`, which stakes the
 * actual claim.
 */
export async function handleReplayPassCheck(request: Request, env: Env): Promise<Response> {
  const body = await request
    .json<{ phone?: string; event_id?: string }>()
    .catch(() => null);

  const phone = sanitizePhone(body?.phone || '');
  if (!phone) return jsonResponse({ error: 'Invalid phone number' }, 400);
  if (!body?.event_id) return jsonResponse({ error: 'Missing event ID' }, 400);

  const supabase = getSupabase(env);

  const { data: event } = await supabase
    .from('events')
    .select('replay_pass_free')
    .eq('id', body.event_id)
    .maybeSingle();

  // Only events offering the perk get to ask REPLAY about arbitrary numbers.
  if (!event?.replay_pass_free) {
    return jsonResponse({ has_pass: false, edition_name: null, already_claimed: false });
  }

  const [status, claimed] = await Promise.all([
    fetchReplayPassStatus(env, phone),
    fetchClaimedPhones(supabase, body.event_id, [phone]),
  ]);

  return jsonResponse({
    has_pass: status.has_pass,
    edition_name: status.edition_name,
    already_claimed: claimed.has(phone),
  });
}
