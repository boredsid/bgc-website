// worker/src/admin/leads.ts
import type { Env } from '../index';
import { getSupabase } from '../supabase';
import { jsonResponse } from '../validation';

const DEFAULT_WINDOW_DAYS = 30;
const LIST_LIMIT = 500;

function applyListFilters(query: any, url: URL) {
  const includeConverted = url.searchParams.get('include_converted') === '1';
  const includeJunk = url.searchParams.get('include_junk') === '1';
  const eventId = url.searchParams.get('event_id');
  const hasName = url.searchParams.get('has_name');
  const sinceParam = url.searchParams.get('since');

  if (!includeConverted) query = query.is('converted_at', null);
  if (!includeJunk) query = query.is('junk_at', null);
  if (eventId) query = query.eq('event_id', eventId);
  if (hasName === 'yes') query = query.not('name', 'is', null);
  if (hasName === 'no') query = query.is('name', null);

  const since = sinceParam
    ? new Date(sinceParam)
    : new Date(Date.now() - DEFAULT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  if (!isNaN(since.getTime())) query = query.gte('created_at', since.toISOString());

  return query;
}

export async function handleListLeads(request: Request, env: Env): Promise<Response> {
  const supabase = getSupabase(env);
  const url = new URL(request.url);

  let query = supabase
    .from('leads')
    .select('id, phone, name, event_id, last_step, source, user_agent, converted_at, registration_id, junk_at, created_at, updated_at, events(name, date)');

  query = applyListFilters(query, url);

  const { data, error } = await query.order('created_at', { ascending: false }).limit(LIST_LIMIT);
  if (error) return jsonResponse({ error: 'Failed to load leads' }, 500);
  return jsonResponse({ leads: data || [] });
}

export async function handleUpdateLead(id: string, request: Request, env: Env): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { junk?: boolean } | null;
  if (!body) return jsonResponse({ error: 'Invalid request body' }, 400);

  const update: Record<string, unknown> = {};
  if (body.junk === true) update.junk_at = new Date().toISOString();

  if (Object.keys(update).length === 0) {
    return jsonResponse({ error: 'No recognised fields to update' }, 400);
  }
  update.updated_at = new Date().toISOString();

  const supabase = getSupabase(env);
  const { error } = await supabase.from('leads').update(update).eq('id', id);
  if (error) return jsonResponse({ error: 'Failed to update lead' }, 500);
  return jsonResponse({ ok: true });
}

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export async function handleExportLeads(request: Request, env: Env): Promise<Response> {
  const supabase = getSupabase(env);
  const url = new URL(request.url);

  let query = supabase
    .from('leads')
    .select('id, phone, name, event_id, last_step, source, converted_at, junk_at, created_at, events(name)');

  query = applyListFilters(query, url);
  const { data, error } = await query.order('created_at', { ascending: false }).limit(LIST_LIMIT);
  if (error) return new Response('Failed', { status: 500 });

  const header = ['created_at', 'phone', 'name', 'event', 'last_step', 'source', 'converted_at', 'junk_at'];
  const rows = (data || []).map((r: any) => [
    r.created_at, r.phone, r.name, r.events?.name ?? '',
    r.last_step, r.source, r.converted_at, r.junk_at,
  ].map(csvEscape).join(','));

  const csv = [header.join(','), ...rows].join('\n');
  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="leads.csv"',
      'Cache-Control': 'no-store',
    },
  });
}
