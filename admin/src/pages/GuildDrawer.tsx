import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { fetchAdmin, showApiError } from '@/lib/api';
import { toast } from 'sonner';
import type { GuildMember } from '@/lib/types';

export default function GuildDrawer() {
  const navigate = useNavigate();
  const { id } = useParams();
  const [m, setM] = useState<GuildMember | null>(null);
  const [initial, setInitial] = useState<GuildMember | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!id) return;
    fetchAdmin<{ member: GuildMember }>(`/api/admin/guild-members/${id}`)
      .then((r) => { setM(r.member); setInitial(r.member); })
      .catch(showApiError);
  }, [id]);

  const dirty = useMemo(() => JSON.stringify(m) !== JSON.stringify(initial), [m, initial]);

  function close() {
    if (dirty && !confirm('Discard changes?')) return;
    navigate('/guild');
  }

  async function save() {
    if (!m) return;
    setSaving(true);
    try {
      const payload = {
        tier: m.tier, amount: m.amount, status: m.status,
        starts_at: m.starts_at, expires_at: m.expires_at,
        plus_ones_used: m.plus_ones_used, source: m.source,
      };
      await fetchAdmin(`/api/admin/guild-members/${m.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
      toast.success('Guild member updated');
      navigate('/guild');
    } catch (e) {
      showApiError(e);
    } finally {
      setSaving(false);
    }
  }

  function set<K extends keyof GuildMember>(k: K, v: GuildMember[K]) {
    setM((x) => x ? { ...x, [k]: v } : x);
  }

  return (
    <Sheet open onOpenChange={(o) => { if (!o) close(); }}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Edit guild member</SheetTitle>
        </SheetHeader>
        {!m ? <p className="p-4">Loading…</p> : (
          <div className="space-y-3 p-4">
            <div className="rounded-md bg-muted/40 p-3 text-sm">
              <div><span className="text-muted-foreground">Name:</span> {m.user_name || '—'}</div>
              <div><span className="text-muted-foreground">Phone:</span> {m.user_phone}</div>
              <div><span className="text-muted-foreground">Email:</span> {m.user_email || '—'}</div>
              <Link to={`/guild/${m.id}/user`} className="text-xs underline mt-1 inline-block">Edit user details</Link>
            </div>
            <div>
              <Label>Tier</Label>
              <Select value={m.tier} onValueChange={(v) => set('tier', v as GuildMember['tier'])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="initiate">Initiate</SelectItem>
                  <SelectItem value="adventurer">Adventurer</SelectItem>
                  <SelectItem value="guildmaster">Guildmaster</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Status</Label>
              <Select value={m.status} onValueChange={(v) => set('status', v as GuildMember['status'])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="paid">Paid</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Starts at</Label><Input type="date" value={m.starts_at} onChange={(e) => set('starts_at', e.target.value)} /></div>
              <div><Label>Expires at</Label><Input type="date" value={m.expires_at} onChange={(e) => set('expires_at', e.target.value)} /></div>
              <div><Label>Amount (₹)</Label><Input type="number" value={m.amount} onChange={(e) => set('amount', Number(e.target.value))} /></div>
              <div><Label>Plus-ones used</Label><Input type="number" value={m.plus_ones_used} onChange={(e) => set('plus_ones_used', Number(e.target.value))} /></div>
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
