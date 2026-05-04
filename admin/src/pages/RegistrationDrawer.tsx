import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { FormDrawer } from '@/components/FormDrawer';
import { NumberInput } from '@/components/NumberInput';
import { fetchAdmin, showApiError } from '@/lib/api';
import { validateRegistration, type ValidationErrors } from '@/lib/validation';
import { toast } from 'sonner';
import type { Registration, Event, CustomQuestion } from '@/lib/types';

export default function RegistrationDrawer() {
  const navigate = useNavigate();
  const { id } = useParams();
  const [reg, setReg] = useState<Registration | null>(null);
  const [initial, setInitial] = useState<Registration | null>(null);
  const [event, setEvent] = useState<Event | null>(null);
  const [saving, setSaving] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

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

  const errors: ValidationErrors = useMemo(() => {
    if (!reg) return {};
    return validateRegistration({
      name: reg.name,
      phone: reg.phone,
      email: reg.email,
      seats: reg.seats,
      total_amount: reg.total_amount,
      payment_status: reg.payment_status,
    });
  }, [reg]);
  const errorCount = Object.keys(errors).length;
  const dirty = useMemo(() => JSON.stringify(reg) !== JSON.stringify(initial), [reg, initial]);

  function close() { navigate(-1); }

  async function save() {
    if (!reg) return;
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
      await fetchAdmin(`/api/admin/registrations/${reg.id}`, {
        method: 'PATCH',
        body: JSON.stringify(reg),
      });
      toast.success('Registration updated');
      navigate(-1);
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Something went wrong.');
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

  const customQuestions: CustomQuestion[] = (event?.custom_questions || []) as CustomQuestion[];
  const answers = reg?.custom_answers || {};

  return (
    <FormDrawer
      open
      title="Edit registration"
      dirty={dirty}
      saving={saving}
      onCancel={close}
      onSave={save}
      errorCount={showErrors ? errorCount : 0}
      errorMessage={serverError}
    >
      {!reg ? <p>Loading…</p> : (
        <div className="space-y-3">
          {field('name', 'Name', (
            <Input value={reg.name} onChange={(e) => set('name', e.target.value)} />
          ))}
          {field('phone', 'Phone', (
            <Input value={reg.phone} onChange={(e) => set('phone', e.target.value)} />
          ))}
          {field('email', 'Email', (
            <Input value={reg.email || ''} onChange={(e) => set('email', e.target.value)} />
          ))}
          {field('seats', 'Seats', (
            <NumberInput
              value={reg.seats}
              onChange={(n) => set('seats', n ?? 1)}
              aria-label="Seats"
            />
          ))}
          {field('total_amount', 'Total amount (₹)', (
            <NumberInput
              value={reg.total_amount}
              onChange={(n) => set('total_amount', n ?? 0)}
              allowRupees
              aria-label="Total amount"
            />
          ))}
          {field('payment_status', 'Payment status', (
            <Select value={reg.payment_status} onValueChange={(v) => set('payment_status', v as Registration['payment_status'])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="confirmed">Confirmed</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
          ))}
          {field('source', 'Source', (
            <Input value={reg.source || ''} onChange={(e) => set('source', e.target.value || null)} />
          ))}

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
        </div>
      )}
    </FormDrawer>
  );
}
