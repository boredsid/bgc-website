import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import DataTable, { Column } from '@/components/DataTable';
import { fetchAdmin, showApiError } from '@/lib/api';
import type { Game } from '@/lib/types';

export default function GamesList() {
  const [games, setGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [withFilter, setWithFilter] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    fetchAdmin<{ games: Game[] }>('/api/admin/games')
      .then((r) => setGames(r.games))
      .catch(showApiError)
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const s = search.toLowerCase().trim();
    const w = withFilter.toLowerCase().trim();
    return games.filter((g) =>
      (!s || g.title.toLowerCase().includes(s)) &&
      (!w || (g.currently_with || '').toLowerCase().includes(w)),
    );
  }, [games, search, withFilter]);

  const columns: Column<Game>[] = [
    { key: 'title', header: 'Title', render: (g) => g.title },
    { key: 'players', header: 'Players', render: (g) => g.player_count || '—' },
    { key: 'complexity', header: 'Complexity', render: (g) => g.complexity || '—' },
    { key: 'owned_by', header: 'Owned by', render: (g) => g.owned_by || '—' },
    { key: 'currently_with', header: 'Currently with', render: (g) => g.currently_with || '—' },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">Games</h1>
        <Button asChild><Link to="/games/new">Add game</Link></Button>
      </div>
      <div className="flex gap-2 mb-3">
        <Input placeholder="Search title…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
        <Input placeholder="Filter by who has it…" value={withFilter} onChange={(e) => setWithFilter(e.target.value)} className="max-w-xs" />
      </div>
      {loading ? <p>Loading…</p> : (
        <DataTable
          rows={filtered}
          columns={columns}
          rowKey={(g) => g.id}
          onRowClick={(g) => navigate(`/games/${g.id}`)}
          emptyMessage="No games match."
        />
      )}
    </div>
  );
}
