import type { Env } from '../index';
import { getSupabase } from '../supabase';
import { jsonResponse } from '../validation';
import { aggregateRegistrations, type EventRow, type RegRow, type SummaryCard } from '../admin/summary';

// Guest-scoped dashboard summary: same per-event aggregation as the admin
// dashboard, but limited to the events this guest is authorised for. No
// global counters (pending guild / pending registrations) — those are
// admin-only concerns and span events the guest can't see.
export async function handleGuestSummary(env: Env, eventIds: string[]): Promise<Response> {
  if (eventIds.length === 0) return jsonResponse({ upcoming: [], past: [] });

  const supabase = getSupabase(env);
  const nowIso = new Date().toISOString();

  const { data: events, error: evErr } = await supabase
    .from('events').select('*').in('id', eventIds);
  if (evErr) return jsonResponse({ error: 'Failed to load events' }, 500);

  const all = (events || []) as EventRow[];
  if (all.length === 0) return jsonResponse({ upcoming: [], past: [] });

  const upcoming = all
    .filter((e) => e.date >= nowIso)
    .sort((a, b) => a.date.localeCompare(b.date));
  const past = all
    .filter((e) => e.date < nowIso)
    .sort((a, b) => b.date.localeCompare(a.date));

  const { data: regs, error: rErr } = await supabase
    .from('registrations')
    .select('id, event_id, user_id, seats, payment_status, custom_answers')
    .in('event_id', eventIds);
  if (rErr) return jsonResponse({ error: 'Failed to load registrations' }, 500);

  const today = nowIso.split('T')[0];
  const { data: members } = await supabase
    .from('guild_path_members')
    .select('user_id')
    .eq('status', 'paid')
    .gte('expires_at', today);
  const guildIds = new Set<string>((members || []).map((m: any) => m.user_id));

  function buildCards(list: EventRow[]): SummaryCard[] {
    return list.map((e) => {
      const eventRegs = (regs || []).filter((r: any) => r.event_id === e.id) as RegRow[];
      return aggregateRegistrations(e, eventRegs, guildIds);
    });
  }

  return jsonResponse({ upcoming: buildCards(upcoming), past: buildCards(past) });
}
