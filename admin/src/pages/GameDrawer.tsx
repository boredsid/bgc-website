import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FormDrawer } from '@/components/FormDrawer';
import { NumberInput } from '@/components/NumberInput';
import { fetchAdmin, showApiError } from '@/lib/api';
import { validateGame, type ValidationErrors } from '@/lib/validation';
import { toast } from 'sonner';
import type { Game } from '@/lib/types';

interface Props { mode: 'create' | 'edit' }

const OWNERS = ['Siddhant', 'Suranjana', 'Amrit', 'Swapnil', 'BGC'] as const;
const HOLDERS = ['Siddhant', 'Suranjana', 'Amrit', 'Swapnil'] as const;

const empty: Partial<Game> = {
  title: '', player_count: '', max_players: null, avg_rating: null, weight: null,
  complexity: '', play_time: '', max_play_time: null, length: '',
  owned_by: '', currently_with: '',
};

function maxFromRange(s: string | null | undefined): number | null {
  if (!s) return null;
  const nums = s.match(/\d+(\.\d+)?/g);
  if (!nums || nums.length === 0) return null;
  return Math.max(...nums.map(Number));
}

function complexityFromWeight(w: number | null): string {
  if (w == null) return '';
  if (w < 2) return 'Light';
  if (w < 3) return 'Medium';
  return 'Heavy';
}

function lengthFromMinutes(m: number | null): string {
  if (m == null) return '';
  if (m <= 30) return 'Quick';
  if (m <= 60) return 'Mid-Length';
  if (m <= 120) return 'Long';
  return 'Very Long';
}

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

  const derived = useMemo(() => {
    const max_players = maxFromRange(form.player_count ?? null);
    const max_play_time = maxFromRange(form.play_time ?? null);
    const complexity = complexityFromWeight(form.weight ?? null);
    const length = lengthFromMinutes(max_play_time);
    return { max_players, max_play_time, complexity, length };
  }, [form.player_count, form.play_time, form.weight]);

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
    const payload: Partial<Game> = {
      ...form,
      max_players: derived.max_players,
      max_play_time: derived.max_play_time,
      complexity: derived.complexity || null,
      length: derived.length || null,
    };
    try {
      if (mode === 'create') {
        await fetchAdmin('/api/admin/games', { method: 'POST', body: JSON.stringify(payload) });
        toast.success('Game added');
      } else {
        await fetchAdmin(`/api/admin/games/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
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
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            {field('title', 'Title', (
              <Input
                value={form.title ?? ''}
                onChange={(e) => set('title', e.target.value)}
              />
            ))}
            {field('player_count', 'Player count', (
              <Input
                placeholder="e.g. 2-6"
                value={form.player_count ?? ''}
                onChange={(e) => {
                  const v = e.target.value;
                  set('player_count', (v === '' ? null : v) as Game['player_count']);
                }}
              />
            ))}
            {field('avg_rating', 'Avg rating', (
              <NumberInput
                value={form.avg_rating ?? null}
                onChange={(n) => set('avg_rating', n)}
                aria-label="Avg rating"
              />
            ))}
            {field('weight', 'Weight', (
              <NumberInput
                value={form.weight ?? null}
                onChange={(n) => set('weight', n)}
                aria-label="Weight"
              />
            ))}
            {field('play_time', 'Play time', (
              <Input
                placeholder="e.g. 30-60"
                value={form.play_time ?? ''}
                onChange={(e) => {
                  const v = e.target.value;
                  set('play_time', (v === '' ? null : v) as Game['play_time']);
                }}
              />
            ))}
            {field('owned_by', 'Owned by', (
              <Select
                value={form.owned_by ?? ''}
                onValueChange={(v) => set('owned_by', v as Game['owned_by'])}
              >
                <SelectTrigger className="w-full"><SelectValue placeholder="Select owner" /></SelectTrigger>
                <SelectContent>
                  {OWNERS.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                </SelectContent>
              </Select>
            ))}
            {field('currently_with', 'Currently with', (
              <Select
                value={form.currently_with ?? ''}
                onValueChange={(v) => set('currently_with', v as Game['currently_with'])}
              >
                <SelectTrigger className="w-full"><SelectValue placeholder="Select holder" /></SelectTrigger>
                <SelectContent>
                  {HOLDERS.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                </SelectContent>
              </Select>
            ))}
          </div>

          <div className="rounded-md border bg-muted/30 p-3">
            <div className="text-xs font-medium text-muted-foreground mb-2">Auto-derived</div>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
              <dt className="text-muted-foreground">Max players</dt>
              <dd>{derived.max_players ?? <span className="text-muted-foreground">—</span>}</dd>
              <dt className="text-muted-foreground">Complexity</dt>
              <dd>{derived.complexity || <span className="text-muted-foreground">—</span>}</dd>
              <dt className="text-muted-foreground">Max play time (min)</dt>
              <dd>{derived.max_play_time ?? <span className="text-muted-foreground">—</span>}</dd>
              <dt className="text-muted-foreground">Length</dt>
              <dd>{derived.length || <span className="text-muted-foreground">—</span>}</dd>
            </dl>
          </div>
        </div>
      )}
    </FormDrawer>
  );
}
