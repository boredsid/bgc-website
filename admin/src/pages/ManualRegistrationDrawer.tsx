import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FormDrawer } from '@/components/FormDrawer';
import { PaymentDetailsFields, type PaymentDetailsValue } from '@/components/PaymentDetailsFields';
import { NumberInput } from '@/components/NumberInput';
import { fetchAdmin, showApiError, ApiError } from '@/lib/api';
import { validateManualRegistration, type ValidationErrors } from '@/lib/validation';
import { formatEventDateLabel } from '@/lib/eventDate';
import { toast } from 'sonner';
import type { Event, CustomQuestion, FinanceAccount, FinanceCategory, CommunityHost } from '@/lib/types';
import { useWhoAmI } from '@/lib/whoami';
import { useSearchParams } from 'react-router-dom';

interface PhoneLookup {
  user: { found: boolean; name: string | null; email: string | null; is_community_host?: boolean };
  membership?: { isMember: boolean; tier: string | null; discount: string | null; plus_ones_remaining: number };
  existing_seats_for_event: number;
  replay_pass?: { has_pass: boolean; edition_name: string | null; already_claimed?: boolean } | null;
  credit_balance?: number;
}

interface ReplayPassCheck {
  has_pass: boolean;
  edition_name: string | null;
  already_claimed: boolean;
}

const LAST_EVENT_KEY = 'admin.manualReg.lastEventId';

/**
 * A seat in this booking other than the person being registered. On events that
 * are free for REPLAY pass holders, each of these numbers that holds a pass
 * makes its own seat free — the same rule the public form follows.
 */
interface Companion {
  phone: string;
  status: 'idle' | 'checking' | 'pass' | 'no_pass' | 'claimed';
  editionName: string | null;
}

/** Same 10-digit rule the Worker applies before it will look a number up. */
function phoneDigits(value: string): string | null {
  const match = value.replace(/[\s\-()]/g, '').match(/^(?:\+?91)?(\d{10})$/);
  return match ? match[1] : null;
}

function companionNote(companion: Companion): string | null {
  if (!phoneDigits(companion.phone)) {
    return companion.phone.trim() ? 'Needs a 10-digit mobile number' : null;
  }
  if (companion.status === 'checking') return 'Checking…';
  if (companion.status === 'pass') {
    return `Holds a ${companion.editionName || 'REPLAY'} pass — this seat is free.`;
  }
  if (companion.status === 'claimed') {
    return 'This pass has already covered a seat on this event — this seat pays full price.';
  }
  if (companion.status === 'no_pass') return 'No confirmed pass on this number — full price applies.';
  return null;
}

/**
 * Adding a community host is a manual registration with the money taken out, so
 * both share this drawer: same event picker, same custom questions, same
 * capacity warning. Host mode swaps the phone/name fields for a picker over the
 * roster and drops the payment section entirely.
 */
interface Props {
  mode?: 'manual' | 'host';
}

export default function ManualRegistrationDrawer({ mode = 'manual' }: Props) {
  const isHostMode = mode === 'host';
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
  const [companions, setCompanions] = useState<Companion[]>([]);
  const [saving, setSaving] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [capacityWarning, setCapacityWarning] = useState<string | null>(null);
  const [hosts, setHosts] = useState<CommunityHost[]>([]);
  const [hostId, setHostId] = useState('');
  const [financeAccounts, setFinanceAccounts] = useState<FinanceAccount[]>([]);
  const [paymentDetails, setPaymentDetails] = useState<PaymentDetailsValue>({
    payment_account_id: '',
    paid_at: new Date().toISOString().slice(0, 10),
    payment_method: 'upi',
  });
  const [initial, setInitial] = useState<{
    eventId: string;
    name: string;
    phone: string;
    email: string;
    seats: number;
    paymentStatus: 'pending' | 'confirmed';
    customAnswers: Record<string, string | boolean>;
  } | null>(null);

  const who = useWhoAmI();
  const isGuest = who?.role === 'guest';
  const guestEvents = who?.events ?? [];
  const [searchParams] = useSearchParams();

  useEffect(() => {
    if (isGuest) {
      const evts = (guestEvents as unknown as Event[]).filter((e) => !e.externally_managed);
      setEvents(evts);
      const fromUrl = searchParams.get('event');
      const startEventId = (fromUrl && evts.some((e) => e.id === fromUrl) ? fromUrl : evts[0]?.id) ?? '';
      setEventId(startEventId);
      setInitial({ eventId: startEventId, name: '', phone: '', email: '', seats: 1, paymentStatus: 'confirmed', customAnswers: {} });
      return;
    }
    fetchAdmin<{ events: Event[] }>('/api/admin/events')
      .then((r) => {
        const bgcManagedEvents = r.events.filter((e) => !e.externally_managed);
        setEvents(bgcManagedEvents);
        const remembered = typeof window !== 'undefined' ? localStorage.getItem(LAST_EVENT_KEY) : null;
        let startEventId = '';
        if (remembered && bgcManagedEvents.some((e) => e.id === remembered)) {
          startEventId = remembered;
        } else {
          // ends_at, not date: on day 2 of a three-day event, that event is
          // still the one an admin at the door wants preselected.
          const upcoming = bgcManagedEvents
            .filter((e) => Date.parse(e.ends_at ?? e.date) >= Date.now())
            .sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
          startEventId = upcoming[0]?.id ?? '';
        }
        setEventId(startEventId);
        setInitial({ eventId: startEventId, name: '', phone: '', email: '', seats: 1, paymentStatus: 'confirmed', customAnswers: {} });
      })
      .catch(showApiError);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGuest, guestEvents.length]);

  useEffect(() => {
    if (!isHostMode || isGuest) return;
    fetchAdmin<{ hosts: CommunityHost[] }>('/api/admin/community-hosts')
      .then((r) => {
        setHosts(r.hosts);
        const fromUrl = searchParams.get('host');
        const start = fromUrl && r.hosts.some((h) => h.id === fromUrl) ? fromUrl : '';
        if (start) pickHost(start, r.hosts);
      })
      .catch(showApiError);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHostMode, isGuest]);

  useEffect(() => {
    if (isGuest || isHostMode) return;
    fetchAdmin<{ accounts: FinanceAccount[]; categories: FinanceCategory[] }>('/api/admin/finance/bootstrap')
      .then((data) => {
        setFinanceAccounts(data.accounts);
        const remembered = localStorage.getItem('admin.finance.lastAccountId');
        const account = data.accounts.find((item) => item.is_active && item.id === remembered)
          || data.accounts.find((item) => item.is_active && item.is_default);
        if (account) {
          setPaymentDetails((current) => ({ ...current, payment_account_id: account.id }));
        }
      })
      .catch(showApiError);
  }, [isGuest, isHostMode]);

  const event = events.find((e) => e.id === eventId);
  const customQuestions: CustomQuestion[] = (event?.custom_questions || []) as CustomQuestion[];

  const wantsCompanions = !isHostMode && !!event?.replay_pass_free;

  useEffect(() => {
    const wanted = wantsCompanions ? Math.max(0, (seats ?? 1) - 1) : 0;
    setCompanions((prev) => {
      if (prev.length === wanted) return prev;
      if (prev.length > wanted) return prev.slice(0, wanted);
      return [
        ...prev,
        ...Array.from({ length: wanted - prev.length }, () => ({
          phone: '', status: 'idle' as const, editionName: null,
        })),
      ];
    });
  }, [seats, wantsCompanions]);

  async function checkCompanion(index: number) {
    const digits = phoneDigits(companions[index]?.phone || '');
    if (!digits || !eventId) return;
    setCompanions((prev) => prev.map((c, i) => (i === index ? { ...c, status: 'checking' } : c)));
    try {
      const r = await fetchAdmin<ReplayPassCheck>('/api/replay-pass-check', {
        method: 'POST',
        body: JSON.stringify({ phone: digits, event_id: eventId }),
      });
      setCompanions((prev) =>
        prev.map((c, i) =>
          i === index && phoneDigits(c.phone) === digits
            ? {
                ...c,
                status: r.has_pass ? (r.already_claimed ? 'claimed' : 'pass') : 'no_pass',
                editionName: r.edition_name,
              }
            : c,
        ),
      );
    } catch {
      // Same fail-closed rule as the Worker: an unreachable check costs the
      // discount, never the registration.
      setCompanions((prev) =>
        prev.map((c, i) => (i === index ? { ...c, status: 'no_pass', editionName: null } : c)),
      );
    }
  }

  // One number is one pass however many boxes it is typed into, and the person
  // being registered is counted on their own terms by the Worker.
  const companionPhones: string[] = [];
  const seenCompanionDigits = new Set<string>([phoneDigits(phone) || '']);
  for (const c of companions) {
    const digits = phoneDigits(c.phone);
    if (!digits || seenCompanionDigits.has(digits)) continue;
    seenCompanionDigits.add(digits);
    companionPhones.push(digits);
  }
  const companionsCovered = companions.filter(
    (c, i) => c.status === 'pass' && companionPhones.includes(phoneDigits(c.phone) || `x${i}`),
  ).length;

  const errors: ValidationErrors = useMemo(() => {
    const base = validateManualRegistration({ event_id: eventId, name, phone, email, seats: seats ?? 0 });
    if (!isHostMode) return base;

    // In host mode the person is chosen from the roster, so surface a missing
    // pick rather than the phone/name errors that come from an empty form.
    const out: ValidationErrors = { event_id: base.event_id, seats: base.seats };
    if (!hostId) out.host_id = 'Please pick a community host.';
    // The worker rejects unanswered required questions; catch it here first so
    // the admin sees which one, inline, instead of a server error.
    for (const q of customQuestions) {
      if (!q.required) continue;
      const a = customAnswers[q.id];
      const answered = typeof a === 'boolean' ? a : a !== undefined && String(a ?? '').trim() !== '';
      if (!answered) out[`cq_${q.id}`] = `Please answer "${q.label}".`;
    }
    for (const k of Object.keys(out)) if (!out[k]) delete out[k];
    return out;
  }, [eventId, name, phone, email, seats, isHostMode, hostId, customQuestions, customAnswers]);
  const errorCount = Object.keys(errors).length;

  const dirty =
    !!initial && (
      initial.eventId !== eventId ||
      initial.name !== name ||
      initial.phone !== phone ||
      initial.email !== email ||
      initial.seats !== (seats ?? 0) ||
      initial.paymentStatus !== paymentStatus ||
      JSON.stringify(initial.customAnswers) !== JSON.stringify(customAnswers)
    );

  // Picking a host fills the name/phone/email the API still expects, so host
  // mode needs no typing at all beyond the event's own questions.
  function pickHost(id: string, roster: CommunityHost[] = hosts) {
    const host = roster.find((h) => h.id === id);
    setHostId(id);
    setName(host?.name || '');
    setPhone(host?.phone || '');
    setEmail(host?.email || '');
  }

  function pickEvent(v: string) {
    setEventId(v);
    if (v && typeof window !== 'undefined') localStorage.setItem(LAST_EVENT_KEY, v);
    setInitial((prev) => (prev ? { ...prev, eventId: v } : prev));
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

  function save() {
    setShowErrors(true);
    if (errorCount > 0) {
      const first = Object.keys(errors)[0];
      const el = document.getElementById(`field-${first}`);
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el?.focus();
      return;
    }
    submit(false);
  }

  async function submit(allowOverbook: boolean) {
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
          payment_status: isHostMode ? 'confirmed' : paymentStatus,
          custom_answers: customAnswers,
          allow_overbook: allowOverbook,
          ...(companionPhones.length > 0 ? { companion_phones: companionPhones } : {}),
          ...(isHostMode ? { is_community_host: true } : {}),
          ...(!isHostMode && paymentStatus === 'confirmed' && !isGuest ? paymentDetails : {}),
        }),
      });
      setCapacityWarning(null);
      toast.success(isHostMode ? 'Community host added to the event' : 'Registration created');
      navigate('/registrations');
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && (err.data as { capacity_exceeded?: boolean } | null)?.capacity_exceeded) {
        setCapacityWarning(err.message);
        return;
      }
      setServerError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setSaving(false);
    }
  }

  function field(key: string, label: string, control: React.ReactNode) {
    const err = showErrors ? errors[key] : undefined;
    return (
      <div id={`field-${key}`} key={`field-${key}`}>
        <Label className={err ? 'text-destructive' : undefined}>{label}</Label>
        {control}
        {err && <div className="text-xs text-destructive mt-1">{err}</div>}
      </div>
    );
  }

  return (
    <FormDrawer
      open
      title={isHostMode ? 'Add community host to event' : 'New manual registration'}
      dirty={dirty}
      saving={saving}
      onCancel={close}
      onSave={save}
      errorCount={showErrors ? errorCount : 0}
      errorMessage={serverError}
    >
      <div className="space-y-3">
        {field('event_id', 'Event', (
          <Select value={eventId} onValueChange={pickEvent} disabled={isGuest && guestEvents.length <= 1}>
            <SelectTrigger><SelectValue placeholder="Pick an event" /></SelectTrigger>
            <SelectContent>
              {events.map((e) => (
                <SelectItem key={e.id} value={e.id}>
                  {e.name} — {formatEventDateLabel(e)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ))}
        {isHostMode ? (
          <>
            {field('host_id', 'Community host', (
              <Select value={hostId} onValueChange={(v) => pickHost(v)}>
                <SelectTrigger><SelectValue placeholder="Pick a host" /></SelectTrigger>
                <SelectContent>
                  {hosts.map((h) => (
                    <SelectItem key={h.id} value={h.id}>
                      {h.name || h.phone}
                      {h.sessions_hosted > 0 ? ` — ${h.sessions_hosted} hosted` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ))}
            {hosts.length === 0 && (
              <div className="text-xs rounded-md bg-yellow-50 text-yellow-900 border border-yellow-200 p-2">
                No community hosts yet. Add one on the Community hosts page first.
              </div>
            )}
            {hostId && (
              <div className="text-xs rounded-md bg-emerald-50 text-emerald-900 p-2">
                Free host seat — takes {seats ?? 1} spot{(seats ?? 1) === 1 ? '' : 's'} of capacity,
                nothing to pay, and their Guild Path perks and credits stay untouched.
              </div>
            )}
          </>
        ) : field('phone', 'Phone', (
          <Input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            onBlur={onPhoneBlur}
            placeholder="10-digit number"
          />
        ))}
        {!isHostMode && lookup && lookup.membership?.isMember && (
          <div className="text-xs rounded-md bg-emerald-50 text-emerald-900 p-2">
            Active {lookup.membership.tier} member · {lookup.membership.plus_ones_remaining} plus-ones remaining
          </div>
        )}
        {!isHostMode && lookup && (lookup.credit_balance ?? 0) > 0 && (
          <div className="text-xs rounded-md bg-amber-50 text-amber-900 p-2">
            ₹{lookup.credit_balance} credit available — will auto-apply against this registration's total.
          </div>
        )}
        {!isHostMode && lookup?.replay_pass?.has_pass && (
          <div className="text-xs rounded-md bg-emerald-50 text-emerald-900 p-2">
            Holds a {lookup.replay_pass.edition_name || 'REPLAY'} pass — their own seat is free on this event.
          </div>
        )}
        {!isHostMode && lookup && event?.replay_pass_free && lookup.replay_pass?.has_pass === false && (
          <div className="text-xs rounded-md bg-muted text-muted-foreground p-2">
            No confirmed {lookup.replay_pass.edition_name || 'REPLAY'} pass for this number — full price applies.
          </div>
        )}
        {!isHostMode && lookup && !lookup.membership?.isMember && event?.guild_path_exclusive && (
          <div className="text-xs rounded-md bg-yellow-50 text-yellow-900 border border-yellow-200 p-2">
            ⚠️ This event is Guild Path Exclusive and this user isn't a current member.
            You can still register them, but consider adding them to Guild Path first.
          </div>
        )}
        {!isHostMode && field('name', 'Name', (
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        ))}
        {!isHostMode && field('email', 'Email (optional)', (
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
        {companions.length > 0 && (
          <div className="rounded-md border bg-muted/30 p-3 space-y-2">
            <div className="text-sm font-medium">Other REPLAY pass holders in this booking</div>
            <div className="text-xs text-muted-foreground">
              Add the number linked to each pass and that seat is free too. One pass covers one seat.
              Leave blank for anyone without a pass.
            </div>
            {companions.map((companion, i) => (
              <div key={i}>
                <Input
                  value={companion.phone}
                  onChange={(e) =>
                    setCompanions((prev) =>
                      prev.map((c, idx) =>
                        idx === i ? { phone: e.target.value, status: 'idle', editionName: null } : c,
                      ),
                    )
                  }
                  onBlur={() => checkCompanion(i)}
                  placeholder={`Seat ${i + 2} — 10-digit number (optional)`}
                />
                {companionNote(companion) && (
                  <div className="text-xs text-muted-foreground mt-1">{companionNote(companion)}</div>
                )}
              </div>
            ))}
            {companionsCovered > 0 && (
              <div className="text-xs rounded-md bg-emerald-50 text-emerald-900 p-2">
                {companionsCovered} companion seat{companionsCovered === 1 ? '' : 's'} covered by a REPLAY pass.
              </div>
            )}
          </div>
        )}
        {!isHostMode && field('payment_status', 'Payment status', (
          <Select value={paymentStatus} onValueChange={(v) => setPaymentStatus(v as 'pending' | 'confirmed')}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="confirmed">Confirmed (already paid)</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
            </SelectContent>
          </Select>
        ))}
        {!isHostMode && paymentStatus === 'confirmed' && !isGuest && (
          <div className="rounded-md border bg-muted/30 p-3">
            <div className="text-sm font-medium mb-2">Payment details</div>
            <PaymentDetailsFields
              accounts={financeAccounts}
              value={paymentDetails}
              onChange={(next) => {
                setPaymentDetails(next);
                if (next.payment_account_id) {
                  localStorage.setItem('admin.finance.lastAccountId', next.payment_account_id);
                }
              }}
            />
          </div>
        )}

        {customQuestions.length > 0 && (
          <div className="space-y-2 pt-2 border-t">
            <div className="text-sm font-medium">Custom questions</div>
            {customQuestions.map((q) => field(`cq_${q.id}`, `${q.label}${q.required ? ' *' : ''}`, (
              <>
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
              </>
            )))}
          </div>
        )}
      </div>

      <Dialog open={!!capacityWarning} onOpenChange={(o) => { if (!o) setCapacityWarning(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Event is full</DialogTitle>
          </DialogHeader>
          <div className="text-sm text-muted-foreground">
            {capacityWarning} You can still register them over capacity.
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCapacityWarning(null)} disabled={saving}>Cancel</Button>
            <Button onClick={() => submit(true)} disabled={saving}>
              {saving ? 'Registering…' : 'Register anyway'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </FormDrawer>
  );
}
