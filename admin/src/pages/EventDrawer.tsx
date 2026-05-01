import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import CustomQuestionsEditor from '@/components/CustomQuestionsEditor';
import { fetchAdmin, showApiError } from '@/lib/api';
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

  useEffect(() => {
    if (mode !== 'edit' || !id) return;
    fetchAdmin<{ event: Event }>(`/api/admin/events/${id}`)
      .then((r) => {
        setForm(r.event);
        setInitial(r.event);
      })
      .catch(showApiError)
      .finally(() => setLoading(false));
  }, [mode, id]);

  const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(initial), [form, initial]);

  function close() {
    if (dirty && !confirm('Discard changes?')) return;
    navigate('/events');
  }

  async function save() {
    setSaving(true);
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
      showApiError(err);
    } finally {
      setSaving(false);
    }
  }

  function set<K extends keyof Event>(key: K, value: Event[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  return (
    <Sheet open onOpenChange={(o) => { if (!o) close(); }}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{mode === 'create' ? 'New event' : 'Edit event'}</SheetTitle>
        </SheetHeader>
        {loading ? <p className="p-4">Loading…</p> : (
          <div className="space-y-4 p-4">
            <div>
              <Label>Name</Label>
              <Input value={form.name || ''} onChange={(e) => set('name', e.target.value)} />
            </div>
            <div>
              <Label>Description</Label>
              <Textarea value={form.description || ''} onChange={(e) => set('description', e.target.value)} rows={4} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Date & time</Label>
                <Input
                  type="datetime-local"
                  value={form.date ? toLocalInput(form.date) : ''}
                  onChange={(e) => set('date', new Date(e.target.value).toISOString())}
                />
              </div>
              <div>
                <Label>Capacity</Label>
                <Input type="number" value={form.capacity ?? 0} onChange={(e) => set('capacity', Number(e.target.value))} />
              </div>
              <div>
                <Label>Venue name</Label>
                <Input value={form.venue_name || ''} onChange={(e) => set('venue_name', e.target.value)} />
              </div>
              <div>
                <Label>Venue area</Label>
                <Input value={form.venue_area || ''} onChange={(e) => set('venue_area', e.target.value)} />
              </div>
              <div>
                <Label>Price (₹)</Label>
                <Input type="number" value={form.price ?? 0} onChange={(e) => set('price', Number(e.target.value))} />
              </div>
              <div>
                <Label>Price includes</Label>
                <Input value={form.price_includes || ''} onChange={(e) => set('price_includes', e.target.value)} />
              </div>
            </div>
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
            <div className="flex justify-end gap-2 pt-4 border-t">
              <Button variant="ghost" onClick={close} disabled={saving}>Cancel</Button>
              <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
