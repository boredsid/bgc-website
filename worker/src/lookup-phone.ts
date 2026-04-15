import type { Env } from './index';
import { getSupabase } from './supabase';
import { sanitizePhone, jsonResponse } from './validation';

export async function handleLookupPhone(request: Request, env: Env): Promise<Response> {
  const body = await request.json<{ phone: string }>();
  const phone = sanitizePhone(body.phone || '');

  if (!phone) {
    return jsonResponse({ error: 'Invalid phone number' }, 400);
  }

  const supabase = getSupabase(env);

  const userResult = await supabase
    .from('users')
    .select('id, name, email')
    .eq('phone', phone)
    .maybeSingle();

  const user = userResult.data;

  let member: { tier: string; expires_at: string } | null = null;

  if (user) {
    const memberResult = await supabase
      .from('guild_path_members')
      .select('tier, expires_at')
      .eq('user_id', user.id)
      .eq('status', 'paid')
      .gte('expires_at', new Date().toISOString().split('T')[0])
      .order('expires_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    member = memberResult.data;
  }

  let discount: string | null = null;
  if (member) {
    if (member.tier === 'adventurer' || member.tier === 'guildmaster') {
      discount = 'free';
    } else if (member.tier === 'initiate') {
      discount = '20';
    }
  }

  return jsonResponse({
    user: {
      found: !!user,
      name: user?.name || null,
      email: user?.email || null,
    },
    membership: {
      isMember: !!member,
      tier: member?.tier || null,
      discount,
    },
  });
}
