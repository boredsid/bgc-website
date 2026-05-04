import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import DataTable, { Column } from '@/components/DataTable';
import MobileCardList, { CardField } from '@/components/MobileCardList';
import { BulkActionBar, type BulkAction } from '@/components/BulkActionBar';
import { fetchAdmin, showApiError } from '@/lib/api';
import { toast } from 'sonner';
import type { Game } from '@/lib/types';

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '';

export default function GamesList() {
  const [games, setGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [withFilter, setWithFilter] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkUpdateOpen, setBulkUpdateOpen] = useState(false);
  const [bulkUpdateValue, setBulkUpdateValue] = useState('');
  const navigate = useNavigate();

  function refresh() {
    setLoading(true);
    fetchAdmin<{ games: Game[] }>('/api/admin/games')
      .then((r) => setGames(r.games))
      .catch(showApiError)
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    refresh();
  }, []);

  const filtered = useMemo(() => {
    const s = search.toLowerCase().trim();
    const w = withFilter.toLowerCase().trim();
    return games.filter((g) =>
      (!s || g.title.toLowerCase().includes(s)) &&
      (!w || (g.currently_with || '').toLowerCase().includes(w)),
    );
  }, [games, search, withFilter]);

  // ---- Inline currently_with edit (desktop) ----
  async function updateCurrentlyWith(game: Game, next: string | null) {
    const prev = game.currently_with ?? null;
    setGames((rows) => rows.map((g) => g.id === game.id ? { ...g, currently_with: next } : g));
    try {
      await fetchAdmin(`/api/admin/games/${game.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ currently_with: next }),
      });
    } catch (e) {
      setGames((rows) => rows.map((g) => g.id === game.id ? { ...g, currently_with: prev } : g));
      showApiError(e);
    }
  }

  // ---- Bulk operations ----
  async function bulkUpdateCurrentlyWith() {
    const ids = [...selectedIds];
    const value = bulkUpdateValue.trim();
    const next = value === '' ? null : value;
    setBulkUpdateOpen(false);
    if (ids.length === 0) return;
    const results = await Promise.allSettled(
      ids.map((id) =>
        fetchAdmin(`/api/admin/games/${id}`, {
          method: 'PATCH',
          body: JSON.stringify({ currently_with: next }),
        }),
      ),
    );
    const failed = results.filter((r) => r.status === 'rejected');
    if (failed.length === 0) {
      toast.success(`Updated ${ids.length} games`);
    } else {
      const firstError = (failed[0] as PromiseRejectedResult).reason;
      showApiError(firstError);
    }
    setSelectedIds([]);
    setBulkUpdateValue('');
    refresh();
  }

  function bulkExportCsv() {
    if (selectedIds.length === 0) return;
    window.location.href = `${API_BASE}/api/admin/games/export?ids=${encodeURIComponent(selectedIds.join(','))}`;
  }

  const bulkActions: BulkAction[] = [
    {
      label: 'Update "Currently with"',
      onClick: () => {
        setBulkUpdateValue('');
        setBulkUpdateOpen(true);
      },
    },
    { label: 'Export CSV', onClick: bulkExportCsv },
  ];

  const columns: Column<Game>[] = [
    {
      key: 'title', header: 'Title', render: (g) => g.title,
      sortable: true, sortValue: (g) => g.title.toLowerCase(),
    },
    { key: 'players', header: 'Players', render: (g) => g.player_count || '—' },
    { key: 'complexity', header: 'Complexity', render: (g) => g.complexity || '—' },
    { key: 'owned_by', header: 'Owned by', render: (g) => g.owned_by || '—' },
    {
      key: 'currently_with',
      header: 'Currently with',
      render: (g) => (
        <CurrentlyWithCell
          game={g}
          onChange={(next) => updateCurrentlyWith(g, next)}
        />
      ),
      sortable: true,
      sortValue: (g) => (g.currently_with ?? '').toLowerCase(),
    },
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
            <BulkActionBar
              count={selectedIds.length}
              actions={bulkActions}
              onClear={() => setSelectedIds([])}
            />
            <DataTable
              rows={filtered}
              columns={columns}
              rowKey={(g) => g.id}
              onRowClick={(g) => navigate(`/games/${g.id}`)}
              emptyMessage="No games match."
              selectable
              selectedIds={selectedIds}
              onSelectedIdsChange={setSelectedIds}
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

      <Dialog open={bulkUpdateOpen} onOpenChange={setBulkUpdateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Update "Currently with" for {selectedIds.length} games</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <Input
              autoFocus
              placeholder="Name (leave blank to clear)"
              value={bulkUpdateValue}
              onChange={(e) => setBulkUpdateValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') bulkUpdateCurrentlyWith();
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkUpdateOpen(false)}>Cancel</Button>
            <Button onClick={bulkUpdateCurrentlyWith}>OK</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CurrentlyWithCell({ game, onChange }: { game: Game; onChange: (next: string | null) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(game.currently_with || '');
  if (!editing) {
    return (
      <button
        className="text-left hover:underline"
        onClick={(e) => {
          e.stopPropagation();
          setEditing(true);
          setValue(game.currently_with || '');
        }}
      >
        {game.currently_with || '—'}
      </button>
    );
  }
  function commit() {
    setEditing(false);
    const next = value || null;
    const prev = game.currently_with || null;
    if (next !== prev) onChange(next);
  }
  return (
    <Input
      autoFocus
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        else if (e.key === 'Escape') {
          setEditing(false);
          setValue(game.currently_with || '');
        }
      }}
      onClick={(e) => e.stopPropagation()}
      className="h-7 text-xs"
    />
  );
}
