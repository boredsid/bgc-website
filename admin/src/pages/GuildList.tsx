import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Check, X } from 'lucide-react';
import DataTable, { Column } from '@/components/DataTable';
import MobileCardList, { CardField } from '@/components/MobileCardList';
import { StatusBadge } from '@/components/StatusBadge';
import { PhoneCell } from '@/components/PhoneCell';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { fetchAdmin, showApiError } from '@/lib/api';
import { toast } from 'sonner';
import type { GuildMember } from '@/lib/types';

const TIER_DAYS: Record<string, number> = { initiate: 90, adventurer: 180, guildmaster: 365 };

export default function GuildList() {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') || '';
  const tier = params.get('tier') || '';
  const [members, setMembers] = useState<GuildMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmTarget, setConfirmTarget] = useState<GuildMember | null>(null);
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const navigate = useNavigate();

  const refresh = () => {
    setLoading(true);
    const qs = new URLSearchParams();
    if (status) qs.set('status', status);
    if (tier) qs.set('tier', tier);
    fetchAdmin<{ members: GuildMember[] }>(`/api/admin/guild-members?${qs}`)
      .then((r) => setMembers(r.members))
      .catch(showApiError)
      .finally(() => setLoading(false));
  };
  useEffect(refresh, [status, tier]);

  function setFilter(k: string, v: string) {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v); else next.delete(k);
    setParams(next);
  }

  async function markCancelled(m: GuildMember) {
    try {
      await fetchAdmin(`/api/admin/guild-members/${m.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'cancelled' }) });
      toast.success('Marked cancelled');
      refresh();
    } catch (e) { showApiError(e); }
  }

  async function confirmMarkPaid() {
    if (!confirmTarget) return;
    const start = new Date(startDate);
    const days = TIER_DAYS[confirmTarget.tier] ?? 90;
    const expires = new Date(start);
    expires.setDate(start.getDate() + days);
    try {
      await fetchAdmin(`/api/admin/guild-members/${confirmTarget.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: 'paid',
          starts_at: startDate,
          expires_at: expires.toISOString().slice(0, 10),
        }),
      });
      toast.success(`${confirmTarget.user_name || 'Member'} marked paid`);
      setConfirmTarget(null);
      refresh();
    } catch (e) { showApiError(e); }
  }

  const columns: Column<GuildMember>[] = [
    { key: 'name', header: 'Name', render: (m) => m.user_name || '—' },
    { key: 'phone', header: 'Phone', render: (m) => <PhoneCell phone={m.user_phone} /> },
    { key: 'tier', header: 'Tier', render: (m) => m.tier },
    { key: 'expires', header: 'Expires', render: (m) => m.expires_at },
    { key: 'status', header: 'Status', render: (m) => <StatusBadge status={m.status} /> },
  ];

  const fields: CardField<GuildMember>[] = [
    { key: 'name', render: (m) => m.user_name || '—', primary: true },
    { key: 'tier', render: (m) => `${m.tier} · expires ${m.expires_at}` },
    { key: 'phone', render: (m) => <PhoneCell phone={m.user_phone} /> },
  ];

  const isPendingFilter = status === 'pending';

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-4">Guild members</h1>
      <div className="flex gap-2 mb-3 flex-wrap">
        <Select value={status || 'all'} onValueChange={(v) => setFilter('status', v === 'all' ? '' : v)}>
          <SelectTrigger className="w-48"><SelectValue placeholder="All statuses" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="paid">Paid</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
        <Select value={tier || 'all'} onValueChange={(v) => setFilter('tier', v === 'all' ? '' : v)}>
          <SelectTrigger className="w-48"><SelectValue placeholder="All tiers" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All tiers</SelectItem>
            <SelectItem value="initiate">Initiate</SelectItem>
            <SelectItem value="adventurer">Adventurer</SelectItem>
            <SelectItem value="guildmaster">Guildmaster</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {loading ? <p>Loading…</p> : (
        <>
          <div className="md:hidden space-y-2">
            {isPendingFilter ? (
              members.length === 0 ? (
                <div className="text-sm text-muted-foreground p-4">Nothing waiting — you're caught up.</div>
              ) : members.map((m) => (
                <div key={m.id} className="rounded-md border bg-card p-3 space-y-2">
                  <div className="flex items-start justify-between">
                    <div className="min-w-0">
                      <div className="font-semibold truncate">{m.user_name || '—'}</div>
                      <div className="text-sm text-muted-foreground">{m.tier}</div>
                      <PhoneCell phone={m.user_phone} className="text-sm" />
                    </div>
                    <StatusBadge status="pending" />
                  </div>
                  <div className="flex gap-2 pt-1">
                    <Button className="flex-1" onClick={() => setConfirmTarget(m)}>
                      <Check className="h-4 w-4 mr-1" /> Mark paid
                    </Button>
                    <Button variant="destructive" className="flex-1" onClick={() => markCancelled(m)}>
                      <X className="h-4 w-4 mr-1" /> Cancel
                    </Button>
                  </div>
                </div>
              ))
            ) : (
              <MobileCardList rows={members} fields={fields} rowKey={(m) => m.id} onRowClick={(m) => navigate(`/guild/${m.id}`)} emptyMessage="No guild members match these filters." trailing={(m) => <StatusBadge status={m.status} />} />
            )}
          </div>
          <div className="hidden md:block">
            <DataTable rows={members} columns={columns} rowKey={(m) => m.id} onRowClick={(m) => navigate(`/guild/${m.id}`)} emptyMessage="No guild members match." />
          </div>
        </>
      )}

      <Dialog open={!!confirmTarget} onOpenChange={(o) => { if (!o) setConfirmTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark {confirmTarget?.user_name || 'member'} as paid</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Start date</Label>
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            <div className="text-xs text-muted-foreground">
              Expires {TIER_DAYS[confirmTarget?.tier || 'initiate']} days later (auto).
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmTarget(null)}>Cancel</Button>
            <Button onClick={confirmMarkPaid}>Confirm</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
