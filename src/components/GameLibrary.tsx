import { useEffect, useState, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import type { Game } from '../lib/types';

const COMPLEXITY_COLORS: Record<string, string> = {
  Light: 'bg-green-100 text-green-800',
  Medium: 'bg-yellow-100 text-yellow-800',
  Heavy: 'bg-red-100 text-red-800',
};

export default function GameLibrary() {
  const [games, setGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [playerFilter, setPlayerFilter] = useState('');
  const [complexityFilter, setComplexityFilter] = useState('');
  const [lengthFilter, setLengthFilter] = useState('');

  useEffect(() => {
    async function fetchGames() {
      const { data } = await supabase
        .from('games')
        .select('id, title, player_count, max_players, avg_rating, weight, complexity, play_time, max_play_time, length')
        .order('title');

      setGames(data || []);
      setLoading(false);
    }
    fetchGames();
  }, []);

  const filtered = useMemo(() => {
    return games.filter((game) => {
      if (search && !game.title.toLowerCase().includes(search.toLowerCase())) {
        return false;
      }
      if (playerFilter) {
        const count = parseInt(playerFilter, 10);
        if (game.max_players < count) return false;
      }
      if (complexityFilter && game.complexity !== complexityFilter) {
        return false;
      }
      if (lengthFilter && game.length !== lengthFilter) {
        return false;
      }
      return true;
    });
  }, [games, search, playerFilter, complexityFilter, lengthFilter]);

  const hasFilters = search || playerFilter || complexityFilter || lengthFilter;

  function clearFilters() {
    setSearch('');
    setPlayerFilter('');
    setComplexityFilter('');
    setLengthFilter('');
  }

  if (loading) {
    return (
      <div className="text-center py-12 text-muted">Loading games...</div>
    );
  }

  return (
    <div>
      {/* Filter Bar */}
      <div className="sticky top-16 z-40 bg-bg/95 backdrop-blur-sm py-4 -mx-4 px-4 border-b border-border mb-6">
        <div className="flex flex-wrap gap-3 items-center">
          <input
            type="text"
            placeholder="Search games..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 min-w-[200px] px-4 py-2 rounded-xl border border-border bg-white text-sm focus:outline-none focus:border-primary"
          />
          <select
            value={playerFilter}
            onChange={(e) => setPlayerFilter(e.target.value)}
            className="px-3 py-2 rounded-xl border border-border bg-white text-sm focus:outline-none focus:border-primary"
          >
            <option value="">Players</option>
            <option value="2">2+</option>
            <option value="4">4+</option>
            <option value="6">6+</option>
            <option value="8">8+</option>
          </select>
          <select
            value={complexityFilter}
            onChange={(e) => setComplexityFilter(e.target.value)}
            className="px-3 py-2 rounded-xl border border-border bg-white text-sm focus:outline-none focus:border-primary"
          >
            <option value="">Complexity</option>
            <option value="Light">Light</option>
            <option value="Medium">Medium</option>
            <option value="Heavy">Heavy</option>
          </select>
          <select
            value={lengthFilter}
            onChange={(e) => setLengthFilter(e.target.value)}
            className="px-3 py-2 rounded-xl border border-border bg-white text-sm focus:outline-none focus:border-primary"
          >
            <option value="">Play Time</option>
            <option value="Quick">Quick (&lt;30 min)</option>
            <option value="Medium">Medium (30-60 min)</option>
            <option value="Long">Long (60+ min)</option>
          </select>
          {hasFilters && (
            <button
              onClick={clearFilters}
              className="text-sm text-primary hover:underline"
            >
              Clear all
            </button>
          )}
        </div>
        <p className="text-xs text-muted mt-2">
          Showing {filtered.length} of {games.length} games
        </p>
      </div>

      {/* Game Grid */}
      {filtered.length === 0 ? (
        <div className="text-center py-12 text-muted">
          No games match your filters. Try adjusting your search.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map((game) => (
            <div
              key={game.id}
              className="bg-white rounded-xl border border-border p-4 hover:border-primary/50 transition-colors"
            >
              <h3 className="font-heading font-bold text-base mb-2 leading-tight">
                {game.title}
              </h3>
              <div className="flex flex-wrap gap-2 text-xs text-muted">
                <span>👥 {game.player_count}</span>
                <span>⏱ {game.play_time} min</span>
                {game.avg_rating && <span>⭐ {game.avg_rating.toFixed(1)}</span>}
              </div>
              {game.complexity && (
                <span
                  className={`inline-block mt-2 px-2 py-0.5 rounded-full text-xs font-medium ${COMPLEXITY_COLORS[game.complexity] || 'bg-gray-100 text-gray-800'}`}
                >
                  {game.complexity}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
