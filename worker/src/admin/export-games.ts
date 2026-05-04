import type { Env } from '../index';
import { getSupabase } from '../supabase';
import { toCsv } from './csv';

export interface GameRow {
  id: string;
  title: string;
  player_count: string | null;
  complexity: string | null;
  owned_by: string | null;
  currently_with: string | null;
  length: string | null;
  max_players: number | null;
}

export function flattenGames(rows: GameRow[]) {
  const headers = ['title', 'player_count', 'complexity', 'owned_by', 'currently_with', 'length', 'max_players'] as const;
  const out = rows.map((r) => ({
    title: r.title,
    player_count: r.player_count,
    complexity: r.complexity,
    owned_by: r.owned_by,
    currently_with: r.currently_with,
    length: r.length,
    max_players: r.max_players,
  }));
  return { headers: [...headers], rows: out };
}

export async function handleExportGames(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const ids = url.searchParams.get('ids')?.split(',').filter(Boolean);

  const supabase = getSupabase(env);
  let q = supabase.from('games').select('*').order('title', { ascending: true });
  if (ids && ids.length > 0) q = q.in('id', ids);
  const { data, error } = await q;
  if (error) return new Response(JSON.stringify({ error: 'Failed to load' }), { status: 500 });

  const { headers, rows } = flattenGames((data || []) as unknown as GameRow[]);
  const csv = toCsv(headers, rows);
  const filename = `games-${new Date().toISOString().slice(0, 10)}.csv`;
  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
