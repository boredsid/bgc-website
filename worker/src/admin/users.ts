import type { Env } from '../index';
import { getSupabase } from '../supabase';
import { sanitizePhone, sanitizeEmail, sanitizeName, jsonResponse } from '../validation';

export async function handleGetUser(id: string, env: Env): Promise<Response> {
  const supabase = getSupabase(env);
  const { data, error } = await supabase.from('users').select('*').eq('id', id).maybeSingle();
  if (error) return jsonResponse({ error: 'Failed to load user' }, 500);
  if (!data) return jsonResponse({ error: 'User not found' }, 404);
  return jsonResponse({ user: data });
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
