import type { Env } from './index';
import { getSupabase } from './supabase';
import { sanitizePhone, jsonResponse } from './validation';

export async function handleLookupPhone(request: Request, env: Env): Promise<Response> {
  const body = await request.json<{ phone: string; event_id?: string }>();
  const phone = sanitizePhone(body.phone || '');

  if (!phone) {
    return jsonResponse({ error: 'Invalid phone number' }, 400);
  }

  const supabase = getSupabase(env);

  const userResult = await supabase
    .from('users')
    .select('id, name, email')
    .eq('phone', phone)
    .maybeSingle();

  const user = userResult.data;

  let member:
    | { tier: string; expires_at: string; plus_ones_used: number }
    | null = null;

  if (user) {
    const memberResult = await supabase
      .from('guild_path_members')
      .select('tier, expires_at, plus_ones_used')
      .eq('user_id', user.id)
      .eq('status', 'paid')
      .gte('expires_at', new Date().toISOString().split('T')[0])
      .order('expires_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    member = memberResult.data;
  }

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
      .eq('user_id', user.id);
    existingSeatsForEvent = (priorRegs || []).reduce((sum, r) => sum + r.seats, 0);
  }

  return jsonResponse({
    user: {
      found: !!user,
      name: user?.name || null,
      email: user?.email || null,
    },
    membership: {
      isMember: !!member,
      tier: member?.tier || null,
      discount,
      plus_ones_remaining: plusOnesRemaining,
    },
    existing_seats_for_event: existingSeatsForEvent,
  });
}
