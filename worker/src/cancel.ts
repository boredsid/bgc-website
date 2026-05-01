import { getSupabase } from './supabase';
import { jsonResponse } from './validation';
import type { Env } from './index';

export async function handleCancelRegistration(request: Request, env: Env): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { registration_id?: string } | null;
  if (!body?.registration_id) {
    return jsonResponse({ error: 'registration_id required' }, 400);
  }

  const supabase = getSupabase(env);

  const { data: reg, error: fetchError } = await supabase
    .from('registrations')
    .select('id, user_id, payment_status, plus_ones_consumed, discount_applied')
    .eq('id', body.registration_id)
    .maybeSingle();

  if (fetchError || !reg) {
    return jsonResponse({ error: 'Registration not found' }, 404);
  }

  if (reg.payment_status === 'cancelled') {
    return jsonResponse({ success: true, already_cancelled: true });
  }

  const { error: updateError } = await supabase
    .from('registrations')
    .update({ payment_status: 'cancelled' })
    .eq('id', reg.id);

  if (updateError) {
    return jsonResponse({ error: 'Cancel failed' }, 500);
  }

  let plusOnesRefunded = 0;
  if (
    reg.plus_ones_consumed > 0 &&
    reg.user_id &&
    (reg.discount_applied === 'adventurer' || reg.discount_applied === 'guildmaster')
  ) {
    // Refund to the user's most recent paid membership. In practice users hold
    // at most one active membership at a time, so this is the one that was
    // debited at registration.
    const { data: member } = await supabase
      .from('guild_path_members')
      .select('id, plus_ones_used')
      .eq('user_id', reg.user_id)
      .eq('status', 'paid')
      .order('starts_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (member) {
      const newUsed = Math.max(0, member.plus_ones_used - reg.plus_ones_consumed);
      await supabase
        .from('guild_path_members')
        .update({ plus_ones_used: newUsed })
        .eq('id', member.id);
      plusOnesRefunded = member.plus_ones_used - newUsed;
    }
  }

  return jsonResponse({ success: true, plus_ones_refunded: plusOnesRefunded });
}

export async function handleCancelGuildMembership(request: Request, env: Env): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { membership_id?: string } | null;
  if (!body?.membership_id) {
    return jsonResponse({ error: 'membership_id required' }, 400);
  }

  const supabase = getSupabase(env);

  const { data: member, error: fetchError } = await supabase
    .from('guild_path_members')
    .select('id, status')
    .eq('id', body.membership_id)
    .maybeSingle();

  if (fetchError || !member) {
    return jsonResponse({ error: 'Membership not found' }, 404);
  }

  if (member.status === 'cancelled') {
    return jsonResponse({ success: true, already_cancelled: true });
  }

  const { error: updateError } = await supabase
    .from('guild_path_members')
    .update({ status: 'cancelled' })
    .eq('id', member.id);

  if (updateError) {
    return jsonResponse({ error: 'Cancel failed' }, 500);
  }

  return jsonResponse({ success: true });
}
