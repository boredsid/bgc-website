import { describe, expect, it, vi } from 'vitest';

vi.mock('../supabase', () => ({ getSupabase: vi.fn() }));
vi.mock('../event-photos', () => ({ handleEventPhotos: vi.fn() }));

import { getSupabase } from '../supabase';
import { handleEventPhotos } from '../event-photos';
import { libraryTools } from './library-tools';

const env = {} as any;
const ctx = { waitUntil: (p: Promise<unknown>) => p } as any;

function tool(name: string) {
  const t = libraryTools.find((t) => t.name === name);
  if (!t) throw new Error(`missing tool ${name}`);
  return t;
}

// A chainable query mock: every filter method returns itself; awaiting
// resolves with the given rows. Records filter calls for assertions.
function queryMock(rows: any[]) {
  const calls: Array<[string, ...any[]]> = [];
  const q: any = {
    calls,
    then: (resolve: any) => resolve({ data: rows, error: null }),
  };
  for (const m of ['select', 'order', 'ilike', 'gte', 'lte', 'limit']) {
    q[m] = (...a: any[]) => { calls.push([m, ...a]); return q; };
  }
  return q;
}

describe('search_library', () => {
  it('returns games and never leaks internal ownership fields', async () => {
    const q = queryMock([
      { id: 'G1', title: 'Azul', player_count: '2-4', max_players: 4, avg_rating: 7.8,
        weight: 1.8, complexity: 'Light', play_time: '30-45 min', max_play_time: 45, length: 'Short',
        owned_by: 'SECRET PERSON', currently_with: 'SECRET HOLDER' },
    ]);
    (getSupabase as any).mockReturnValue({ from: () => q });

    const out = await tool('search_library').handler({ query: 'azul' }, env, ctx) as any;
    expect(out.games).toHaveLength(1);
    expect(out.games[0].title).toBe('Azul');
    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain('owned_by');
    expect(serialized).not.toContain('currently_with');
    expect(serialized).not.toContain('SECRET');
  });

  it('applies player and time filters', async () => {
    const q = queryMock([]);
    (getSupabase as any).mockReturnValue({ from: () => q });

    await tool('search_library').handler({ players: 5, max_time: 60 }, env, ctx);
    expect(q.calls).toContainEqual(['gte', 'max_players', 5]);
    expect(q.calls).toContainEqual(['lte', 'max_play_time', 60]);
  });
});

describe('get_photos', () => {
  it('lists albums with site links, optionally filtered by title', async () => {
    (handleEventPhotos as any).mockResolvedValue(new Response(JSON.stringify({
      events: [
        { folderId: 'F1', title: 'Catan Night', date: '2026-05-24' },
        { folderId: 'F2', title: 'Wingspan Evening', date: '2026-04-12' },
      ],
    }), { status: 200 }));

    const out = await tool('get_photos').handler({ query: 'catan' }, env, ctx) as any;
    expect(out.albums).toHaveLength(1);
    expect(out.albums[0]).toEqual({
      title: 'Catan Night',
      date: '2026-05-24',
      album_url: 'https://boardgamecompany.in/photos?event=F1',
    });
  });

  it('raises a friendly error when the photos backend is down', async () => {
    (handleEventPhotos as any).mockResolvedValue(new Response('nope', { status: 502 }));
    await expect(tool('get_photos').handler({}, env, ctx)).rejects.toThrow(/photos/i);
  });
});
