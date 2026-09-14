import type { Env } from './index';
import { getSupabase } from './supabase';
import { sanitizePhone, jsonResponse } from './validation';
import { getUserBalance } from './credits';
import { getActivePromo } from './promos';
import { fetchReplayPassStatus } from './replay-client';
import { fetchClaimedPhones } from './replay-pass-claims';
import { getActiveMembership } from './guild';

export async function handleLookupPhone(request: Request, env: Env): Promise<Response> {
  const body = await request.json<{ phone: string; event_id?: string }>();
  const phone = sanitizePhone(body.phone || '');

  if (!phone) {
    return jsonResponse({ error: 'Invalid phone number' }, 400);
  }

  const supabase = getSupabase(env);

  const userResult = await supabase
    .from('users')
    .select('id, name, email, is_community_host')
    .eq('phone', phone)
    .maybeSingle();

  const user = userResult.data;

  const member = user ? await getActiveMembership(supabase, user.id) : null;

  let discount: string | null = null;
  let plusOnesRemaining = 0;
  if (member) {
    if (member.tier === 'adventurer') {
      discount = 'free';
      plusOnesRemaining = Math.max(0, 1 - member.plus_ones_used);
    } else if (member.tier === 'guildmaster') {
      discount = 'free';
      plusOnesRemaining = Math.max(0, 5 - member.plus_ones_used);
    } else if (member.tier === 'initiate') {
      discount = '20';
    }
  }

  let existingSeatsForEvent = 0;
  if (user && body.event_id) {
    const { data: priorRegs } = await supabase
      .from('registrations')
      .select('seats')
      .eq('event_id', body.event_id)
      .eq('user_id', user.id)
      .neq('payment_status', 'cancelled');
    existingSeatsForEvent = (priorRegs || []).reduce((sum, r) => sum + r.seats, 0);
  }

  // Only ask REPLAY when the event actually offers the perk — the cross-worker
  // call shouldn't sit on the critical path of every other event's lookup.
  let replayPass: {
    has_pass: boolean;
    edition_name: string | null;
    already_claimed: boolean;
  } | null = null;
  if (body.event_id) {
    const { data: event } = await supabase
      .from('events')
      .select('replay_pass_free')
      .eq('id', body.event_id)
      .maybeSingle();
    if (event?.replay_pass_free) {
      // `already_claimed` covers the case where someone else's booking named
      // this number as a companion — the pass is spent even though this person
      // has no registration of their own.
      const [status, claimed] = await Promise.all([
        fetchReplayPassStatus(env, phone),
        fetchClaimedPhones(supabase, body.event_id, [phone]),
      ]);
      replayPass = {
        has_pass: status.has_pass,
        edition_name: status.edition_name,
        already_claimed: claimed.has(phone),
      };
    }
  }

  const creditBalance = user ? await getUserBalance(supabase, user.id) : 0;
  const activePromo = user ? await getActivePromo(supabase, user.id) : null;

  return jsonResponse({
    user: {
      found: !!user,
      name: user?.name || null,
      email: user?.email || null,
      is_community_host: !!user?.is_community_host,
    },
    membership: {
      isMember: !!member,
      tier: member?.tier || null,
      discount,
      plus_ones_remaining: plusOnesRemaining,
      never_expires: !!member?.never_expires,
    },
    existing_seats_for_event: existingSeatsForEvent,
    replay_pass: replayPass,
    credit_balance: creditBalance,
    active_promo: activePromo
      ? {
          remaining_uses: activePromo.remaining_uses,
          max_event_price: activePromo.max_event_price,
          expires_at: activePromo.expires_at,
        }
      : null,
  });
}
