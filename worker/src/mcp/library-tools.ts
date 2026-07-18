import { getSupabase } from '../supabase';
import { handleEventPhotos } from '../event-photos';
import { COMMUNITY } from './links';
import { ToolError, type McpTool } from './types';

const MAX_GAMES = 100;

const searchLibrary: McpTool = {
  name: 'search_library',
  description:
    "Search BGC's board game library (~130 games) by title, player count, or maximum play time. All filters optional; omit them to browse everything.",
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Match against game title' },
      players: { type: 'integer', description: 'Number of players the game must support' },
      max_time: { type: 'integer', description: 'Maximum play time in minutes' },
    },
  },
  handler: async (args, env) => {
    const supabase = getSupabase(env);
    let q = supabase
      .from('games')
      .select('id, title, player_count, max_players, avg_rating, weight, complexity, play_time, max_play_time, length')
      .order('title')
      .limit(MAX_GAMES + 1);

    if (typeof args.query === 'string' && args.query.trim()) q = q.ilike('title', `%${args.query.trim()}%`);
    if (Number.isFinite(Number(args.players)) && Number(args.players) > 0) q = q.gte('max_players', Number(args.players));
    if (Number.isFinite(Number(args.max_time)) && Number(args.max_time) > 0) q = q.lte('max_play_time', Number(args.max_time));

    const { data, error } = await q;
    if (error) throw new Error(error.message);

    const rows = data || [];
    const truncated = rows.length > MAX_GAMES;
    // Explicit public shape — internal columns (owned_by, currently_with)
    // must never reach the output even if the select above ever changes.
    const games = rows.slice(0, MAX_GAMES).map((g) => ({
      title: g.title,
      players: g.player_count,
      play_time: g.play_time,
      complexity: g.complexity,
      rating: g.avg_rating,
    }));

    return {
      count: games.length,
      ...(truncated ? { note: `Showing the first ${MAX_GAMES} matches — narrow the search or browse ${COMMUNITY.website}/library` } : {}),
      games,
      library_url: `${COMMUNITY.website}/library`,
    };
  },
};

const getPhotos: McpTool = {
  name: 'get_photos',
  description:
    'List photo albums from past BGC events with links to view them. Optionally filter by event name.',
  inputSchema: {
    type: 'object',
    properties: { query: { type: 'string', description: 'Match against album/event title' } },
  },
  handler: async (args, env, ctx) => {
    const res = await handleEventPhotos(
      new Request('https://api.boardgamecompany.in/api/event-photos'),
      env,
      ctx,
    );
    if (!res.ok) {
      throw new ToolError(`Photos are unavailable right now — browse them at ${COMMUNITY.website}/photos`);
    }
    const { events } = (await res.json()) as {
      events: Array<{ folderId: string; title: string; date: string | null }>;
    };

    const needle = typeof args.query === 'string' ? args.query.trim().toLowerCase() : '';
    const filtered = needle ? events.filter((e) => e.title.toLowerCase().includes(needle)) : events;

    return {
      albums: filtered.map((e) => ({
        title: e.title,
        date: e.date,
        album_url: `${COMMUNITY.website}/photos?event=${e.folderId}`,
      })),
      photos_url: `${COMMUNITY.website}/photos`,
    };
  },
};

export const libraryTools: McpTool[] = [searchLibrary, getPhotos];
