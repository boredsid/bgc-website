import type { Env } from './index';
import { getSupabase } from './supabase';
import { sanitizePhone, jsonResponse } from './validation';

export async function handleGuildStatus(request: Request, env: Env): Promise<Response> {
  const expected = env.REPLAY_TO_BGC_SECRET;
  const auth = request.headers.get('Authorization') || '';
  if (!expected || auth !== `Bearer ${expected}`) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  let phone = '';
  try {
    const body = await request.json<{ phone?: string }>();
    phone = sanitizePhone(body.phone || '') || '';
  } catch {
    return jsonResponse({ tier: null, active: false });
  }

  if (!phone) {
    return jsonResponse({ tier: null, active: false });
  }

  const supabase = getSupabase(env);

  const userResult = await supabase
    .from('users')
    .select('id')
    .eq('phone', phone)
    .maybeSingle();

  const user = userResult.data;
  if (!user) {
    return jsonResponse({ tier: null, active: false });
  }

  const today = new Date().toISOString().split('T')[0];
  const memberResult = await supabase
    .from('guild_path_members')
    .select('tier, expires_at')
    .eq('user_id', user.id)
    .eq('status', 'paid')
    .gte('expires_at', today)
    .order('expires_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const member = memberResult.data;
  if (!member) {
    return jsonResponse({ tier: null, active: false });
  }

  return jsonResponse({ tier: member.tier, active: true });
}
