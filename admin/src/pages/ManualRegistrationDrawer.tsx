import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { fetchAdmin, showApiError } from '@/lib/api';
import { toast } from 'sonner';
import type { Event, CustomQuestion } from '@/lib/types';

interface PhoneLookup {
  user: { found: boolean; name: string | null; email: string | null };
  membership: { isMember: boolean; tier: string | null; discount: string | null; plus_ones_remaining: number };
  existing_seats_for_event: number;
}

export default function ManualRegistrationDrawer() {
  const navigate = useNavigate();
  const [events, setEvents] = useState<Event[]>([]);
  const [eventId, setEventId] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [seats, setSeats] = useState(1);
  const [paymentStatus, setPaymentStatus] = useState<'pending' | 'confirmed'>('confirmed');
  const [customAnswers, setCustomAnswers] = useState<Record<string, string | boolean>>({});
  const [lookup, setLookup] = useState<PhoneLookup | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchAdmin<{ events: Event[] }>('/api/admin/events')
      .then((r) => {
        const upcoming = r.events.filter((e) => Date.parse(e.date) >= Date.now()).sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
        setEvents(r.events);
        if (upcoming[0]) setEventId(upcoming[0].id);
      })
      .catch(showApiError);
  }, []);

  const event = events.find((e) => e.id === eventId);
  const customQuestions: CustomQuestion[] = event?.custom_questions || [];

  async function onPhoneBlur() {
    if (!phone || phone.length < 10) return;
    try {
      const r = await fetchAdmin<PhoneLookup>('/api/admin/lookup-phone', {
        method: 'POST', body: JSON.stringify({ phone, event_id: eventId }),
      });
      setLookup(r);
      if (r.user.found) {
        if (r.user.name && !name) setName(r.user.name);
        if (r.user.email && !email) setEmail(r.user.email);
      }
    } catch (e) {
      showApiError(e);
    }
  }

  function close() {
    navigate('/registrations');
  }

  async function save() {
    setSaving(true);
    try {
      await fetchAdmin('/api/admin/registrations/manual', {
        method: 'POST',
        body: JSON.stringify({ event_id: eventId, name, phone, email, seats, payment_status: paymentStatus, custom_answers: customAnswers }),
      });
      toast.success('Registration created');
      navigate('/registrations');
    } catch (e) {
      showApiError(e);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open onOpenChange={(o) => { if (!o) close(); }}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>New manual registration</SheetTitle>
        </SheetHeader>
        <div className="space-y-3 p-4">
          <div>
            <Label>Event</Label>
            <Select value={eventId} onValueChange={setEventId}>
              <SelectTrigger><SelectValue placeholder="Pick an event" /></SelectTrigger>
              <SelectContent>
                {events.map((e) => <SelectItem key={e.id} value={e.id}>{e.name} — {new Date(e.date).toLocaleDateString()}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div><Label>Phone</Label><Input value={phone} onChange={(e) => setPhone(e.target.value)} onBlur={onPhoneBlur} placeholder="10-digit number" /></div>
          {lookup && lookup.membership.isMember && (
            <div className="text-xs rounded-md bg-emerald-50 text-emerald-900 p-2">
              Active {lookup.membership.tier} member · {lookup.membership.plus_ones_remaining} plus-ones remaining
            </div>
          )}
          <div><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div><Label>Email (optional)</Label><Input value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <div><Label>Seats</Label><Input type="number" min={1} value={seats} onChange={(e) => setSeats(Number(e.target.value))} /></div>
          <div>
            <Label>Payment status</Label>
            <Select value={paymentStatus} onValueChange={(v) => setPaymentStatus(v as 'pending' | 'confirmed')}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="confirmed">Confirmed (already paid)</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {customQuestions.length > 0 && (
            <div className="space-y-2 pt-2">
              <div className="text-sm font-medium">Custom questions</div>
              {customQuestions.map((q) => (
                <div key={q.id}>
                  <Label>{q.label}{q.required && ' *'}</Label>
                  {q.type === 'text' && <Input value={(customAnswers[q.id] as string) || ''} onChange={(e) => setCustomAnswers({ ...customAnswers, [q.id]: e.target.value })} />}
                  {q.type === 'checkbox' && (
                    <div className="flex items-center gap-2 mt-1">
                      <Checkbox checked={!!customAnswers[q.id]} onCheckedChange={(c) => setCustomAnswers({ ...customAnswers, [q.id]: !!c })} />
                      <span className="text-sm">Yes</span>
                    </div>
                  )}
                  {(q.type === 'select' || q.type === 'radio') && (
                    <Select value={(customAnswers[q.id] as string) || ''} onValueChange={(v) => setCustomAnswers({ ...customAnswers, [q.id]: v })}>
                      <SelectTrigger><SelectValue placeholder="Pick one" /></SelectTrigger>
                      <SelectContent>
                        {(q.options || []).map((o) => <SelectItem key={o.value} value={o.value}>{o.value}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              ))}
            </div>
          )}
          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button variant="ghost" onClick={close} disabled={saving}>Cancel</Button>
            <Button onClick={save} disabled={saving || !eventId || !name || !phone}>{saving ? 'Saving…' : 'Create'}</Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
