import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FormDrawer } from '@/components/FormDrawer';
import { NumberInput } from '@/components/NumberInput';
import { fetchAdmin, showApiError } from '@/lib/api';
import { validateGame, type ValidationErrors } from '@/lib/validation';
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
  const [showErrors, setShowErrors] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    if (mode !== 'edit' || !id) return;
    fetchAdmin<{ game: Game }>(`/api/admin/games/${id}`)
      .then((r) => { setForm(r.game); setInitial(r.game); })
      .catch(showApiError)
      .finally(() => setLoading(false));
  }, [mode, id]);

  const errors: ValidationErrors = useMemo(() => validateGame({ title: form.title }), [form.title]);
  const errorCount = Object.keys(errors).length;
  const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(initial), [form, initial]);

  function close() { navigate('/games'); }

  async function save() {
    setShowErrors(true);
    if (errorCount > 0) {
      const first = Object.keys(errors)[0];
      const el = document.getElementById(`field-${first}`);
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el?.focus();
      return;
    }
    setSaving(true);
    setServerError(null);
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
      setServerError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setSaving(false);
    }
  }

  function set<K extends keyof Game>(k: K, v: Game[K]) { setForm((f) => ({ ...f, [k]: v })); }

  function field(key: string, label: string, control: React.ReactNode) {
    const err = showErrors ? errors[key] : undefined;
    return (
      <div id={`field-${key}`}>
        <Label className={err ? 'text-destructive' : undefined}>{label}</Label>
        {control}
        {err && <div className="text-xs text-destructive mt-1">{err}</div>}
      </div>
    );
  }

  return (
    <FormDrawer
      open
      title={mode === 'create' ? 'Add game' : 'Edit game'}
      dirty={dirty}
      saving={saving}
      onCancel={close}
      onSave={save}
      errorCount={showErrors ? errorCount : 0}
      errorMessage={serverError}
    >
      {loading ? <p>Loading…</p> : (
        <div className="grid grid-cols-2 gap-3">
          {FIELDS.map((f) => {
            const key = f.key as string;
            if (f.type === 'number') {
              return (
                <div key={key}>
                  {field(key, f.label, (
                    <NumberInput
                      value={(form[f.key] as number | null) ?? null}
                      onChange={(n) => set(f.key, n as Game[typeof f.key])}
                      aria-label={f.label}
                    />
                  ))}
                </div>
              );
            }
            return (
              <div key={key}>
                {field(key, f.label, (
                  <Input
                    value={(form[f.key] as string | null) ?? ''}
                    onChange={(e) => {
                      const v = e.target.value;
                      set(f.key, (v === '' ? null : v) as Game[typeof f.key]);
                    }}
                  />
                ))}
              </div>
            );
          })}
        </div>
      )}
    </FormDrawer>
  );
}
