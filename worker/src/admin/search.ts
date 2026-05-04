import type { Env } from '../index';
import { getSupabase } from '../supabase';
import { jsonResponse } from '../validation';

export type Query = { kind: 'phone' | 'text'; value: string };

export function classifyQuery(raw: string): Query | null {
  const trimmed = (raw || '').trim();
  if (trimmed.length < 2) return null;
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length >= 4) return { kind: 'phone', value: digits };
  return { kind: 'text', value: trimmed };
}

export interface SearchResults {
  registrations: Array<{
    id: string; name: string; phone: string;
    event_id: string; event_name: string | null;
    payment_status: 'pending' | 'confirmed' | 'cancelled';
  }>;
  guild_members: Array<{
    id: string; user_id: string;
    name: string | null; phone: string;
    tier: string; status: string; expires_at: string;
  }>;
  users: Array<{
    id: string; name: string | null; phone: string; email: string | null;
    last_registered_at: string;
  }>;
}

const EMPTY: SearchResults = { registrations: [], guild_members: [], users: [] };

export async function handleSearch(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const q = classifyQuery(url.searchParams.get('q') || '');
  if (!q) return jsonResponse(EMPTY);

  const supabase = getSupabase(env);

  // Sanitize values used inside PostgREST `.or(...)` filters. Characters
  // like `,` `(` `)` `*` `\` `%` are meaningful in the DSL and would produce
  // malformed filters or unintended wildcards.
  let phoneFilter: string | null = null;
  let textFilter: string | null = null;
  if (q.kind === 'phone') {
    const safePhone = q.value.replace(/\D/g, '');
    if (!safePhone) return jsonResponse(EMPTY);
    phoneFilter = `phone.ilike.%${safePhone}%`;
  } else {
    const safeText = q.value.replace(/[,()*\\%]/g, '');
    if (!safeText) return jsonResponse(EMPTY);
    textFilter = `name.ilike.%${safeText}%,email.ilike.%${safeText}%`;
  }

  const filter = phoneFilter || textFilter;
  if (!filter) return jsonResponse(EMPTY);

  // Registrations + Users are independent — fetch in parallel.
  const [regsRes, usersRes] = await Promise.all([
    supabase
      .from('registrations')
      .select('id, name, phone, event_id, payment_status, events(name)')
      .or(filter)
      .limit(10),
    supabase
      .from('users')
      .select('id, name, phone, email, last_registered_at')
      .or(filter)
      .order('last_registered_at', { ascending: false })
      .limit(10),
  ]);

  if (regsRes.error || usersRes.error) {
    return jsonResponse({ error: 'Search failed' }, 500);
  }

  const regs: SearchResults['registrations'] = (regsRes.data || []).map((r: any) => ({
    id: r.id, name: r.name, phone: r.phone,
    event_id: r.event_id,
    event_name: r.events?.name ?? null,
    payment_status: r.payment_status,
  }));

  const users: SearchResults['users'] = (usersRes.data || []) as SearchResults['users'];

  // Guild members — match by joined user (depends on user ids).
  let guild: SearchResults['guild_members'] = [];
  const userIds = users.map((u) => u.id);
  if (userIds.length > 0) {
    const { data, error } = await supabase
      .from('guild_path_members')
      .select('id, user_id, tier, status, expires_at, users(name, phone)')
      .in('user_id', userIds)
      .limit(10);
    if (error) return jsonResponse({ error: 'Search failed' }, 500);
    guild = (data || []).map((g: any) => ({
      id: g.id,
      user_id: g.user_id,
      name: g.users?.name ?? null,
      phone: g.users?.phone ?? '',
      tier: g.tier,
      status: g.status,
      expires_at: g.expires_at,
    }));
  }

  return jsonResponse({ registrations: regs, guild_members: guild, users });
}
