import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FormDrawer } from '@/components/FormDrawer';
import { fetchAdmin, showApiError } from '@/lib/api';
import { validateUser, type ValidationErrors } from '@/lib/validation';
import { toast } from 'sonner';
import type { User, GuildMember, UserCreditEntry } from '@/lib/types';

const REASON_LABEL: Record<UserCreditEntry['reason'], string> = {
  cancellation: 'Cancellation refund',
  cancellation_reversal: 'Cancellation reversed',
  registration_use: 'Used at event registration',
  guild_use: 'Used at guild purchase',
  admin_adjustment: 'Admin adjustment',
};

export default function UserDrawer() {
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams();
  const isGuildContext = location.pathname.startsWith('/guild/');
  const guildMemberId = isGuildContext ? params.id : undefined;
  const directUserId = !isGuildContext ? params.id : undefined;

  const [user, setUser] = useState<User | null>(null);
  const [initial, setInitial] = useState<User | null>(null);
  const [creditBalance, setCreditBalance] = useState(0);
  const [credits, setCredits] = useState<UserCreditEntry[]>([]);
  const [saving, setSaving] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustAmount, setAdjustAmount] = useState('');
  const [adjustNote, setAdjustNote] = useState('');
  const [adjustSaving, setAdjustSaving] = useState(false);

  const [hostNotes, setHostNotes] = useState('');
  const [hostSaving, setHostSaving] = useState(false);
  const [removeHostOpen, setRemoveHostOpen] = useState(false);

  function loadUser(userId: string) {
    fetchAdmin<{ user: User; credit_balance: number; credits: UserCreditEntry[] }>(`/api/admin/users/${userId}`)
      .then((r) => {
        setUser(r.user);
        setInitial(r.user);
        setCreditBalance(r.credit_balance);
        setCredits(r.credits);
        setHostNotes(r.user.community_host_notes || '');
      })
      .catch(showApiError);
  }

  useEffect(() => {
    if (directUserId) {
      loadUser(directUserId);
    } else if (guildMemberId) {
      fetchAdmin<{ member: GuildMember }>(`/api/admin/guild-members/${guildMemberId}`)
        .then(({ member }) => loadUser(member.user_id))
        .catch(showApiError);
    }
  }, [guildMemberId, directUserId]);

  const errors: ValidationErrors = useMemo(() => {
    if (!user) return {};
    return validateUser({ name: user.name, phone: user.phone, email: user.email });
  }, [user]);
  const errorCount = Object.keys(errors).length;
  const dirty = useMemo(() => JSON.stringify(user) !== JSON.stringify(initial), [user, initial]);

  function close() {
    if (isGuildContext) navigate(`/guild/${guildMemberId}`);
    else navigate('/users');
  }

  async function save() {
    if (!user) return;
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
      await fetchAdmin(`/api/admin/users/${user.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: user.name || '', phone: user.phone, email: user.email }),
      });
      toast.success('User updated');
      close();
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setSaving(false);
    }
  }

  async function submitAdjust() {
    if (!user) return;
    const amt = Number(adjustAmount);
    if (!Number.isInteger(amt) || amt === 0) {
      toast.error('Enter a non-zero whole number');
      return;
    }
    if (!adjustNote.trim()) {
      toast.error('Add a note');
      return;
    }
    setAdjustSaving(true);
    try {
      await fetchAdmin(`/api/admin/users/${user.id}/credits`, {
        method: 'POST',
        body: JSON.stringify({ amount: amt, note: adjustNote.trim() }),
      });
      toast.success('Credits adjusted');
      setAdjustOpen(false);
      setAdjustAmount('');
      setAdjustNote('');
      loadUser(user.id);
    } catch (err) {
      showApiError(err);
    } finally {
      setAdjustSaving(false);
    }
  }

  async function setCommunityHost(next: boolean) {
    if (!user) return;
    setHostSaving(true);
    try {
      const r = await fetchAdmin<{ is_community_host: boolean; active_tier: string | null }>(
        `/api/admin/users/${user.id}/community-host`,
        { method: 'POST', body: JSON.stringify({ is_community_host: next, notes: hostNotes.trim() || null }) },
      );
      toast.success(
        next
          ? 'Added as a community host — free Initiate membership granted'
          : 'Removed from community hosts',
      );
      setRemoveHostOpen(false);
      // The tier the API reports back is the one actually in force, which may
      // be a paid upgrade sitting above the free Initiate floor.
      if (next && r.active_tier && r.active_tier !== 'initiate') {
        toast.info(`They keep their paid ${r.active_tier} membership — free Initiate applies once it lapses.`);
      }
      loadUser(user.id);
    } catch (err) {
      showApiError(err);
    } finally {
      setHostSaving(false);
    }
  }

  function set<K extends keyof User>(k: K, v: User[K]) {
    setUser((x) => x ? { ...x, [k]: v } : x);
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
      title="Edit user"
      dirty={dirty}
      saving={saving}
      onCancel={close}
      onSave={save}
      errorCount={showErrors ? errorCount : 0}
      errorMessage={serverError}
    >
      {!user ? <p>Loading…</p> : (
        <div className="space-y-6">
          <div className="space-y-3">
            {field('name', 'Name', (
              <Input value={user.name || ''} onChange={(e) => set('name', e.target.value)} />
            ))}
            {field('phone', 'Phone', (
              <Input value={user.phone} onChange={(e) => set('phone', e.target.value)} />
            ))}
            {field('email', 'Email', (
              <Input value={user.email || ''} onChange={(e) => set('email', e.target.value || null)} />
            ))}
          </div>

          <div className="border-t pt-4 space-y-3">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-sm font-medium">Community host</div>
                <div className="text-xs text-muted-foreground">
                  Hosts run BGC sessions for the community. They get a free Initiate
                  Guild Path membership that never expires, and can be added to events
                  as a free host seat.
                </div>
              </div>
              <Switch
                checked={!!user.is_community_host}
                disabled={hostSaving}
                aria-label="Community host"
                onCheckedChange={(checked) => {
                  if (checked) setCommunityHost(true);
                  else setRemoveHostOpen(true);
                }}
              />
            </div>

            {user.is_community_host && (
              <div className="space-y-2 rounded-md border bg-muted/30 p-3">
                <div className="text-xs text-muted-foreground">
                  Host since {user.community_host_since
                    ? new Date(user.community_host_since).toLocaleDateString()
                    : 'today'}
                </div>
                <Label>Notes (optional)</Label>
                <Textarea
                  value={hostNotes}
                  onChange={(e) => setHostNotes(e.target.value)}
                  maxLength={500}
                  placeholder="What do they usually host? e.g. Blood on the Clocktower nights"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={hostSaving || hostNotes === (user.community_host_notes || '')}
                  onClick={() => setCommunityHost(true)}
                >
                  {hostSaving ? 'Saving…' : 'Save notes'}
                </Button>
              </div>
            )}
          </div>

          <div className="border-t pt-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm text-muted-foreground">Credit balance</div>
                <div className="text-2xl font-semibold">₹{creditBalance}</div>
              </div>
              <Button type="button" variant="outline" onClick={() => setAdjustOpen((v) => !v)}>
                {adjustOpen ? 'Cancel' : 'Adjust credits'}
              </Button>
            </div>

            {adjustOpen && (
              <div className="space-y-2 rounded border p-3">
                <Label>Amount (signed integer; negative deducts)</Label>
                <Input
                  type="number"
                  value={adjustAmount}
                  onChange={(e) => setAdjustAmount(e.target.value)}
                  placeholder="e.g. 200 or -100"
                />
                <Label>Note</Label>
                <Textarea value={adjustNote} onChange={(e) => setAdjustNote(e.target.value)} maxLength={500} />
                <Button type="button" onClick={submitAdjust} disabled={adjustSaving}>
                  {adjustSaving ? 'Saving…' : 'Save adjustment'}
                </Button>
              </div>
            )}

            <div className="space-y-1">
              <div className="text-sm font-medium">Credit history</div>
              {credits.length === 0 ? (
                <div className="text-sm text-muted-foreground">No credit activity yet.</div>
              ) : (
                <ul className="text-sm divide-y">
                  {credits.map((c) => (
                    <li key={c.id} className="py-2 flex justify-between gap-4">
                      <div>
                        <div className={c.amount >= 0 ? 'text-emerald-600' : 'text-destructive'}>
                          {c.amount >= 0 ? '+' : ''}₹{c.amount}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {REASON_LABEL[c.reason]}
                          {c.note ? ` · ${c.note}` : ''}
                          {c.created_by ? ` · ${c.created_by}` : ''}
                        </div>
                      </div>
                      <div className="text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(c.created_at).toLocaleDateString()}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}

      <Dialog open={removeHostOpen} onOpenChange={(o) => { if (!o) setRemoveHostOpen(false); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove {user?.name || 'this person'} from community hosts?</DialogTitle>
          </DialogHeader>
          <div className="text-sm text-muted-foreground space-y-2">
            <p>Their free Initiate membership will be cancelled, so they lose the 20% event discount unless they buy a membership.</p>
            <p>Anything they paid for stays untouched, and past host registrations aren't changed.</p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRemoveHostOpen(false)} disabled={hostSaving}>
              Keep as host
            </Button>
            <Button variant="destructive" onClick={() => setCommunityHost(false)} disabled={hostSaving}>
              {hostSaving ? 'Removing…' : 'Remove host'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </FormDrawer>
  );
}
