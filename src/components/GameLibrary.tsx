import { useEffect, useState, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import type { Game } from '../lib/types';

const COMPLEXITY_BG: Record<string, string> = {
  Light: '#A8E6CF',
  Medium: '#FFD166',
  Heavy: '#FF6B6B',
};

export default function GameLibrary() {
  const [games, setGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [playerFilter, setPlayerFilter] = useState('');
  const [complexityFilter, setComplexityFilter] = useState('');
  const [lengthFilter, setLengthFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [filterBarOpen, setFilterBarOpen] = useState(false);
  const [selectedGame, setSelectedGame] = useState<Game | null>(null);

  useEffect(() => {
    async function fetchGames() {
      const { data, error } = await supabase
        .from('games')
        .select('id, title, player_count, max_players, avg_rating, weight, complexity, play_time, max_play_time, length')
        .order('title');
      if (error) {
        console.error('Supabase error:', error);
        setError(error.message);
      }
      setGames(data || []);
      setLoading(false);
    }
    fetchGames();
  }, []);

  const filtered = useMemo(() => {
    return games.filter((game) => {
      if (search && !game.title.toLowerCase().includes(search.toLowerCase())) return false;
      if (playerFilter) {
        const minPlayers = parseInt(game.player_count, 10) || 1;
        const maxPlayers = game.max_players || minPlayers;
        if (playerFilter === 'up-to-2' && maxPlayers > 2) return false;
        if (playerFilter === '3-5' && (maxPlayers < 3 || minPlayers > 5)) return false;
        if (playerFilter === '6+' && maxPlayers < 6) return false;
      }
      if (complexityFilter && game.complexity !== complexityFilter) return false;
      if (lengthFilter) {
        if (lengthFilter === 'Long') {
          if (game.length !== 'Long' && game.length !== 'Very Long') return false;
        } else if (game.length !== lengthFilter) return false;
      }
      return true;
    });
  }, [games, search, playerFilter, complexityFilter, lengthFilter]);

  const hasFilters = !!(search || playerFilter || complexityFilter || lengthFilter);

  function clearFilters() {
    setSearch('');
    setPlayerFilter('');
    setComplexityFilter('');
    setLengthFilter('');
  }

  if (loading) {
    return <div className="text-center py-16 text-[#1A1A1A]/60 font-heading">Loading games...</div>;
  }
  if (error) {
    return (
      <div className="text-center py-16">
        <p className="font-heading font-bold text-xl text-[#FF6B6B]">Failed to load games</p>
        <p className="text-sm mt-1 text-[#1A1A1A]/70">{error}</p>
      </div>
    );
  }

  return (
    <div>
      {/* Stats pill */}
      <div className="mb-4">
        <span className="pill pill-yellow">🎲 {games.length} games</span>
      </div>

      {/* Controls row */}
      <div className="flex flex-wrap gap-3 items-center mb-3">
        <input
          type="text"
          placeholder="Search games..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input-brutal flex-1 min-w-[200px]"
        />
        <button
          onClick={() => setFilterBarOpen(!filterBarOpen)}
          className="btn btn-secondary btn-sm md:hidden"
        >
          Filters {filterBarOpen ? '▲' : '▼'}
        </button>
      </div>

      {/* Filter bar */}
      <div
        className={`${filterBarOpen ? 'flex' : 'hidden'} md:flex flex-wrap gap-5 items-end mb-5 p-4 rounded-xl`}
        style={{ background: '#FAFAF5', border: '2px solid #1A1A1A' }}
      >
        <FilterGroup label="Complexity" value={complexityFilter} onChange={setComplexityFilter} options={['Light', 'Medium', 'Heavy']} />
        <FilterGroup
          label="Players"
          value={playerFilter}
          onChange={setPlayerFilter}
          options={['up-to-2', '3-5', '6+']}
          valueLabel={(v) => (v === 'up-to-2' ? 'Up to 2' : v)}
        />
        <FilterGroup label="Play Time" value={lengthFilter} onChange={setLengthFilter} options={['Quick', 'Mid-Length', 'Long']} />
        {hasFilters && (
          <button onClick={clearFilters} className="font-heading font-semibold text-sm text-[#FF6B6B] bg-transparent border-0 cursor-pointer ml-auto py-2">
            Clear all
          </button>
        )}
      </div>

      {/* Stats */}
      <p className="text-sm text-[#1A1A1A]/60 mb-5 font-heading">
        Showing {filtered.length} of {games.length}
      </p>

      {/* Grid */}
      {filtered.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-6xl mb-4">🔍</div>
          <p className="font-heading text-lg text-[#1A1A1A]/60">No games match your filters.</p>
        </div>
      ) : (
        <div className="grid gap-5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
          {filtered.map((game) => (
            <GameCard key={game.id} game={game} onOpen={() => setSelectedGame(game)} />
          ))}
        </div>
      )}

      {selectedGame && <GameModal game={selectedGame} onClose={() => setSelectedGame(null)} />}
    </div>
  );
}

function FilterGroup({
  label, value, onChange, options, valueLabel,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  valueLabel?: (v: string) => string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="label-brutal">{label}</span>
      <div className="flex flex-wrap gap-1.5">
        {options.map((opt) => {
          const active = value === opt;
          return (
            <button
              key={opt}
              onClick={() => onChange(active ? '' : opt)}
              className={`font-heading font-semibold rounded-lg px-3 py-1.5 text-xs cursor-pointer transition-colors`}
              style={{
                border: '2px solid #1A1A1A',
                background: active ? '#1A1A1A' : '#FFFFFF',
                color: active ? '#FFFFFF' : '#1A1A1A',
              }}
            >
              {valueLabel ? valueLabel(opt) : opt}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function GameCard({ game, onOpen }: { game: Game; onOpen: () => void }) {
  const letter = game.title[0]?.toUpperCase() ?? '?';
  const complexityBg = game.complexity ? COMPLEXITY_BG[game.complexity] : '#FAFAF5';
  return (
    <button
      onClick={onOpen}
      className="card-brutal flex flex-col overflow-hidden text-left p-0 cursor-pointer"
      style={{ background: '#FFFFFF' }}
    >
      <div className="relative flex items-center justify-center h-[100px]" style={{ background: complexityBg, borderBottom: '3px solid #1A1A1A' }}>
        <span className="font-heading font-bold opacity-20" style={{ fontSize: '3.5rem' }}>{letter}</span>
        {game.avg_rating !== null && game.avg_rating !== undefined && (
          <span className="absolute top-2.5 left-2.5 pill pill-black" style={{ padding: '3px 10px', fontSize: '0.75rem' }}>
            ⭐ {Number(game.avg_rating).toFixed(1)}
          </span>
        )}
        {game.complexity && (
          <span className="absolute top-2.5 right-2.5 pill" style={{ padding: '3px 10px', fontSize: '0.7rem', background: '#FFFFFF', border: '2px solid #1A1A1A' }}>
            {game.complexity}
          </span>
        )}
      </div>
      <div className="flex-1 flex flex-col px-5 pt-4 pb-5">
        <h3 className="font-heading font-bold text-base mb-2 leading-tight">{game.title}</h3>
        <div className="flex flex-wrap gap-1.5 mt-auto">
          <span className="pill" style={{ padding: '4px 10px', fontSize: '0.75rem', background: '#FFF8E7', border: '2px solid #1A1A1A' }}>
            👥 {game.player_count}
          </span>
          <span className="pill" style={{ padding: '4px 10px', fontSize: '0.75rem', background: '#FFF8E7', border: '2px solid #1A1A1A' }}>
            ⏱ {game.play_time}m
          </span>
        </div>
      </div>
    </button>
  );
}

function GameModal({ game, onClose }: { game: Game; onClose: () => void }) {
  const letter = game.title[0]?.toUpperCase() ?? '?';
  const complexityBg = game.complexity ? COMPLEXITY_BG[game.complexity] : '#FAFAF5';

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[3000] flex items-center justify-center p-6 animate-fade-in"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={onClose}
    >
      <div
        className="animate-modal rounded-2xl overflow-hidden w-full max-w-[480px] max-h-[85vh] overflow-y-auto"
        style={{ background: '#FFFFFF', border: '4px solid #1A1A1A', boxShadow: '12px 12px 0 #1A1A1A' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative flex items-center justify-center h-[120px]" style={{ background: complexityBg, borderBottom: '3px solid #1A1A1A' }}>
          <span className="font-heading font-bold opacity-20" style={{ fontSize: '4rem' }}>{letter}</span>
          <button
            onClick={onClose}
            aria-label="Close"
            className="absolute top-3 right-3 w-8 h-8 flex items-center justify-center rounded-lg cursor-pointer font-bold"
            style={{ background: '#FFF8E7', border: '2px solid #1A1A1A' }}
          >
            ✕
          </button>
        </div>
        <div className="p-6">
          <h2 className="font-heading font-bold text-2xl mb-3" style={{ letterSpacing: '-0.5px' }}>{game.title}</h2>
          <div className="flex flex-wrap gap-2 mb-4">
            {game.avg_rating !== null && game.avg_rating !== undefined && (
              <span className="pill pill-black" style={{ padding: '4px 12px', fontSize: '0.8rem' }}>
                ⭐ {Number(game.avg_rating).toFixed(1)}
              </span>
            )}
            {game.complexity && (
              <span className="pill" style={{ padding: '4px 12px', fontSize: '0.8rem', background: '#FFFFFF', border: '2px solid #1A1A1A' }}>
                {game.complexity}
              </span>
            )}
          </div>
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))' }}>
            <DetailCard label="Players" value={game.player_count || '—'} />
            <DetailCard label="Duration" value={game.play_time ? `${game.play_time}${game.max_play_time && game.max_play_time !== Number(game.play_time) ? `–${game.max_play_time}` : ''} min` : '—'} />
            {game.weight !== null && game.weight !== undefined && (
              <DetailCard label="Weight" value={Number(game.weight).toFixed(1)} />
            )}
            {game.length && <DetailCard label="Length" value={game.length} />}
          </div>
        </div>
      </div>
    </div>
  );
}

function DetailCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="text-center rounded-xl p-3" style={{ background: '#FFF8E7', border: '2px solid #1A1A1A' }}>
      <div className="label-brutal mb-1">{label}</div>
      <div className="font-heading font-bold text-base">{value}</div>
    </div>
  );
}
