import { getSupabase } from './supabase';
import { jsonResponse } from './validation';
import { recordCreditEvent } from './credits';
import { restorePromoUses } from './promos';
import type { Env } from './index';

export async function handleCancelRegistration(request: Request, env: Env): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { registration_id?: string } | null;
  if (!body?.registration_id) {
    return jsonResponse({ error: 'registration_id required' }, 400);
  }

  const supabase = getSupabase(env);

  const { data: reg, error: fetchError } = await supabase
    .from('registrations')
    .select('id, user_id, payment_status, plus_ones_consumed, discount_applied, total_amount, credits_applied, promo_id, promo_uses_consumed')
    .eq('id', body.registration_id)
    .maybeSingle();

  if (fetchError || !reg) {
    return jsonResponse({ error: 'Registration not found' }, 404);
  }

  if (reg.payment_status === 'cancelled') {
    return jsonResponse({ success: true, already_cancelled: true });
  }

  const wasConfirmed = reg.payment_status === 'confirmed';

  const { error: updateError } = await supabase
    .from('registrations')
    .update({ payment_status: 'cancelled' })
    .eq('id', reg.id);

  if (updateError) {
    return jsonResponse({ error: 'Cancel failed' }, 500);
  }

  if (wasConfirmed && reg.user_id) {
    const refund = (reg.total_amount || 0) + (reg.credits_applied || 0);
    if (refund > 0) {
      await recordCreditEvent(supabase, {
        user_id: reg.user_id,
        amount: refund,
        reason: 'cancellation',
        registration_id: reg.id,
      }, { ignoreDuplicate: true });
    }
  }

  // Restore promo uses if any were consumed by this registration. Guarded by
  // payment_status above so re-cancelling a cancelled reg is a no-op.
  if (wasConfirmed && reg.promo_id && reg.promo_uses_consumed > 0) {
    await restorePromoUses(supabase, reg.promo_id, reg.promo_uses_consumed);
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
