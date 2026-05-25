import type { Env } from '../index';
import { getSupabase } from '../supabase';
import { GUEST_EXPIRY_BUFFER_DAYS } from './auth';

export async function activeGuestEmails(env: Env): Promise<string[]> {
  const supabase = getSupabase(env);
  const cutoff = new Date(Date.now() - GUEST_EXPIRY_BUFFER_DAYS * 86400000).toISOString();
  const { data: events } = await supabase
    .from('events')
    .select('id')
    .eq('is_collaboration', true)
    .gte('date', cutoff);
  const ids = (events || []).map((e: { id: string }) => e.id);
  if (ids.length === 0) return [];

  const { data: rows } = await supabase
    .from('event_guest_admins')
    .select('email')
    .in('event_id', ids);
  return [...new Set((rows || []).map((r: { email: string }) => r.email))];
}

export async function syncCfAccessGroup(env: Env): Promise<void> {
  if (!env.CF_API_TOKEN || !env.CF_ACCOUNT_ID || !env.CF_ACCESS_GROUP_ID) {
    console.warn('[cf-access] sync skipped: CF_API_TOKEN / CF_ACCOUNT_ID / CF_ACCESS_GROUP_ID not set');
    return;
  }

  const emails = await activeGuestEmails(env);
  // CF Access groups require a non-empty include. When there are no guests, use a
  // placeholder that can never match a real login so the group grants nobody.
  const include =
    emails.length > 0
      ? emails.map((email) => ({ email: { email } }))
      : [{ email: { email: 'no-guests@invalid.bgc' } }];

  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/access/groups/${env.CF_ACCESS_GROUP_ID}`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${env.CF_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'BGC Guest Admins', include }),
    },
  );
  if (!res.ok) {
    console.error('[cf-access] sync failed', res.status, await res.text());
  }
}
