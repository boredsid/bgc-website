import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { fetchAdmin, showApiError } from '@/lib/api';
import { toast } from 'sonner';
import type { Registration, Event, CustomQuestion } from '@/lib/types';

export default function RegistrationDrawer() {
  const navigate = useNavigate();
  const { id } = useParams();
  const [reg, setReg] = useState<Registration | null>(null);
  const [initial, setInitial] = useState<Registration | null>(null);
  const [event, setEvent] = useState<Event | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!id) return;
    fetchAdmin<{ registration: Registration }>(`/api/admin/registrations/${id}`)
      .then((r) => {
        setReg(r.registration);
        setInitial(r.registration);
        return fetchAdmin<{ event: Event }>(`/api/admin/events/${r.registration.event_id}`);
      })
      .then((r) => setEvent(r.event))
      .catch(showApiError);
  }, [id]);

  const dirty = useMemo(() => JSON.stringify(reg) !== JSON.stringify(initial), [reg, initial]);

  function close() {
    if (dirty && !confirm('Discard changes?')) return;
    navigate(-1);
  }

  async function save() {
    if (!reg) return;
    setSaving(true);
    try {
      await fetchAdmin(`/api/admin/registrations/${reg.id}`, {
        method: 'PATCH',
        body: JSON.stringify(reg),
      });
      toast.success('Registration updated');
      navigate(-1);
    } catch (e) {
      showApiError(e);
    } finally {
      setSaving(false);
    }
  }

  function set<K extends keyof Registration>(k: K, v: Registration[K]) {
    setReg((r) => (r ? { ...r, [k]: v } : r));
  }

  function setAnswer(qid: string, value: string | boolean) {
    setReg((r) => {
      if (!r) return r;
      const next = { ...(r.custom_answers || {}) };
      if (value === '' || value === false) delete next[qid];
      else next[qid] = value;
      return { ...r, custom_answers: next };
    });
  }

  const customQuestions: CustomQuestion[] = (event?.custom_questions || []) as CustomQuestion[];
  const answers = reg?.custom_answers || {};

  return (
    <Sheet open onOpenChange={(o) => { if (!o) close(); }}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Edit registration</SheetTitle>
        </SheetHeader>
        {!reg ? <p className="p-4">Loading…</p> : (
          <div className="space-y-3 p-4">
            <div><Label>Name</Label><Input value={reg.name} onChange={(e) => set('name', e.target.value)} /></div>
            <div><Label>Phone</Label><Input value={reg.phone} onChange={(e) => set('phone', e.target.value)} /></div>
            <div><Label>Email</Label><Input value={reg.email || ''} onChange={(e) => set('email', e.target.value)} /></div>
            <div><Label>Seats</Label><Input type="number" value={reg.seats} onChange={(e) => set('seats', Number(e.target.value))} /></div>
            <div><Label>Total amount (₹)</Label><Input type="number" value={reg.total_amount} onChange={(e) => set('total_amount', Number(e.target.value))} /></div>
            <div>
              <Label>Payment status</Label>
              <Select value={reg.payment_status} onValueChange={(v) => set('payment_status', v as Registration['payment_status'])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="confirmed">Confirmed</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>Source</Label><Input value={reg.source || ''} onChange={(e) => set('source', e.target.value || null)} /></div>

            {customQuestions.length > 0 && (
              <div className="space-y-2 pt-2 border-t">
                <div className="text-sm font-medium">Custom answers</div>
                {customQuestions.map((q) => (
                  <div key={q.id}>
                    <Label>{q.label}{q.required && ' *'}</Label>
                    {q.type === 'text' && (
                      <Input
                        value={(answers[q.id] as string) || ''}
                        onChange={(e) => setAnswer(q.id, e.target.value)}
                      />
                    )}
                    {q.type === 'checkbox' && (
                      <div className="flex items-center gap-2 mt-1">
                        <Checkbox
                          checked={!!answers[q.id]}
                          onCheckedChange={(c) => setAnswer(q.id, !!c)}
                        />
                        <span className="text-sm">Yes</span>
                      </div>
                    )}
                    {(q.type === 'select' || q.type === 'radio') && (
                      <Select
                        value={(answers[q.id] as string) || ''}
                        onValueChange={(v) => setAnswer(q.id, v)}
                      >
                        <SelectTrigger><SelectValue placeholder="Pick one" /></SelectTrigger>
                        <SelectContent>
                          {(q.options || []).map((o) => (
                            <SelectItem key={o.value} value={o.value}>{o.value}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="text-xs text-muted-foreground pt-2">Discount is locked once a registration is created — change via the database if needed.</div>
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
