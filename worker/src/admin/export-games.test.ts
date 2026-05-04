import { describe, it, expect } from 'vitest';
import { flattenGames, type GameRow } from './export-games';

describe('flattenGames', () => {
  const rows: GameRow[] = [
    {
      id: 'g1', title: 'Catan', player_count: '3-4',
      complexity: 'medium', owned_by: 'Sid', currently_with: null,
      length: '60-90', max_players: 4,
    },
    {
      id: 'g2', title: 'Wingspan', player_count: '1-5',
      complexity: 'medium', owned_by: 'BGC', currently_with: 'Anita',
      length: '40-70', max_players: 5,
    },
  ];

  it('returns the documented header order', () => {
    const { headers } = flattenGames(rows);
    expect(headers).toEqual(['title', 'player_count', 'complexity', 'owned_by', 'currently_with', 'length', 'max_players']);
  });

  it('flattens rows preserving null fields', () => {
    const { rows: out } = flattenGames(rows);
    expect(out[0]).toEqual({
      title: 'Catan', player_count: '3-4', complexity: 'medium',
      owned_by: 'Sid', currently_with: null, length: '60-90', max_players: 4,
    });
    expect(out[1].currently_with).toBe('Anita');
  });
});
