import type { Env } from '../index';
import { getSupabase } from '../supabase';
import { toCsv } from './csv';

export interface RegRow {
  id: string; name: string; phone: string; email: string | null;
  event_id: string; seats: number; total_amount: number;
  payment_status: 'pending' | 'confirmed' | 'cancelled';
  source: string | null; created_at: string;
  custom_answers: Record<string, string | boolean> | null;
}

export interface EventRow {
  id: string; name: string;
  custom_questions: Array<{ id: string; label: string; type: string; required: boolean; options?: Array<{ value: string }> }> | null;
}

export function flattenRegistrations(regs: RegRow[], events: EventRow[]) {
  const eventById: Record<string, EventRow> = Object.fromEntries(events.map((e) => [e.id, e]));
  const dynamicLabels: string[] = [];
  const seenLabels = new Set<string>();
  for (const r of regs) {
    const ev = eventById[r.event_id];
    for (const q of ev?.custom_questions || []) {
      if (!seenLabels.has(q.label)) {
        seenLabels.add(q.label);
        dynamicLabels.push(q.label);
      }
    }
  }
  const baseHeaders = ['name', 'phone', 'email', 'event', 'seats', 'total_amount', 'payment_status', 'source', 'created_at'] as const;
  const headers = [...baseHeaders, ...dynamicLabels];

  const rows = regs.map((r) => {
    const ev = eventById[r.event_id];
    const row: Record<string, string | number | null> = {
      name: r.name,
      phone: r.phone,
      email: r.email,
      event: ev?.name ?? '',
      seats: r.seats,
      total_amount: r.total_amount,
      payment_status: r.payment_status,
      source: r.source,
      created_at: r.created_at,
    };
    for (const q of ev?.custom_questions || []) {
      const v = r.custom_answers?.[q.id];
      row[q.label] = typeof v === 'boolean' ? (v ? 'Yes' : 'No') : (typeof v === 'string' ? v : '');
    }
    return row;
  });

  return { headers, rows };
}

export async function handleExportRegistrations(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const eventId = url.searchParams.get('event_id');
  const status = url.searchParams.get('status');
  const ids = url.searchParams.get('ids')?.split(',').filter(Boolean);

  const supabase = getSupabase(env);
  let q = supabase.from('registrations').select('*');
  if (ids && ids.length > 0) q = q.in('id', ids);
  else {
    if (eventId) q = q.eq('event_id', eventId);
    if (status) q = q.eq('payment_status', status);
  }
  const { data: regs, error } = await q;
  if (error) return new Response(JSON.stringify({ error: 'Failed to load' }), { status: 500 });

  const eventIds = Array.from(new Set((regs || []).map((r: any) => r.event_id)));
  const { data: events } = eventIds.length > 0
    ? await supabase.from('events').select('id, name, custom_questions').in('id', eventIds)
    : { data: [] };

  const { headers, rows } = flattenRegistrations((regs || []) as RegRow[], (events || []) as EventRow[]);
  const csv = toCsv(headers, rows);
  const filename = `registrations-${new Date().toISOString().slice(0, 10)}.csv`;
  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
