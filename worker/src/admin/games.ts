import type { Env } from '../index';
import { getSupabase } from '../supabase';
import { jsonResponse } from '../validation';

const GAME_FIELDS = [
  'title', 'player_count', 'max_players', 'avg_rating', 'weight',
  'complexity', 'play_time', 'max_play_time', 'length', 'owned_by', 'currently_with',
] as const;

type GameField = (typeof GAME_FIELDS)[number];

function pickGameFields(body: Record<string, unknown>): Partial<Record<GameField, unknown>> {
  const out: Partial<Record<GameField, unknown>> = {};
  for (const f of GAME_FIELDS) if (f in body) out[f] = body[f];
  return out;
}

function validateGamePayload(p: Partial<Record<GameField, unknown>>, requireAll: boolean): string | null {
  if (requireAll || 'title' in p) {
    if (typeof p.title !== 'string' || p.title.trim().length === 0) return 'Title is required';
  }
  if ('max_players' in p && p.max_players !== null && (typeof p.max_players !== 'number' || p.max_players < 0)) return 'Max players must be a non-negative number';
  if ('avg_rating' in p && p.avg_rating !== null && typeof p.avg_rating !== 'number') return 'Average rating must be a number';
  if ('weight' in p && p.weight !== null && typeof p.weight !== 'number') return 'Weight must be a number';
  if ('max_play_time' in p && p.max_play_time !== null && (typeof p.max_play_time !== 'number' || p.max_play_time < 0)) return 'Max play time must be a non-negative number';
  return null;
}

export async function handleListGames(env: Env): Promise<Response> {
  const supabase = getSupabase(env);
  const { data, error } = await supabase.from('games').select('*').order('title', { ascending: true });
  if (error) return jsonResponse({ error: 'Failed to load games' }, 500);
  return jsonResponse({ games: data || [] });
}

export async function handleGetGame(id: string, env: Env): Promise<Response> {
  const supabase = getSupabase(env);
  const { data, error } = await supabase.from('games').select('*').eq('id', id).maybeSingle();
  if (error) return jsonResponse({ error: 'Failed to load game' }, 500);
  if (!data) return jsonResponse({ error: 'Game not found' }, 404);
  return jsonResponse({ game: data });
}

export async function handleCreateGame(request: Request, env: Env): Promise<Response> {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return jsonResponse({ error: 'Invalid request body' }, 400);
  const payload = pickGameFields(body);
  const err = validateGamePayload(payload, true);
  if (err) return jsonResponse({ error: err }, 400);
  const supabase = getSupabase(env);
  const { data, error } = await supabase.from('games').insert(payload).select('*').single();
  if (error || !data) return jsonResponse({ error: 'Failed to create game' }, 500);
  return jsonResponse({ game: data }, 201);
}

export async function handleUpdateGame(id: string, request: Request, env: Env): Promise<Response> {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return jsonResponse({ error: 'Invalid request body' }, 400);
  const payload = pickGameFields(body);
  if (Object.keys(payload).length === 0) return jsonResponse({ error: 'No fields to update' }, 400);
  const err = validateGamePayload(payload, false);
  if (err) return jsonResponse({ error: err }, 400);
  const supabase = getSupabase(env);
  const { data, error } = await supabase.from('games').update(payload).eq('id', id).select('*').maybeSingle();
  if (error) return jsonResponse({ error: 'Failed to update game' }, 500);
  if (!data) return jsonResponse({ error: 'Game not found' }, 404);
  return jsonResponse({ game: data });
}
