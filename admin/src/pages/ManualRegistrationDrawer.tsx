import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { FormDrawer } from '@/components/FormDrawer';
import { NumberInput } from '@/components/NumberInput';
import { fetchAdmin, showApiError } from '@/lib/api';
import { validateManualRegistration, type ValidationErrors } from '@/lib/validation';
import { toast } from 'sonner';
import type { Event, CustomQuestion } from '@/lib/types';

interface PhoneLookup {
  user: { found: boolean; name: string | null; email: string | null };
  membership: { isMember: boolean; tier: string | null; discount: string | null; plus_ones_remaining: number };
  existing_seats_for_event: number;
}

const LAST_EVENT_KEY = 'admin.manualReg.lastEventId';

export default function ManualRegistrationDrawer() {
  const navigate = useNavigate();
  const [events, setEvents] = useState<Event[]>([]);
  const [eventId, setEventId] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [seats, setSeats] = useState<number | null>(1);
  const [paymentStatus, setPaymentStatus] = useState<'pending' | 'confirmed'>('confirmed');
  const [customAnswers, setCustomAnswers] = useState<Record<string, string | boolean>>({});
  const [lookup, setLookup] = useState<PhoneLookup | null>(null);
  const [saving, setSaving] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    fetchAdmin<{ events: Event[] }>('/api/admin/events')
      .then((r) => {
        setEvents(r.events);
        const remembered = typeof window !== 'undefined' ? localStorage.getItem(LAST_EVENT_KEY) : null;
        if (remembered && r.events.some((e) => e.id === remembered)) {
          setEventId(remembered);
          return;
        }
        const upcoming = r.events
          .filter((e) => Date.parse(e.date) >= Date.now())
          .sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
        if (upcoming[0]) setEventId(upcoming[0].id);
      })
      .catch(showApiError);
  }, []);

  const event = events.find((e) => e.id === eventId);
  const customQuestions: CustomQuestion[] = (event?.custom_questions || []) as CustomQuestion[];

  const errors: ValidationErrors = useMemo(
    () => validateManualRegistration({ event_id: eventId, name, phone, email, seats: seats ?? 0 }),
    [eventId, name, phone, email, seats],
  );
  const errorCount = Object.keys(errors).length;

  const dirty =
    name !== '' || phone !== '' || email !== '' || Object.keys(customAnswers).length > 0;

  function pickEvent(v: string) {
    setEventId(v);
    if (v && typeof window !== 'undefined') localStorage.setItem(LAST_EVENT_KEY, v);
  }

  async function onPhoneBlur() {
    if (!phone || phone.length < 10) return;
    try {
      const r = await fetchAdmin<PhoneLookup>('/api/admin/lookup-phone', {
        method: 'POST',
        body: JSON.stringify({ phone, event_id: eventId }),
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
      await fetchAdmin('/api/admin/registrations/manual', {
        method: 'POST',
        body: JSON.stringify({
          event_id: eventId,
          name,
          phone,
          email,
          seats: seats ?? 1,
          payment_status: paymentStatus,
          custom_answers: customAnswers,
        }),
      });
      toast.success('Registration created');
      navigate('/registrations');
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setSaving(false);
    }
  }

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
      title="New manual registration"
      dirty={dirty}
      saving={saving}
      onCancel={close}
      onSave={save}
      errorCount={showErrors ? errorCount : 0}
      errorMessage={serverError}
    >
      <div className="space-y-3">
        {field('event_id', 'Event', (
          <Select value={eventId} onValueChange={pickEvent}>
            <SelectTrigger><SelectValue placeholder="Pick an event" /></SelectTrigger>
            <SelectContent>
              {events.map((e) => (
                <SelectItem key={e.id} value={e.id}>
                  {e.name} — {new Date(e.date).toLocaleDateString()}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ))}
        {field('phone', 'Phone', (
          <Input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            onBlur={onPhoneBlur}
            placeholder="10-digit number"
          />
        ))}
        {lookup && lookup.membership.isMember && (
          <div className="text-xs rounded-md bg-emerald-50 text-emerald-900 p-2">
            Active {lookup.membership.tier} member · {lookup.membership.plus_ones_remaining} plus-ones remaining
          </div>
        )}
        {field('name', 'Name', (
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        ))}
        {field('email', 'Email (optional)', (
          <Input value={email} onChange={(e) => setEmail(e.target.value)} />
        ))}
        {field('seats', 'Seats', (
          <NumberInput
            value={seats}
            onChange={(n) => setSeats(n ?? 1)}
            min={1}
            aria-label="Seats"
          />
        ))}
        {field('payment_status', 'Payment status', (
          <Select value={paymentStatus} onValueChange={(v) => setPaymentStatus(v as 'pending' | 'confirmed')}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="confirmed">Confirmed (already paid)</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
            </SelectContent>
          </Select>
        ))}

        {customQuestions.length > 0 && (
          <div className="space-y-2 pt-2 border-t">
            <div className="text-sm font-medium">Custom questions</div>
            {customQuestions.map((q) => (
              <div key={q.id}>
                <Label>{q.label}{q.required && ' *'}</Label>
                {q.type === 'text' && (
                  <Input
                    value={(customAnswers[q.id] as string) || ''}
                    onChange={(e) => setCustomAnswers({ ...customAnswers, [q.id]: e.target.value })}
                  />
                )}
                {q.type === 'checkbox' && (
                  <div className="flex items-center gap-2 mt-1">
                    <Checkbox
                      checked={!!customAnswers[q.id]}
                      onCheckedChange={(c) => setCustomAnswers({ ...customAnswers, [q.id]: !!c })}
                    />
                    <span className="text-sm">Yes</span>
                  </div>
                )}
                {(q.type === 'select' || q.type === 'radio') && (
                  <Select
                    value={(customAnswers[q.id] as string) || ''}
                    onValueChange={(v) => setCustomAnswers({ ...customAnswers, [q.id]: v })}
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
      </div>
    </FormDrawer>
  );
}
