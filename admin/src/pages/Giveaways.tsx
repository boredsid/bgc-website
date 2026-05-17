import { useEffect, useMemo, useState } from 'react';
import { fetchAdmin, ApiError, showApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';

interface PromoUser {
  id: string;
  name: string | null;
  phone: string;
  email: string | null;
}

interface Giveaway {
  id: string;
  user_id: string;
  remaining_uses: number;
  max_event_price: number;
  expires_at: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  user: PromoUser | null;
}

function cleanPhone(raw: string): string {
  return raw.replace(/[\s\-()]/g, '').replace(/^\+?91/, '');
}

function isInactive(g: Giveaway): boolean {
  if (g.remaining_uses <= 0) return true;
  if (g.expires_at && new Date(g.expires_at) < new Date(new Date().toDateString())) return true;
  return false;
}

export default function Giveaways() {
  const [giveaways, setGiveaways] = useState<Giveaway[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(false);

  const [grantOpen, setGrantOpen] = useState(false);
  const [phoneQuery, setPhoneQuery] = useState('');
  const [matchedUser, setMatchedUser] = useState<PromoUser | null>(null);
  const [lookupChecked, setLookupChecked] = useState(false);
  const [lookingUp, setLookingUp] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [remainingUses, setRemainingUses] = useState('1');
  const [maxEventPrice, setMaxEventPrice] = useState('500');
  const [expiresAt, setExpiresAt] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const cleanedPhone = cleanPhone(phoneQuery);
  const phoneValid = /^\d{10}$/.test(cleanedPhone);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const p = new URLSearchParams();
      if (showInactive) p.set('include_inactive', '1');
      const data = await fetchAdmin<{ promos: Giveaway[] }>(`/api/admin/promos?${p}`);
      setGiveaways(data.promos);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [showInactive]);

  async function lookupPhone() {
    if (!phoneValid) {
      toast.error('Enter a valid 10-digit phone');
      return;
    }
    setLookingUp(true);
    try {
      const data = await fetchAdmin<{ users: PromoUser[] }>(`/api/admin/users?q=${cleanedPhone}`);
      const match = data.users.find((u) => u.phone === cleanedPhone) || null;
      setMatchedUser(match);
      setLookupChecked(true);
    } catch (e) {
      showApiError(e);
    } finally {
      setLookingUp(false);
    }
  }

  function resetGrantForm() {
    setPhoneQuery('');
    setMatchedUser(null);
    setLookupChecked(false);
    setNewName('');
    setNewEmail('');
    setRemainingUses('1');
    setMaxEventPrice('500');
    setExpiresAt('');
    setNotes('');
  }

  const needsNewUserDetails = lookupChecked && !matchedUser && phoneValid;
  const canGrant =
    phoneValid && (matchedUser !== null ? true : (lookupChecked && newName.trim().length > 0));

  async function grant() {
    if (!phoneValid) {
      toast.error('Enter a valid 10-digit phone');
      return;
    }
    if (!lookupChecked) {
      toast.error('Tap "Find user" first');
      return;
    }
    if (!matchedUser && !newName.trim()) {
      toast.error('Name is required for a new user');
      return;
    }
    const uses = parseInt(remainingUses, 10);
    const cap = parseInt(maxEventPrice, 10);
    if (!Number.isInteger(uses) || uses < 1) {
      toast.error('Uses must be at least 1');
      return;
    }
    if (!Number.isInteger(cap) || cap < 0) {
      toast.error('Max event price must be 0 or higher');
      return;
    }
    setSaving(true);
    try {
      await fetchAdmin('/api/admin/promos', {
        method: 'POST',
        body: JSON.stringify({
          phone: cleanedPhone,
          name: matchedUser ? undefined : newName.trim(),
          email: matchedUser ? undefined : (newEmail.trim() || undefined),
          remaining_uses: uses,
          max_event_price: cap,
          expires_at: expiresAt || null,
          notes: notes.trim() || null,
        }),
      });
      toast.success(`Giveaway granted to ${matchedUser?.name || newName.trim() || cleanedPhone}`);
      resetGrantForm();
      setGrantOpen(false);
      load();
    } catch (e) {
      showApiError(e);
    } finally {
      setSaving(false);
    }
  }

  async function revoke(g: Giveaway) {
    if (!confirm(`Delete giveaway for ${g.user?.name || g.user?.phone}?`)) return;
    try {
      await fetchAdmin(`/api/admin/promos/${g.id}`, { method: 'DELETE' });
      toast.success('Giveaway deleted');
      load();
    } catch (e) {
      showApiError(e);
    }
  }

  const filtered = useMemo(() => giveaways, [giveaways]);

  return (
    <div className="p-4 space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <h1 className="text-2xl font-heading font-semibold">Giveaways</h1>
        <p className="text-sm text-muted-foreground">Grant free registrations to specific users.</p>
        <Button className="ml-auto" onClick={() => setGrantOpen((v) => !v)}>
          {grantOpen ? 'Close' : 'Grant giveaway'}
        </Button>
      </div>

      {grantOpen && (
        <div className="rounded border p-4 space-y-3 bg-muted/30">
          <div className="space-y-2">
            <Label>Phone</Label>
            <div className="flex gap-2">
              <Input
                value={phoneQuery}
                onChange={(e) => {
                  setPhoneQuery(e.target.value);
                  setLookupChecked(false);
                  setMatchedUser(null);
                }}
                placeholder="10-digit phone"
                inputMode="numeric"
              />
              <Button type="button" variant="outline" onClick={lookupPhone} disabled={lookingUp || !phoneValid}>
                {lookingUp ? 'Looking…' : 'Find user'}
              </Button>
            </div>
            {lookupChecked && matchedUser && (
              <div className="text-sm">
                Granting to{' '}
                <strong>{matchedUser.name || '(no name)'}</strong>{' '}
                <span className="text-muted-foreground">· {matchedUser.phone}</span>
              </div>
            )}
            {needsNewUserDetails && (
              <div className="space-y-3 rounded border p-3 bg-background">
                <div className="text-sm text-muted-foreground">
                  No existing user with this phone. Add their details — they'll be linked when they register.
                </div>
                <div>
                  <Label>Name (required)</Label>
                  <Input
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="Recipient's name"
                  />
                </div>
                <div>
                  <Label>Email (optional)</Label>
                  <Input
                    type="email"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    placeholder="name@example.com"
                  />
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Free registrations</Label>
              <Input
                type="number"
                value={remainingUses}
                onChange={(e) => setRemainingUses(e.target.value)}
                inputMode="numeric"
                min="1"
              />
            </div>
            <div>
              <Label>Max event price (₹)</Label>
              <Input
                type="number"
                value={maxEventPrice}
                onChange={(e) => setMaxEventPrice(e.target.value)}
                inputMode="numeric"
                min="0"
              />
            </div>
          </div>

          <div>
            <Label>Expires on (optional)</Label>
            <Input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
          </div>

          <div>
            <Label>Notes (optional, for your reference)</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Instagram giveaway winner — Aug 2026"
              maxLength={500}
            />
          </div>

          <Button onClick={grant} disabled={saving || !canGrant}>
            {saving ? 'Saving…' : 'Grant giveaway'}
          </Button>
        </div>
      )}

      <div className="flex items-center gap-2">
        <Switch id="inactive" checked={showInactive} onCheckedChange={setShowInactive} />
        <Label htmlFor="inactive">Show expired / exhausted</Label>
      </div>

      {loading && <div className="text-sm text-muted-foreground">Loading…</div>}
      {error && <div className="text-sm text-destructive">{error}</div>}

      {!loading && filtered.length === 0 && (
        <div className="text-sm text-muted-foreground">No giveaways to show.</div>
      )}

      {!loading && filtered.length > 0 && (
        <div className="overflow-x-auto rounded border">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr className="text-left">
                <th className="p-2">User</th>
                <th className="p-2">Phone</th>
                <th className="p-2">Uses</th>
                <th className="p-2">Cap (₹)</th>
                <th className="p-2">Expires</th>
                <th className="p-2">Notes</th>
                <th className="p-2">Granted</th>
                <th className="p-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((g) => (
                <tr key={g.id} className="border-t">
                  <td className="p-2">{g.user?.name || '—'}</td>
                  <td className="p-2 whitespace-nowrap">{g.user?.phone || '—'}</td>
                  <td className="p-2">
                    {g.remaining_uses}
                    {isInactive(g) && <Badge className="ml-2" variant="secondary">inactive</Badge>}
                  </td>
                  <td className="p-2">₹{g.max_event_price}</td>
                  <td className="p-2 whitespace-nowrap">{g.expires_at || 'never'}</td>
                  <td className="p-2 max-w-xs truncate" title={g.notes || ''}>{g.notes || '—'}</td>
                  <td className="p-2 whitespace-nowrap text-xs text-muted-foreground">
                    {new Date(g.created_at).toLocaleDateString()}
                    {g.created_by ? ` · ${g.created_by}` : ''}
                  </td>
                  <td className="p-2 text-right">
                    <Button variant="ghost" size="sm" onClick={() => revoke(g)}>Delete</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
