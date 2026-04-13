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

  const [userResult, memberResult] = await Promise.all([
    supabase
      .from('users')
      .select('name, email')
      .eq('phone', phone)
      .maybeSingle(),
    supabase
      .from('guild_members')
      .select('tier, expires_at')
      .eq('phone', phone)
      .gte('expires_at', new Date().toISOString().split('T')[0])
      .maybeSingle(),
  ]);

  const user = userResult.data;
  const member = memberResult.data;

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
