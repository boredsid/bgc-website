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
  price: 0, capacity: 0, custom_questions: [], price_includes: '', llm_notes: '',
  is_published: false, guild_path_exclusive: false, is_collaboration: false,
  externally_managed: false, external_registration_url: '',
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
  const [guestAdmins, setGuestAdmins] = useState<string[]>([]);
  const [guestInput, setGuestInput] = useState('');
  const [initialGuests, setInitialGuests] = useState<string[]>([]);

  useEffect(() => {
    if (mode === 'edit' && id) {
      fetchAdmin<{ event: Event }>(`/api/admin/events/${id}`)
        .then((r) => {
          setForm(r.event);
          setInitial(r.event);
          const loaded = ((r.event as Event & { guest_admins?: string[] }).guest_admins) ?? [];
          setGuestAdmins(loaded);
          setInitialGuests(loaded);
        })
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
  const dirty = useMemo(
    () => JSON.stringify(form) !== JSON.stringify(initial) || JSON.stringify(guestAdmins) !== JSON.stringify(initialGuests),
    [form, initial, guestAdmins, initialGuests],
  );

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
      const external = form.externally_managed === true;
      const payload = {
        ...form,
        date: form.date ? new Date(form.date).toISOString() : '',
        ...(external
          ? {
              capacity: 0,
              price: 0,
              custom_questions: [],
              price_includes: null,
              guild_path_exclusive: false,
              is_collaboration: false,
              external_registration_url: form.external_registration_url?.trim() || null,
            }
          : {
              custom_questions: form.custom_questions || [],
              external_registration_url: null,
            }),
        ...(mode === 'edit'
          ? { guest_admins: !external && form.is_collaboration ? guestAdmins : [] }
          : {}),
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
          <div className="flex items-start gap-2">
            <Switch
              checked={!!form.externally_managed}
              onCheckedChange={(c) => set('externally_managed', c)}
            />
            <div className="flex-1">
              <Label>Registrations managed externally</Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                A partner handles registration. BGC will list the event and send visitors to their website.
              </p>
            </div>
          </div>
          {form.externally_managed ? (
            <div className="rounded-md border p-3 space-y-2">
              {field('external_registration_url', 'Partner registration URL', (
                <Input
                  type="url"
                  inputMode="url"
                  placeholder="https://partner.example/register"
                  value={form.external_registration_url || ''}
                  onChange={(e) => set('external_registration_url', e.target.value)}
                />
              ))}
              <p className="text-xs text-muted-foreground">
                Capacity, price, Guild Path access, and custom questions are not used for this event.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {field('capacity', 'Capacity', (
                <NumberInput value={form.capacity ?? null} onChange={(n) => set('capacity', n ?? 0)} aria-label="Capacity" />
              ))}
              {field('price', 'Price (₹)', (
                <NumberInput value={form.price ?? null} onChange={(n) => set('price', n ?? 0)} allowRupees aria-label="Price" />
              ))}
            </div>
          )}
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
          {!form.externally_managed && field('price_includes', 'Price includes', (
            <Input value={form.price_includes || ''} onChange={(e) => set('price_includes', e.target.value)} />
          ))}
          {field('llm_notes', 'Notes for DM agent', (
            <Textarea
              rows={4}
              placeholder="Anything the Instagram DM agent should know that isn't in the other fields (e.g. BYOB, side-entrance for wheelchairs, kid-friendly until 8pm)."
              value={form.llm_notes || ''}
              onChange={(e) => set('llm_notes', e.target.value)}
            />
          ))}
          <div className="flex items-center gap-2">
            <Switch checked={!!form.is_published} onCheckedChange={(c) => set('is_published', c)} />
            <Label>Published</Label>
          </div>
          {!form.externally_managed && (
            <div className="flex items-start gap-2">
              <Switch
                checked={!!form.guild_path_exclusive}
                onCheckedChange={(c) => set('guild_path_exclusive', c)}
              />
              <div>
                <Label>Guild Path Exclusive</Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Only current Guild Path members can register on the public site.
                </p>
              </div>
            </div>
          )}
          {!form.externally_managed && (
            <div className="flex items-start gap-2">
              <Switch
                checked={!!form.is_collaboration}
                onCheckedChange={(c) => set('is_collaboration', c)}
              />
              <div className="flex-1">
                <Label>Collaboration event</Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Lets guest admins from a partner community manage this event's registrations only.
                  Access auto-expires 2 days after the event date.
                </p>
              </div>
            </div>
          )}
          {!form.externally_managed && form.is_collaboration && mode === 'edit' && (
            <div className="rounded-md border p-3 space-y-2">
              <Label className="block">Guest admin emails</Label>
              <div className="flex flex-wrap gap-1">
                {guestAdmins.map((email) => (
                  <span key={email} className="inline-flex items-center gap-1 text-xs bg-muted rounded px-2 py-1">
                    {email}
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => setGuestAdmins((list) => list.filter((e) => e !== email))}
                      aria-label={`Remove ${email}`}
                    >
                      ×
                    </button>
                  </span>
                ))}
                {guestAdmins.length === 0 && <span className="text-xs text-muted-foreground">No guests yet.</span>}
              </div>
              <div className="flex gap-2">
                <Input
                  value={guestInput}
                  placeholder="partner@community.in"
                  onChange={(e) => setGuestInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      const email = guestInput.trim().toLowerCase();
                      if (email.includes('@') && !guestAdmins.includes(email)) {
                        setGuestAdmins((list) => [...list, email]);
                      }
                      setGuestInput('');
                    }
                  }}
                />
              </div>
              <p className="text-xs text-muted-foreground">Press Enter to add. They log in at this admin URL with the email you list.</p>
            </div>
          )}
          {!form.externally_managed && (
            <div>
              <Label className="block mb-2">Custom questions</Label>
              <CustomQuestionsEditor
                value={form.custom_questions || []}
                onChange={(qs: CustomQuestion[]) => set('custom_questions', qs)}
              />
            </div>
          )}
        </>
      )}
    </FormDrawer>
  );
}
