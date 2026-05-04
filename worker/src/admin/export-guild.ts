import type { Env } from '../index';
import { getSupabase } from '../supabase';
import { toCsv } from './csv';

export interface GuildRow {
  id: string;
  user_id: string;
  tier: 'initiate' | 'adventurer' | 'guildmaster';
  status: 'pending' | 'paid' | 'cancelled';
  starts_at: string | null;
  expires_at: string | null;
  plus_ones_used: number;
  source: string | null;
  users: { name: string | null; phone: string | null; email: string | null } | null;
}

export function flattenGuildMembers(rows: GuildRow[]) {
  const headers = ['name', 'phone', 'email', 'tier', 'status', 'starts_at', 'expires_at', 'plus_ones_used', 'source'] as const;
  const out = rows.map((r) => ({
    name: r.users?.name ?? '',
    phone: r.users?.phone ?? '',
    email: r.users?.email ?? '',
    tier: r.tier,
    status: r.status,
    starts_at: r.starts_at,
    expires_at: r.expires_at,
    plus_ones_used: r.plus_ones_used,
    source: r.source,
  }));
  return { headers: [...headers], rows: out };
}

export async function handleExportGuildMembers(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const status = url.searchParams.get('status');
  const tier = url.searchParams.get('tier');
  const ids = url.searchParams.get('ids')?.split(',').filter(Boolean);

  const supabase = getSupabase(env);
  let q = supabase.from('guild_path_members').select('*, users:user_id(name, phone, email)');
  if (ids && ids.length > 0) q = q.in('id', ids);
  else {
    if (status) q = q.eq('status', status);
    if (tier) q = q.eq('tier', tier);
  }
  const { data, error } = await q;
  if (error) return new Response(JSON.stringify({ error: 'Failed to load' }), { status: 500 });

  const { headers, rows } = flattenGuildMembers((data || []) as unknown as GuildRow[]);
  const csv = toCsv(headers, rows);
  const filename = `guild-members-${new Date().toISOString().slice(0, 10)}.csv`;
  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
