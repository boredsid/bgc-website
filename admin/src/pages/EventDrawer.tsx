import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { FormDrawer } from '@/components/FormDrawer';
import { NumberInput } from '@/components/NumberInput';
import { DateTimePicker } from '@/components/DateTimePicker';
import CustomQuestionsEditor from '@/components/CustomQuestionsEditor';
import { fetchAdmin, showApiError } from '@/lib/api';
import { validateEvent, type ValidationErrors } from '@/lib/validation';
import { toast } from 'sonner';
import type { Event, CustomQuestion } from '@/lib/types';

interface Props { mode: 'create' | 'edit' }

const empty: Partial<Event> = {
  name: '', description: '', date: '', venue_name: '', venue_area: '',
  price: 0, capacity: 0, custom_questions: [], price_includes: '', is_published: false,
};

export default function EventDrawer({ mode }: Props) {
  const navigate = useNavigate();
  const { id } = useParams();
  const [form, setForm] = useState<Partial<Event>>(empty);
  const [initial, setInitial] = useState<Partial<Event>>(empty);
  const [loading, setLoading] = useState(mode === 'edit');
  const [saving, setSaving] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [venueSuggestions, setVenueSuggestions] = useState<string[]>([]);

  useEffect(() => {
    if (mode === 'edit' && id) {
      fetchAdmin<{ event: Event }>(`/api/admin/events/${id}`)
        .then((r) => { setForm(r.event); setInitial(r.event); })
        .catch(showApiError)
        .finally(() => setLoading(false));
    } else {
      // Smart default for create: clone the most recent published event.
      fetchAdmin<{ events: Event[] }>('/api/admin/events')
        .then((r) => {
          const sorted = [...r.events].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
          const latest = sorted.find((e) => e.is_published) || sorted[0];
          if (latest) {
            const nextDate = new Date();
            nextDate.setDate(nextDate.getDate() + 14);
            const cloned: Partial<Event> = {
              ...empty,
              date: nextDate.toISOString(),
              venue_name: latest.venue_name || '',
              venue_area: latest.venue_area || '',
              price: latest.price,
              capacity: latest.capacity,
              custom_questions: latest.custom_questions || [],
              price_includes: latest.price_includes || '',
            };
            setForm(cloned);
            setInitial(cloned);
          }
          // Build venue suggestion list from distinct venues.
          const seen = new Set<string>();
          const suggestions: string[] = [];
          for (const e of r.events) {
            if (e.venue_name && !seen.has(e.venue_name)) {
              seen.add(e.venue_name);
              suggestions.push(e.venue_name);
            }
          }
          setVenueSuggestions(suggestions);
        })
        .catch(() => {});
    }
  }, [mode, id]);

  const errors: ValidationErrors = useMemo(() => validateEvent(form), [form]);
  const errorCount = Object.keys(errors).length;
  const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(initial), [form, initial]);

  function close() { navigate('/events'); }

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
      const payload = {
        ...form,
        date: form.date ? new Date(form.date).toISOString() : '',
        custom_questions: form.custom_questions || [],
      };
      if (mode === 'create') {
        await fetchAdmin('/api/admin/events', { method: 'POST', body: JSON.stringify(payload) });
        toast.success('Event created');
      } else {
        await fetchAdmin(`/api/admin/events/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
        toast.success('Event updated');
      }
      navigate('/events');
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setSaving(false);
    }
  }

  function set<K extends keyof Event>(k: K, v: Event[K]) { setForm((f) => ({ ...f, [k]: v })); }

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
      title={mode === 'create' ? 'New event' : 'Edit event'}
      dirty={dirty}
      saving={saving}
      onCancel={close}
      onSave={save}
      errorCount={showErrors ? errorCount : 0}
      errorMessage={serverError}
    >
      {loading ? <p>Loading…</p> : (
        <>
          {field('name', 'Name', (
            <Input value={form.name || ''} onChange={(e) => set('name', e.target.value)} />
          ))}
          {field('description', 'Description', (
            <Textarea value={form.description || ''} onChange={(e) => set('description', e.target.value)} rows={4} />
          ))}
          {field('date', 'When', (
            <DateTimePicker value={form.date || ''} onChange={(iso) => set('date', iso)} />
          ))}
          <div className="grid grid-cols-2 gap-3">
            {field('capacity', 'Capacity', (
              <NumberInput value={form.capacity ?? null} onChange={(n) => set('capacity', n ?? 0)} aria-label="Capacity" />
            ))}
            {field('price', 'Price (₹)', (
              <NumberInput value={form.price ?? null} onChange={(n) => set('price', n ?? 0)} allowRupees aria-label="Price" />
            ))}
          </div>
          {field('venue_name', 'Venue name', (
            <>
              <Input list="venue-suggestions" value={form.venue_name || ''} onChange={(e) => set('venue_name', e.target.value)} />
              <datalist id="venue-suggestions">
                {venueSuggestions.map((v) => <option key={v} value={v} />)}
              </datalist>
            </>
          ))}
          {field('venue_area', 'Venue area', (
            <Input value={form.venue_area || ''} onChange={(e) => set('venue_area', e.target.value)} />
          ))}
          {field('price_includes', 'Price includes', (
            <Input value={form.price_includes || ''} onChange={(e) => set('price_includes', e.target.value)} />
          ))}
          <div className="flex items-center gap-2">
            <Switch checked={!!form.is_published} onCheckedChange={(c) => set('is_published', c)} />
            <Label>Published</Label>
          </div>
          <div>
            <Label className="block mb-2">Custom questions</Label>
            <CustomQuestionsEditor
              value={form.custom_questions || []}
              onChange={(qs: CustomQuestion[]) => set('custom_questions', qs)}
            />
          </div>
        </>
      )}
    </FormDrawer>
  );
}
