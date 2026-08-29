import type { Env } from './index';
import { getSupabase } from './supabase';
import { sanitizePhone, jsonResponse } from './validation';
import { getActiveMembership } from './guild';

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

  const member = await getActiveMembership(supabase, user.id);
  if (!member) {
    return jsonResponse({ tier: null, active: false });
  }

  return jsonResponse({ tier: member.tier, active: true });
}
