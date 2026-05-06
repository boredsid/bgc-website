import type { Env } from '../index';
import { getSupabase } from '../supabase';
import { sanitizePhone, sanitizeEmail, sanitizeName, jsonResponse } from '../validation';
import { getUserBalance, recordCreditEvent } from '../credits';

export async function handleListUsers(url: URL, env: Env): Promise<Response> {
  const supabase = getSupabase(env);
  const q = (url.searchParams.get('q') || '').trim();
  const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get('limit') || '50', 10)));
  const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10));

  let query = supabase
    .from('users')
    .select('*')
    .order('last_registered_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (q) {
    const escaped = q.replace(/[%_\\]/g, (m) => '\\' + m);
    const like = `%${escaped}%`;
    query = query.or(`phone.ilike.${like},name.ilike.${like},email.ilike.${like}`);
  }

  const { data: users, error } = await query;
  if (error) return jsonResponse({ error: 'Failed to load users' }, 500);

  const ids = (users || []).map((u: { id: string }) => u.id);
  const balances = new Map<string, number>();
  if (ids.length > 0) {
    const { data: rows } = await supabase
      .from('user_credits')
      .select('user_id, amount')
      .in('user_id', ids);
    for (const r of rows || []) {
      balances.set(r.user_id, (balances.get(r.user_id) || 0) + r.amount);
    }
  }

  const out = (users || []).map((u: any) => ({ ...u, credit_balance: balances.get(u.id) || 0 }));
  return jsonResponse({ users: out });
}

export async function handleGetUser(id: string, env: Env): Promise<Response> {
  const supabase = getSupabase(env);
  const { data, error } = await supabase.from('users').select('*').eq('id', id).maybeSingle();
  if (error) return jsonResponse({ error: 'Failed to load user' }, 500);
  if (!data) return jsonResponse({ error: 'User not found' }, 404);

  const { data: ledger } = await supabase
    .from('user_credits')
    .select('*')
    .eq('user_id', id)
    .order('created_at', { ascending: false })
    .limit(100);

  const credit_balance = (ledger || []).reduce((s: number, r: { amount: number }) => s + r.amount, 0);
  return jsonResponse({ user: data, credit_balance, credits: ledger || [] });
}

export async function handleUpdateUser(id: string, request: Request, env: Env): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { name?: string; phone?: string; email?: string } | null;
  if (!body) return jsonResponse({ error: 'Invalid request body' }, 400);

  const update: Record<string, unknown> = {};
  if ('name' in body) {
    const n = sanitizeName(body.name || '');
    if (!n) return jsonResponse({ error: 'Invalid name' }, 400);
    update.name = n;
  }
  if ('phone' in body) {
    const p = sanitizePhone(body.phone || '');
    if (!p) return jsonResponse({ error: 'Invalid phone number' }, 400);
    update.phone = p;
  }
  if ('email' in body) {
    if (body.email) {
      const e = sanitizeEmail(body.email);
      if (!e) return jsonResponse({ error: 'Invalid email' }, 400);
      update.email = e;
    } else {
      update.email = null;
    }
  }
  if (Object.keys(update).length === 0) return jsonResponse({ error: 'No fields to update' }, 400);

  const supabase = getSupabase(env);
  const { data, error } = await supabase.from('users').update(update).eq('id', id).select('*').maybeSingle();
  if (error) return jsonResponse({ error: 'Failed to update user' }, 500);
  if (!data) return jsonResponse({ error: 'User not found' }, 404);
  return jsonResponse({ user: data });
}

export async function handleAdjustUserCredits(
  id: string,
  request: Request,
  env: Env,
  adminEmail: string,
): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { amount?: number; note?: string } | null;
  if (!body) return jsonResponse({ error: 'Invalid request body' }, 400);
  const amount = Number(body.amount);
  if (!Number.isInteger(amount) || amount === 0) {
    return jsonResponse({ error: 'Amount must be a non-zero integer' }, 400);
  }
  const note = (body.note || '').trim();
  if (!note) return jsonResponse({ error: 'Note is required' }, 400);
  if (note.length > 500) return jsonResponse({ error: 'Note must be 500 characters or fewer' }, 400);

  const supabase = getSupabase(env);
  const { data: user, error: userError } = await supabase
    .from('users')
    .select('id')
    .eq('id', id)
    .maybeSingle();
  if (userError) return jsonResponse({ error: 'Failed to load user' }, 500);
  if (!user) return jsonResponse({ error: 'User not found' }, 404);

  await recordCreditEvent(supabase, {
    user_id: id,
    amount,
    reason: 'admin_adjustment',
    note,
    created_by: adminEmail,
  });

  const balance = await getUserBalance(supabase, id);
  return jsonResponse({ credit_balance: balance });
}
