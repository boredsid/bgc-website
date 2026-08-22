import type { Env, AdminContext } from '../index';
import { getSupabase } from '../supabase';

export const GUEST_EXPIRY_BUFFER_DAYS = 2;

export async function resolveRole(email: string, env: Env): Promise<AdminContext> {
  const allowed = env.ADMIN_EMAILS.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (allowed.includes(email)) return { email, role: 'admin' };

  const supabase = getSupabase(env);

  const { data: rows } = await supabase
    .from('event_guest_admins')
    .select('event_id')
    .eq('email', email);
  const eventIds = (rows || []).map((r: { event_id: string }) => r.event_id);
  if (eventIds.length === 0) return { email, role: 'none' };

  // Active = is_collaboration AND now < event end + buffer  ⇔  ends_at >= now - buffer.
  // Keyed on ends_at so a guest keeps access through a whole multi-day event.
  const cutoff = new Date(Date.now() - GUEST_EXPIRY_BUFFER_DAYS * 86400000).toISOString();
  const { data: events } = await supabase
    .from('events')
    .select('id')
    .in('id', eventIds)
    .eq('is_collaboration', true)
    .gte('ends_at', cutoff);
  const activeIds = (events || []).map((e: { id: string }) => e.id);
  if (activeIds.length === 0) return { email, role: 'none' };

  return { email, role: 'guest', eventIds: activeIds };
}
