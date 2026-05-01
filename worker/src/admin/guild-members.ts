import type { Env } from '../index';
import { getSupabase } from '../supabase';
import { jsonResponse } from '../validation';

const GM_FIELDS = ['tier', 'amount', 'status', 'starts_at', 'expires_at', 'plus_ones_used', 'source'] as const;
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
      user_name: m.users?.name ?? null, user_phone: m.users?.phone ?? '', user_email: m.users?.email ?? null,
    },
  });
}

export async function handleUpdateGuildMember(id: string, request: Request, env: Env): Promise<Response> {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return jsonResponse({ error: 'Invalid request body' }, 400);
  const payload = pickGM(body);
  if (Object.keys(payload).length === 0) return jsonResponse({ error: 'No fields to update' }, 400);
  const err = validateGM(payload);
  if (err) return jsonResponse({ error: err }, 400);
  const supabase = getSupabase(env);
  const { data, error } = await supabase.from('guild_path_members').update(payload).eq('id', id).select('*').maybeSingle();
  if (error) return jsonResponse({ error: 'Failed to update' }, 500);
  if (!data) return jsonResponse({ error: 'Guild member not found' }, 404);
  return jsonResponse({ member: data });
}
