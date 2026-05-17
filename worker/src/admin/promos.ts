import type { Env } from '../index';
import { getSupabase } from '../supabase';
import { jsonResponse, sanitizePhone, sanitizeName, sanitizeEmail } from '../validation';

interface PromoInput {
  user_id?: string;
  phone?: string;
  name?: string;
  email?: string;
  remaining_uses?: number;
  max_event_price?: number;
  expires_at?: string | null;
  notes?: string | null;
}

function validatePromoCreate(p: PromoInput): string | null {
  if (!p.user_id && !p.phone) return 'user_id or phone required';
  if (typeof p.remaining_uses !== 'number' || p.remaining_uses < 1) {
    return 'remaining_uses must be at least 1';
  }
  if (typeof p.max_event_price !== 'number' || p.max_event_price < 0) {
    return 'max_event_price must be 0 or higher';
  }
  if (p.expires_at && isNaN(Date.parse(p.expires_at))) return 'invalid expires_at';
  return null;
}

function validatePromoUpdate(p: PromoInput): string | null {
  if (
    'remaining_uses' in p &&
    (typeof p.remaining_uses !== 'number' || p.remaining_uses < 0)
  ) {
    return 'remaining_uses must be 0 or higher';
  }
  if (
    'max_event_price' in p &&
    (typeof p.max_event_price !== 'number' || p.max_event_price < 0)
  ) {
    return 'max_event_price must be 0 or higher';
  }
  if (p.expires_at && isNaN(Date.parse(p.expires_at))) return 'invalid expires_at';
  return null;
}

export async function handleListPromos(url: URL, env: Env): Promise<Response> {
  const supabase = getSupabase(env);
  const includeInactive = url.searchParams.get('include_inactive') === '1';
  const userId = url.searchParams.get('user_id');
  const today = new Date().toISOString().split('T')[0];

  let q = supabase
    .from('user_promos')
    .select('*, user:users(id, name, phone, email)')
    .order('created_at', { ascending: false });

  if (userId) q = q.eq('user_id', userId);
  if (!includeInactive) {
    q = q.gt('remaining_uses', 0).or(`expires_at.is.null,expires_at.gte.${today}`);
  }

  const { data, error } = await q;
  if (error) return jsonResponse({ error: 'Failed to load promos' }, 500);
  return jsonResponse({ promos: data || [] });
}

export async function handleCreatePromo(
  request: Request,
  env: Env,
  adminEmail: string,
): Promise<Response> {
  const body = (await request.json().catch(() => null)) as PromoInput | null;
  if (!body) return jsonResponse({ error: 'Invalid request body' }, 400);
  const err = validatePromoCreate(body);
  if (err) return jsonResponse({ error: err }, 400);

  const supabase = getSupabase(env);

  // Resolve user_id: explicit id wins; otherwise look up or create by phone.
  let userId = body.user_id;
  if (!userId && body.phone) {
    const phone = sanitizePhone(body.phone);
    if (!phone) return jsonResponse({ error: 'Invalid phone number' }, 400);
    const { data: existing } = await supabase
      .from('users')
      .select('id')
      .eq('phone', phone)
      .maybeSingle();
    if (existing) {
      userId = existing.id;
    } else {
      // Creating a new user — name is required so the recipient has a label.
      const name = sanitizeName(body.name || '');
      if (!name) return jsonResponse({ error: 'Name is required for a new user' }, 400);
      let email: string | null = null;
      if (body.email) {
        email = sanitizeEmail(body.email);
        if (!email) return jsonResponse({ error: 'Invalid email' }, 400);
      }
      const { data: created, error: createErr } = await supabase
        .from('users')
        .insert({ phone, name, email, source: 'admin_giveaway' })
        .select('id')
        .single();
      if (createErr || !created) {
        console.error('[promos] user create failed', createErr);
        return jsonResponse({ error: 'Failed to create user' }, 500);
      }
      userId = created.id;
    }
  }

  const { data, error } = await supabase
    .from('user_promos')
    .insert({
      user_id: userId,
      remaining_uses: body.remaining_uses,
      max_event_price: body.max_event_price,
      expires_at: body.expires_at || null,
      notes: body.notes || null,
      created_by: adminEmail,
    })
    .select('*, user:users(id, name, phone, email)')
    .single();

  if (error) {
    console.error('[promos] create failed', error);
    return jsonResponse({ error: 'Failed to create promo' }, 500);
  }
  return jsonResponse({ promo: data });
}

export async function handleUpdatePromo(
  id: string,
  request: Request,
  env: Env,
): Promise<Response> {
  const body = (await request.json().catch(() => null)) as PromoInput | null;
  if (!body) return jsonResponse({ error: 'Invalid request body' }, 400);
  const err = validatePromoUpdate(body);
  if (err) return jsonResponse({ error: err }, 400);

  const updates: Record<string, unknown> = {};
  if ('remaining_uses' in body) updates.remaining_uses = body.remaining_uses;
  if ('max_event_price' in body) updates.max_event_price = body.max_event_price;
  if ('expires_at' in body) updates.expires_at = body.expires_at || null;
  if ('notes' in body) updates.notes = body.notes || null;

  if (Object.keys(updates).length === 0) {
    return jsonResponse({ error: 'No fields to update' }, 400);
  }

  const supabase = getSupabase(env);
  const { data, error } = await supabase
    .from('user_promos')
    .update(updates)
    .eq('id', id)
    .select('*, user:users(id, name, phone, email)')
    .maybeSingle();

  if (error) return jsonResponse({ error: 'Failed to update promo' }, 500);
  if (!data) return jsonResponse({ error: 'Promo not found' }, 404);
  return jsonResponse({ promo: data });
}

export async function handleDeletePromo(id: string, env: Env): Promise<Response> {
  const supabase = getSupabase(env);
  const { error } = await supabase.from('user_promos').delete().eq('id', id);
  if (error) return jsonResponse({ error: 'Failed to delete promo' }, 500);
  return jsonResponse({ success: true });
}
