import type { Env } from '../index';
import { getSupabase } from '../supabase';
import { jsonResponse } from '../validation';

const GM_FIELDS = [
  'tier', 'amount', 'status', 'starts_at', 'expires_at', 'plus_ones_used', 'source',
  'payment_account_id', 'paid_at', 'payment_method',
] as const;
type GMField = (typeof GM_FIELDS)[number];

function pickGM(body: Record<string, unknown>): Partial<Record<GMField, unknown>> {
  const out: Partial<Record<GMField, unknown>> = {};
  for (const f of GM_FIELDS) if (f in body) out[f] = body[f];
  return out;
}

function validateGM(p: Partial<Record<GMField, unknown>>): string | null {
  if ('tier' in p && !['initiate', 'adventurer', 'guildmaster'].includes(p.tier as string)) return 'Tier must be initiate, adventurer, or guildmaster';
  if ('status' in p && !['pending', 'paid', 'cancelled'].includes(p.status as string)) return 'Status must be pending, paid, or cancelled';
  if ('amount' in p && (typeof p.amount !== 'number' || p.amount < 0)) return 'Amount must be non-negative';
  if ('plus_ones_used' in p && (typeof p.plus_ones_used !== 'number' || p.plus_ones_used < 0)) return 'Plus-ones used must be non-negative';
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

export async function handleListGuildMembers(url: URL, env: Env): Promise<Response> {
  const supabase = getSupabase(env);
  const status = url.searchParams.get('status');
  const tier = url.searchParams.get('tier');

  let q = supabase
    .from('guild_path_members')
    .select('*, users:user_id(name, phone, email)')
    .order('expires_at', { ascending: false });
  if (status) q = q.eq('status', status);
  if (tier) q = q.eq('tier', tier);

  const { data, error } = await q;
  if (error) return jsonResponse({ error: 'Failed to load guild members' }, 500);

  const members = (data || []).map((m: any) => ({
    id: m.id,
    user_id: m.user_id,
    tier: m.tier,
    amount: m.amount,
    status: m.status,
    starts_at: m.starts_at,
    expires_at: m.expires_at,
    plus_ones_used: m.plus_ones_used,
    source: m.source,
    payment_account_id: m.payment_account_id ?? null,
    paid_at: m.paid_at ?? null,
    payment_method: m.payment_method ?? null,
    payment_recorded_by: m.payment_recorded_by ?? null,
    user_name: m.users?.name ?? null,
    user_phone: m.users?.phone ?? '',
    user_email: m.users?.email ?? null,
  }));
  return jsonResponse({ members });
}

export async function handleGetGuildMember(id: string, env: Env): Promise<Response> {
  const supabase = getSupabase(env);
  const { data, error } = await supabase
    .from('guild_path_members')
    .select('*, users:user_id(name, phone, email)')
    .eq('id', id)
    .maybeSingle();
  if (error) return jsonResponse({ error: 'Failed to load guild member' }, 500);
  if (!data) return jsonResponse({ error: 'Guild member not found' }, 404);
  const m: any = data;
  return jsonResponse({
    member: {
      id: m.id, user_id: m.user_id, tier: m.tier, amount: m.amount, status: m.status,
      starts_at: m.starts_at, expires_at: m.expires_at, plus_ones_used: m.plus_ones_used, source: m.source,
      payment_account_id: m.payment_account_id ?? null, paid_at: m.paid_at ?? null,
      payment_method: m.payment_method ?? null, payment_recorded_by: m.payment_recorded_by ?? null,
      user_name: m.users?.name ?? null, user_phone: m.users?.phone ?? '', user_email: m.users?.email ?? null,
    },
  });
}

export async function handleUpdateGuildMember(
  id: string,
  request: Request,
  env: Env,
  adminEmail = 'system:admin',
): Promise<Response> {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return jsonResponse({ error: 'Invalid request body' }, 400);
  const payload = pickGM(body);
  if (Object.keys(payload).length === 0) return jsonResponse({ error: 'No fields to update' }, 400);
  const err = validateGM(payload);
  if (err) return jsonResponse({ error: err }, 400);
  const supabase = getSupabase(env);

  const { data: prior, error: priorError } = await supabase
    .from('guild_path_members')
    .select('id,status,amount,payment_account_id,paid_at,payment_method')
    .eq('id', id)
    .maybeSingle();
  if (priorError) return jsonResponse({ error: 'Failed to load Guild member' }, 500);
  if (!prior) return jsonResponse({ error: 'Guild member not found' }, 404);

  const nextStatus = (payload.status as string | undefined) ?? prior.status;
  const nextAmount = typeof payload.amount === 'number' ? payload.amount : prior.amount;
  const nextAccount = payload.payment_account_id ?? prior.payment_account_id;
  const nextPaidAt = payload.paid_at ?? prior.paid_at;
  const nextPaymentMethod = payload.payment_method ?? prior.payment_method;
  const activatingPayment = nextStatus === 'paid' && prior.status !== 'paid';
  const editingPaidPayment = nextStatus === 'paid'
    && prior.status === 'paid'
    && ['amount', 'payment_account_id', 'paid_at', 'payment_method'].some((field) => field in payload);
  if ((activatingPayment || editingPaidPayment) && nextAmount > 0) {
    if (!nextAccount || !nextPaidAt || !nextPaymentMethod) {
      return jsonResponse({
        error: 'Choose where and when payment was received before marking this membership paid.',
        code: 'payment_details_required',
      }, 400);
    }
    (payload as Record<string, unknown>).payment_recorded_by = adminEmail;
  }

  const { data, error } = await supabase.from('guild_path_members').update(payload).eq('id', id).select('*').maybeSingle();
  if (error) {
    console.error('[guild-members] update failed', error);
    return jsonResponse({ error: 'Failed to update' }, 500);
  }
  if (!data) return jsonResponse({ error: 'Guild member not found' }, 404);
  return jsonResponse({ member: data });
}
