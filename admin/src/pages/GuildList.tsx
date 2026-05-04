import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Check, X, ChevronDown } from 'lucide-react';
import DataTable, { Column } from '@/components/DataTable';
import MobileCardList, { CardField } from '@/components/MobileCardList';
import { StatusBadge } from '@/components/StatusBadge';
import { PhoneCell } from '@/components/PhoneCell';
import { BulkActionBar, type BulkAction } from '@/components/BulkActionBar';
import { BulkConfirmDialog } from '@/components/BulkConfirmDialog';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { fetchAdmin, showApiError } from '@/lib/api';
import { listViews, saveView, deleteView, getView } from '@/lib/savedViews';
import { toast } from 'sonner';
import type { GuildMember } from '@/lib/types';

const TIER_DAYS: Record<string, number> = { initiate: 90, adventurer: 180, guildmaster: 365 };
const PAGE_KEY = 'guild';
const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '';

export default function GuildList() {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') || '';
  const tier = params.get('tier') || '';
  const [members, setMembers] = useState<GuildMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmTarget, setConfirmTarget] = useState<GuildMember | null>(null);
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkPaidOpen, setBulkPaidOpen] = useState(false);
  const [bulkPaidStartDate, setBulkPaidStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [bulkCancelOpen, setBulkCancelOpen] = useState(false);
  const [viewsVersion, setViewsVersion] = useState(0);
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

  // ---- Bulk operations ----
  const selectedRows = useMemo(() => members.filter((m) => selectedIds.includes(m.id)), [members, selectedIds]);

  async function bulkMarkPaid() {
    const rows = [...selectedRows];
    if (rows.length === 0) return;
    const start = new Date(bulkPaidStartDate);
    const results = await Promise.allSettled(
      rows.map((m) => {
        const days = TIER_DAYS[m.tier] ?? 90;
        const expires = new Date(start);
        expires.setDate(start.getDate() + days);
        return fetchAdmin(`/api/admin/guild-members/${m.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            status: 'paid',
            starts_at: bulkPaidStartDate,
            expires_at: expires.toISOString().slice(0, 10),
          }),
        });
      }),
    );
    const failed = results.filter((r) => r.status === 'rejected');
    if (failed.length === 0) {
      toast.success(`Marked ${rows.length} as paid`);
    } else {
      const firstError = (failed[0] as PromiseRejectedResult).reason;
      showApiError(firstError);
    }
    setSelectedIds([]);
    refresh();
  }

  async function bulkMarkCancelled() {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    const results = await Promise.allSettled(
      ids.map((id) =>
        fetchAdmin(`/api/admin/guild-members/${id}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: 'cancelled' }),
        }),
      ),
    );
    const failed = results.filter((r) => r.status === 'rejected');
    if (failed.length === 0) {
      toast.success(`Marked ${ids.length} as cancelled`);
    } else {
      const firstError = (failed[0] as PromiseRejectedResult).reason;
      showApiError(firstError);
    }
    setSelectedIds([]);
    refresh();
  }

  function bulkExportCsv() {
    if (selectedIds.length === 0) return;
    window.location.href = `${API_BASE}/api/admin/guild-members/export?ids=${encodeURIComponent(selectedIds.join(','))}`;
  }

  async function bulkRenewalReminder() {
    if (selectedRows.length === 0) return;
    const phones = selectedRows.map((m) => m.user_phone).join(', ');
    const message = "Hi! This is a friendly reminder from Board Game Company that your Guild membership is up for renewal. Reply if you'd like to renew.";
    const payload = `${phones}\n\n${message}`;
    try {
      await navigator.clipboard.writeText(payload);
      toast.success(`Copied ${selectedRows.length} phones + reminder to clipboard`);
    } catch {
      toast.error('Could not copy to clipboard');
    }
  }

  const bulkActions: BulkAction[] = [
    { label: 'Mark paid', onClick: () => setBulkPaidOpen(true) },
    { label: 'Mark cancelled', onClick: () => setBulkCancelOpen(true), destructive: true },
    { label: 'Export CSV', onClick: bulkExportCsv },
    { label: 'Send renewal reminder', onClick: bulkRenewalReminder },
  ];

  const columns: Column<GuildMember>[] = [
    {
      key: 'name', header: 'Name', render: (m) => m.user_name || '—',
      sortable: true, sortValue: (m) => (m.user_name ?? '').toLowerCase(),
    },
    { key: 'phone', header: 'Phone', render: (m) => <PhoneCell phone={m.user_phone} /> },
    {
      key: 'tier', header: 'Tier', render: (m) => m.tier,
      sortable: true, sortValue: (m) => m.tier,
    },
    {
      key: 'expires', header: 'Expires', render: (m) => m.expires_at,
      sortable: true, sortValue: (m) => m.expires_at ?? '',
    },
    {
      key: 'status', header: 'Status', render: (m) => <StatusBadge status={m.status} />,
      sortable: true, sortValue: (m) => m.status,
    },
  ];

  const fields: CardField<GuildMember>[] = [
    { key: 'name', render: (m) => m.user_name || '—', primary: true },
    { key: 'tier', render: (m) => `${m.tier} · expires ${m.expires_at}` },
    { key: 'phone', render: (m) => <PhoneCell phone={m.user_phone} /> },
  ];

  const isPendingFilter = status === 'pending';

  // ---- Saved views ----
  const savedViews = useMemo(() => listViews(PAGE_KEY), [viewsVersion]);

  function applySavedView(name: string) {
    const v = getView(PAGE_KEY, name);
    if (!v) return;
    setParams(new URLSearchParams(v.params));
  }

  function handleSaveView() {
    const name = window.prompt('Name this view')?.trim();
    if (!name) return;
    saveView(PAGE_KEY, name, Object.fromEntries(params.entries()));
    setViewsVersion((n) => n + 1);
    toast.success(`Saved view "${name}"`);
  }

  function handleDeleteView() {
    const name = window.prompt('Delete saved view (enter name)')?.trim();
    if (!name) return;
    deleteView(PAGE_KEY, name);
    setViewsVersion((n) => n + 1);
    toast.success(`Deleted view "${name}"`);
  }

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
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="hidden md:inline-flex">
              Saved views <ChevronDown className="ml-1 h-3 w-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {savedViews.length === 0 ? (
              <DropdownMenuItem disabled>No saved views</DropdownMenuItem>
            ) : (
              savedViews.map((v) => (
                <DropdownMenuItem key={v.name} onClick={() => applySavedView(v.name)}>
                  {v.name}
                </DropdownMenuItem>
              ))
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleSaveView}>Save this view…</DropdownMenuItem>
            <DropdownMenuItem onClick={handleDeleteView}>Delete saved view…</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
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
            <BulkActionBar
              count={selectedIds.length}
              actions={bulkActions}
              onClear={() => setSelectedIds([])}
            />
            <DataTable
              rows={members}
              columns={columns}
              rowKey={(m) => m.id}
              onRowClick={(m) => navigate(`/guild/${m.id}`)}
              emptyMessage="No guild members match."
              selectable
              selectedIds={selectedIds}
              onSelectedIdsChange={setSelectedIds}
            />
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

      <Dialog open={bulkPaidOpen} onOpenChange={(o) => { if (!o) setBulkPaidOpen(false); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark {selectedIds.length} member{selectedIds.length === 1 ? '' : 's'} as paid</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Start date</Label>
            <Input type="date" value={bulkPaidStartDate} onChange={(e) => setBulkPaidStartDate(e.target.value)} />
            <div className="text-xs text-muted-foreground">
              Each member's expiry is calculated from their tier (initiate 90d, adventurer 180d, guildmaster 365d).
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setBulkPaidOpen(false)}>Cancel</Button>
            <Button onClick={() => { setBulkPaidOpen(false); bulkMarkPaid(); }}>Confirm</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <BulkConfirmDialog
        open={bulkCancelOpen}
        title="Cancel memberships?"
        count={selectedIds.length}
        sampleNames={selectedRows.slice(0, 3).map((m) => m.user_name || '—')}
        confirmLabel={`Cancel ${selectedIds.length}`}
        onConfirm={() => {
          setBulkCancelOpen(false);
          bulkMarkCancelled();
        }}
        onCancel={() => setBulkCancelOpen(false)}
      />
    </div>
  );
}
