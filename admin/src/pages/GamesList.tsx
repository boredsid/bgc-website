import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import DataTable, { Column } from '@/components/DataTable';
import MobileCardList, { CardField } from '@/components/MobileCardList';
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

  const fields: CardField<Game>[] = [
    { key: 'title', render: (g) => g.title, primary: true },
    { key: 'meta', render: (g) => `${g.player_count || '—'} · ${g.complexity || '—'}` },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">Games</h1>
        <Button asChild className="hidden md:inline-flex">
          <Link to="/games/new">Add game</Link>
        </Button>
      </div>
      <div className="flex gap-2 mb-3 flex-wrap">
        <Input placeholder="Search title…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
        <Input placeholder="Filter by who has it…" value={withFilter} onChange={(e) => setWithFilter(e.target.value)} className="max-w-xs" />
      </div>
      {loading ? <p>Loading…</p> : (
        <>
          <div className="md:hidden">
            <MobileCardList
              rows={filtered}
              fields={fields}
              rowKey={(g) => g.id}
              onRowClick={(g) => navigate(`/games/${g.id}`)}
              emptyMessage="No games match."
              trailing={(g) => (
                <span className="text-xs text-muted-foreground">
                  {g.currently_with ? `with ${g.currently_with}` : ''}
                </span>
              )}
            />
          </div>
          <div className="hidden md:block">
            <DataTable
              rows={filtered}
              columns={columns}
              rowKey={(g) => g.id}
              onRowClick={(g) => navigate(`/games/${g.id}`)}
              emptyMessage="No games match."
            />
          </div>
        </>
      )}

      <Link
        to="/games/new"
        className="md:hidden fixed right-4 bottom-20 z-30 h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center"
        style={{ bottom: 'calc(5rem + env(safe-area-inset-bottom))' }}
        aria-label="Add game"
      >
        <Plus className="h-6 w-6" />
      </Link>
    </div>
  );
}
