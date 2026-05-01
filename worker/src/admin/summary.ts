import type { Env } from '../index';
import { getSupabase } from '../supabase';
import { jsonResponse } from '../validation';

export interface EventRow {
  id: string; name: string; date: string; venue_name: string | null; venue_area: string | null;
  capacity: number; price: number; description: string | null; price_includes: string | null;
  is_published: boolean; created_at: string;
  custom_questions: Array<{ id: string; label: string; type: string; required: boolean; options?: Array<{ value: string }> }> | null;
}

export interface RegRow {
  id: string;
  user_id: string | null;
  seats: number;
  payment_status: 'pending' | 'confirmed' | 'cancelled';
  custom_answers: Record<string, string | boolean> | null;
}

export type QuestionSummary =
  | { type: 'select' | 'radio'; counts: Record<string, number> }
  | { type: 'checkbox'; yes: number; no: number }
  | { type: 'text'; count: number; answers: string[] };

export interface SummaryCard {
  event: EventRow;
  totals: { pending: number; confirmed: number; cancelled: number };
  guild_member_count: number;
  capacity_used: number;
  custom_question_summary: Record<string, QuestionSummary>;
}

export function aggregateRegistrations(event: EventRow, regs: RegRow[], guildUserIds: Set<string>): SummaryCard {
  const totals = { pending: 0, confirmed: 0, cancelled: 0 };
  let capacity_used = 0;
  let guild_member_count = 0;
  const cqs: Record<string, QuestionSummary> = {};

  for (const q of event.custom_questions || []) {
    if (q.type === 'select' || q.type === 'radio') {
      cqs[q.id] = { type: q.type as 'select' | 'radio', counts: {} };
    } else if (q.type === 'checkbox') {
      cqs[q.id] = { type: 'checkbox', yes: 0, no: 0 };
    } else if (q.type === 'text') {
      cqs[q.id] = { type: 'text', count: 0, answers: [] };
    }
  }

  for (const r of regs) {
    totals[r.payment_status]++;
    if (r.payment_status !== 'confirmed') continue;

    capacity_used += r.seats;
    if (r.user_id && guildUserIds.has(r.user_id)) guild_member_count++;

    for (const q of event.custom_questions || []) {
      const a = r.custom_answers?.[q.id];
      const summary = cqs[q.id];
      if (!summary) continue;
      if (summary.type === 'select' || summary.type === 'radio') {
        if (typeof a === 'string' && a) summary.counts[a] = (summary.counts[a] || 0) + 1;
      } else if (summary.type === 'checkbox') {
        if (a === true) summary.yes++;
        else summary.no++;
      } else if (summary.type === 'text') {
        if (typeof a === 'string' && a.trim()) {
          summary.count++;
          summary.answers.push(a);
        }
      }
    }
  }

  return { event, totals, guild_member_count, capacity_used, custom_question_summary: cqs };
}

export async function handleSummary(env: Env): Promise<Response> {
  const supabase = getSupabase(env);
  const nowIso = new Date().toISOString();

  const { data: upcomingEvents, error: ueErr } = await supabase
    .from('events').select('*').gte('date', nowIso).order('date', { ascending: true });
  if (ueErr) return jsonResponse({ error: 'Failed to load events' }, 500);

  const { data: pastEvents, error: peErr } = await supabase
    .from('events').select('*').lt('date', nowIso).order('date', { ascending: false }).limit(3);
  if (peErr) return jsonResponse({ error: 'Failed to load events' }, 500);

  const allEvents = [...(upcomingEvents || []), ...(pastEvents || [])];
  if (allEvents.length === 0) return jsonResponse({ upcoming: [], past: [] });

  const eventIds = allEvents.map((e: any) => e.id);
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

  function buildCards(events: any[]): SummaryCard[] {
    return events.map((e) => {
      const eventRegs = (regs || []).filter((r: any) => r.event_id === e.id) as RegRow[];
      return aggregateRegistrations(e as EventRow, eventRegs, guildIds);
    });
  }

  return jsonResponse({
    upcoming: buildCards(upcomingEvents || []),
    past: buildCards(pastEvents || []),
  });
}
