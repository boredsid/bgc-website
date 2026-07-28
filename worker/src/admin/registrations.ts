import type { Env } from '../index';
import { getSupabase } from '../supabase';
import { jsonResponse } from '../validation';
import { getUserBalance, recordCreditEvent } from '../credits';
import { consumePromoUses, restorePromoUses, type ActivePromo } from '../promos';
import { currentBangaloreDate } from '../finance-date';

const REG_FIELDS = [
  'event_id', 'name', 'phone', 'email', 'seats', 'total_amount',
  'discount_applied', 'custom_answers', 'payment_status', 'plus_ones_consumed', 'source',
  'payment_account_id', 'paid_at', 'payment_method',
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
  if ('payment_account_id' in p && p.payment_account_id !== null && typeof p.payment_account_id !== 'string') {
    return 'Choose a valid payment account';
  }
  if ('paid_at' in p && p.paid_at !== null && (typeof p.paid_at !== 'string' || Number.isNaN(Date.parse(p.paid_at)))) {
    return 'Payment date must be valid';
  }
  if (
    'payment_method' in p
    && p.payment_method !== null
    && !['upi', 'cash', 'bank_transfer', 'card', 'other'].includes(p.payment_method as string)
  ) {
    return 'Choose a valid payment method';
  }
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

export async function handleUpdateRegistration(
  id: string,
  request: Request,
  env: Env,
  adminEmail = 'system:admin',
  useDefaultPaymentAccount = false,
): Promise<Response> {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return jsonResponse({ error: 'Invalid request body' }, 400);
  const payload = pickRegFields(body);
  if (Object.keys(payload).length === 0) return jsonResponse({ error: 'No fields to update' }, 400);
  const err = validateRegPayload(payload);
  if (err) return jsonResponse({ error: err }, 400);

  const supabase = getSupabase(env);

  const { data: prior, error: priorError } = await supabase
    .from('registrations')
    .select('id, user_id, payment_status, total_amount, credits_applied, promo_id, promo_uses_consumed, payment_account_id, paid_at, payment_method')
    .eq('id', id)
    .maybeSingle();
  if (priorError) return jsonResponse({ error: 'Failed to load registration' }, 500);
  if (!prior) return jsonResponse({ error: 'Registration not found' }, 404);

  const newStatus = payload.payment_status as 'pending' | 'confirmed' | 'cancelled' | undefined;
  const transitioningToCancelled = newStatus === 'cancelled' && prior.payment_status === 'confirmed';
  const transitioningToConfirmed = newStatus === 'confirmed' && prior.payment_status === 'cancelled';
  const refundAmount = (prior.total_amount || 0) + (prior.credits_applied || 0);
  const nextStatus = newStatus ?? prior.payment_status;
  const nextAmount = typeof payload.total_amount === 'number' ? payload.total_amount : prior.total_amount;
  let nextAccount = payload.payment_account_id ?? prior.payment_account_id;
  let nextPaidAt = payload.paid_at ?? prior.paid_at;
  let nextPaymentMethod = payload.payment_method ?? prior.payment_method;
  const activatingPayment = newStatus === 'confirmed' && prior.payment_status !== 'confirmed';
  const editingConfirmedPayment = prior.payment_status === 'confirmed'
    && nextStatus === 'confirmed'
    && (
      'total_amount' in payload
      || 'payment_account_id' in payload
      || 'paid_at' in payload
      || 'payment_method' in payload
    );

  if (transitioningToConfirmed && prior.user_id && refundAmount > 0) {
    const balance = await getUserBalance(supabase, prior.user_id);
    if (balance < refundAmount) {
      return jsonResponse({
        error: `Cannot reverse — credits from this cancellation already spent (₹${refundAmount} needed, ₹${balance} available).`,
      }, 400);
    }
  }

  if ((activatingPayment || editingConfirmedPayment) && nextAmount > 0) {
    if ((!nextAccount || !nextPaidAt || !nextPaymentMethod) && useDefaultPaymentAccount) {
      const { data: defaultAccount } = await supabase
        .from('finance_accounts')
        .select('id')
        .eq('is_default', true)
        .eq('is_active', true)
        .maybeSingle();
      if (defaultAccount) {
        nextAccount = defaultAccount.id;
        nextPaidAt = currentBangaloreDate();
        nextPaymentMethod = 'upi';
        payload.payment_account_id = nextAccount;
        payload.paid_at = nextPaidAt;
        payload.payment_method = nextPaymentMethod;
      }
    }
    if (!nextAccount || !nextPaidAt || !nextPaymentMethod) {
      return jsonResponse({
        error: useDefaultPaymentAccount
          ? 'A full admin must set a default finance account before guest admins can confirm payments.'
          : 'Choose where and when payment was received before marking this registration confirmed.',
        code: 'payment_details_required',
      }, 400);
    }
    (payload as Record<string, unknown>).payment_recorded_by = adminEmail;
  }

  const { data, error } = await supabase
    .from('registrations')
    .update(payload)
    .eq('id', id)
    .select('*')
    .maybeSingle();
  if (error) {
    console.error('[registrations] update failed', error);
    return jsonResponse({ error: 'Failed to update registration' }, 500);
  }
  if (!data) return jsonResponse({ error: 'Registration not found' }, 404);

  if (transitioningToCancelled && prior.user_id && refundAmount > 0) {
    await recordCreditEvent(supabase, {
      user_id: prior.user_id,
      amount: refundAmount,
      reason: 'cancellation',
      registration_id: id,
    }, { ignoreDuplicate: true });
  }
  if (transitioningToConfirmed && prior.user_id && refundAmount > 0) {
    await recordCreditEvent(supabase, {
      user_id: prior.user_id,
      amount: -refundAmount,
      reason: 'cancellation_reversal',
      registration_id: id,
    }, { ignoreDuplicate: true });
  }

  // Promo: restore on cancel, re-consume on un-cancel (best-effort, mirrors credits).
  if (transitioningToCancelled && prior.promo_id && prior.promo_uses_consumed > 0) {
    await restorePromoUses(supabase, prior.promo_id, prior.promo_uses_consumed);
  }
  if (transitioningToConfirmed && prior.promo_id && prior.promo_uses_consumed > 0) {
    const { data: promoRow } = await supabase
      .from('user_promos')
      .select('id, remaining_uses, max_event_price, expires_at')
      .eq('id', prior.promo_id)
      .maybeSingle();
    if (promoRow) {
      await consumePromoUses(supabase, promoRow as ActivePromo, prior.promo_uses_consumed);
    }
  }

  return jsonResponse({ registration: data });
}
