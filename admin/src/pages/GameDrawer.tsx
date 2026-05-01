import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { fetchAdmin, showApiError } from '@/lib/api';
import { toast } from 'sonner';
import type { Game } from '@/lib/types';

interface Props { mode: 'create' | 'edit' }

const empty: Partial<Game> = {
  title: '', player_count: '', max_players: null, avg_rating: null, weight: null,
  complexity: '', play_time: '', max_play_time: null, length: '',
  owned_by: '', currently_with: '',
};

const FIELDS: Array<{ key: keyof Game; label: string; type?: string }> = [
  { key: 'title', label: 'Title' },
  { key: 'player_count', label: 'Player count (display)' },
  { key: 'max_players', label: 'Max players', type: 'number' },
  { key: 'avg_rating', label: 'Avg rating', type: 'number' },
  { key: 'weight', label: 'Weight', type: 'number' },
  { key: 'complexity', label: 'Complexity' },
  { key: 'play_time', label: 'Play time (display)' },
  { key: 'max_play_time', label: 'Max play time (min)', type: 'number' },
  { key: 'length', label: 'Length' },
  { key: 'owned_by', label: 'Owned by' },
  { key: 'currently_with', label: 'Currently with' },
];

export default function GameDrawer({ mode }: Props) {
  const navigate = useNavigate();
  const { id } = useParams();
  const [form, setForm] = useState<Partial<Game>>(empty);
  const [initial, setInitial] = useState<Partial<Game>>(empty);
  const [loading, setLoading] = useState(mode === 'edit');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (mode !== 'edit' || !id) return;
    fetchAdmin<{ game: Game }>(`/api/admin/games/${id}`)
      .then((r) => { setForm(r.game); setInitial(r.game); })
      .catch(showApiError)
      .finally(() => setLoading(false));
  }, [mode, id]);

  const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(initial), [form, initial]);

  function close() {
    if (dirty && !confirm('Discard changes?')) return;
    navigate('/games');
  }

  async function save() {
    setSaving(true);
    try {
      if (mode === 'create') {
        await fetchAdmin('/api/admin/games', { method: 'POST', body: JSON.stringify(form) });
        toast.success('Game added');
      } else {
        await fetchAdmin(`/api/admin/games/${id}`, { method: 'PATCH', body: JSON.stringify(form) });
        toast.success('Game updated');
      }
      navigate('/games');
    } catch (err) {
      showApiError(err);
    } finally {
      setSaving(false);
    }
  }

  function set(key: keyof Game, value: string) {
    setForm((f) => ({
      ...f,
      [key]: value === ''
        ? null
        : (FIELDS.find((x) => x.key === key)?.type === 'number' ? Number(value) : value),
    }));
  }

  return (
    <Sheet open onOpenChange={(o) => { if (!o) close(); }}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{mode === 'create' ? 'Add game' : 'Edit game'}</SheetTitle>
        </SheetHeader>
        {loading ? <p className="p-4">Loading…</p> : (
          <div className="grid grid-cols-2 gap-3 p-4">
            {FIELDS.map((f) => (
              <div key={f.key as string}>
                <Label>{f.label}</Label>
                <Input
                  type={f.type || 'text'}
                  value={(form[f.key] as string | number | null) ?? ''}
                  onChange={(e) => set(f.key, e.target.value)}
                />
              </div>
            ))}
            <div className="col-span-2 flex justify-end gap-2 pt-4 border-t">
              <Button variant="ghost" onClick={close} disabled={saving}>Cancel</Button>
              <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
