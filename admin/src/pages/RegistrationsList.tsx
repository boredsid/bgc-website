import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Plus, ChevronDown } from 'lucide-react';
import DataTable, { Column } from '@/components/DataTable';
import MobileCardList, { CardField } from '@/components/MobileCardList';
import { StatusBadge } from '@/components/StatusBadge';
import { PhoneCell } from '@/components/PhoneCell';
import { RelativeDate } from '@/components/RelativeDate';
import { ActionSheet, type ActionItem } from '@/components/ActionSheet';
import { BulkActionBar, type BulkAction } from '@/components/BulkActionBar';
import { BulkConfirmDialog } from '@/components/BulkConfirmDialog';
import { fetchAdmin, showApiError } from '@/lib/api';
import { listViews, saveView, deleteView, getView } from '@/lib/savedViews';
import { toast } from 'sonner';
import type { Registration, Event } from '@/lib/types';

const PAGE_KEY = 'registrations';
const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '';

export default function RegistrationsList() {
  const [params, setParams] = useSearchParams();
  const eventFilter = params.get('event') || '';
  const statusFilter = params.get('status') || '';
  const [regs, setRegs] = useState<Registration[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionTarget, setActionTarget] = useState<Registration | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [confirmCancelOpen, setConfirmCancelOpen] = useState(false);
  const [viewsVersion, setViewsVersion] = useState(0);
  const navigate = useNavigate();

  useEffect(() => {
    fetchAdmin<{ events: Event[] }>('/api/admin/events').then((r) => setEvents(r.events)).catch(showApiError);
  }, []);

  const refresh = () => {
    setLoading(true);
    const qs = new URLSearchParams();
    if (eventFilter) qs.set('event_id', eventFilter);
    if (statusFilter) qs.set('status', statusFilter);
    fetchAdmin<{ registrations: Registration[] }>(`/api/admin/registrations?${qs}`)
      .then((r) => setRegs(r.registrations))
      .catch(showApiError)
      .finally(() => setLoading(false));
  };

  useEffect(refresh, [eventFilter, statusFilter]);

  const eventNameById = useMemo(() => Object.fromEntries(events.map((e) => [e.id, e.name])), [events]);

  function setFilter(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next);
  }

  async function changeStatus(reg: Registration, status: Registration['payment_status']) {
    try {
      await fetchAdmin(`/api/admin/registrations/${reg.id}`, {
        method: 'PATCH', body: JSON.stringify({ payment_status: status }),
      });
      toast.success(`Marked ${status}`);
      refresh();
    } catch (e) { showApiError(e); }
  }

  const actionItems = (r: Registration): ActionItem[] => [
    { label: 'Mark confirmed', onClick: () => changeStatus(r, 'confirmed'), disabled: r.payment_status === 'confirmed' },
    { label: 'Mark pending', onClick: () => changeStatus(r, 'pending'), disabled: r.payment_status === 'pending' },
    { label: 'Mark cancelled', onClick: () => changeStatus(r, 'cancelled'), disabled: r.payment_status === 'cancelled', destructive: true },
    { label: 'Edit details', onClick: () => navigate(`/registrations/${r.id}`) },
    { label: 'Copy phone', onClick: () => navigator.clipboard?.writeText(r.phone) },
  ];

  // ---- Bulk operations ----
  const selectedRows = useMemo(() => regs.filter((r) => selectedIds.includes(r.id)), [regs, selectedIds]);

  async function bulkSetStatus(status: Registration['payment_status']) {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    const results = await Promise.allSettled(
      ids.map((id) =>
        fetchAdmin(`/api/admin/registrations/${id}`, {
          method: 'PATCH',
          body: JSON.stringify({ payment_status: status }),
        }),
      ),
    );
    const failed = results.filter((r) => r.status === 'rejected');
    if (failed.length === 0) {
      toast.success(`Marked ${ids.length} as ${status}`);
    } else {
      const firstError = (failed[0] as PromiseRejectedResult).reason;
      showApiError(firstError);
    }
    setSelectedIds([]);
    refresh();
  }

  function bulkExportCsv() {
    if (selectedIds.length === 0) return;
    window.location.href = `${API_BASE}/api/admin/registrations/export?ids=${encodeURIComponent(selectedIds.join(','))}`;
  }

  async function bulkWhatsappBroadcast() {
    if (selectedRows.length === 0) return;
    const phones = selectedRows.map((r) => r.phone).join(', ');
    const message = 'Hi! This is a reminder from Board Game Company about your upcoming event registration.';
    const payload = `${phones}\n\n${message}`;
    try {
      await navigator.clipboard.writeText(payload);
      toast.success(`Copied ${selectedRows.length} phones + message to clipboard`);
    } catch {
      toast.error('Could not copy to clipboard');
    }
  }

  const bulkActions: BulkAction[] = [
    { label: 'Mark confirmed', onClick: () => bulkSetStatus('confirmed') },
    { label: 'Mark cancelled', onClick: () => setConfirmCancelOpen(true), destructive: true },
    { label: 'Export CSV', onClick: bulkExportCsv },
    { label: 'WhatsApp broadcast', onClick: bulkWhatsappBroadcast },
  ];

  // ---- Inline status edit (desktop) ----
  function inlineStatus(r: Registration) {
    return (
      <div onClick={(e) => e.stopPropagation()}>
        <Select
          value={r.payment_status}
          onValueChange={async (v) => {
            const prev = r.payment_status;
            const next = v as Registration['payment_status'];
            if (next === prev) return;
            setRegs((rows) => rows.map((x) => x.id === r.id ? { ...x, payment_status: next } : x));
            try {
              await fetchAdmin(`/api/admin/registrations/${r.id}`, {
                method: 'PATCH',
                body: JSON.stringify({ payment_status: next }),
              });
            } catch (e) {
              setRegs((rows) => rows.map((x) => x.id === r.id ? { ...x, payment_status: prev } : x));
              showApiError(e);
            }
          }}
        >
          <SelectTrigger className="h-7 w-32 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="confirmed">Confirmed</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
      </div>
    );
  }

  const columns: Column<Registration>[] = [
    {
      key: 'name', header: 'Name', render: (r) => r.name,
      sortable: true, sortValue: (r) => r.name.toLowerCase(),
    },
    { key: 'phone', header: 'Phone', render: (r) => <PhoneCell phone={r.phone} /> },
    {
      key: 'event', header: 'Event', render: (r) => eventNameById[r.event_id] || '—',
      sortable: true, sortValue: (r) => eventNameById[r.event_id] ?? '',
    },
    {
      key: 'seats', header: 'Seats', render: (r) => r.seats,
      sortable: true, sortValue: (r) => r.seats,
    },
    {
      key: 'total', header: 'Total', render: (r) => `₹${r.total_amount}`,
      sortable: true, sortValue: (r) => r.total_amount,
    },
    {
      key: 'status', header: 'Status', render: (r) => inlineStatus(r),
      sortable: true, sortValue: (r) => r.payment_status,
    },
    {
      key: 'created', header: 'Created', render: (r) => <RelativeDate iso={r.created_at} />,
      sortable: true, sortValue: (r) => r.created_at,
    },
  ];

  const fields: CardField<Registration>[] = [
    { key: 'name', render: (r) => r.name, primary: true },
    { key: 'event', render: (r) => eventNameById[r.event_id] || '—' },
    { key: 'phone', render: (r) => <PhoneCell phone={r.phone} /> },
    { key: 'total', render: (r) => `${r.seats} seat${r.seats === 1 ? '' : 's'} · ₹${r.total_amount}` },
  ];

  const upcoming = events.filter((e) => Date.parse(e.date) >= Date.now()).sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  const past = events.filter((e) => Date.parse(e.date) < Date.now()).sort((a, b) => Date.parse(b.date) - Date.parse(a.date));

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
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">Registrations</h1>
        <Button asChild className="hidden md:inline-flex">
          <Link to="/registrations/new">New manual registration</Link>
        </Button>
      </div>
      <div className="flex gap-2 mb-3 flex-wrap">
        <Select value={eventFilter || 'all'} onValueChange={(v) => setFilter('event', v === 'all' ? '' : v)}>
          <SelectTrigger className="w-72"><SelectValue placeholder="All events" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All events</SelectItem>
            {upcoming.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
            {past.length > 0 && <SelectItem value="__sep" disabled>── past ──</SelectItem>}
            {past.map((e) => <SelectItem key={e.id} value={e.id}>{e.name} (past)</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={statusFilter || 'all'} onValueChange={(v) => setFilter('status', v === 'all' ? '' : v)}>
          <SelectTrigger className="w-48"><SelectValue placeholder="All statuses" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="confirmed">Confirmed</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
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
          <div className="md:hidden">
            <MobileCardList
              rows={regs}
              fields={fields}
              rowKey={(r) => r.id}
              onRowClick={(r) => setActionTarget(r)}
              emptyMessage="No registrations match these filters."
              trailing={(r) => <StatusBadge status={r.payment_status} />}
            />
          </div>
          <div className="hidden md:block">
            <BulkActionBar
              count={selectedIds.length}
              actions={bulkActions}
              onClear={() => setSelectedIds([])}
            />
            <DataTable
              rows={regs}
              columns={columns}
              rowKey={(r) => r.id}
              onRowClick={(r) => navigate(`/registrations/${r.id}${params.toString() ? '?' + params.toString() : ''}`)}
              emptyMessage="No registrations match."
              selectable
              selectedIds={selectedIds}
              onSelectedIdsChange={setSelectedIds}
            />
          </div>
        </>
      )}

      <Link
        to="/registrations/new"
        className="md:hidden fixed right-4 bottom-20 z-30 h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center"
        style={{ bottom: 'calc(5rem + env(safe-area-inset-bottom))' }}
        aria-label="New manual registration"
      >
        <Plus className="h-6 w-6" />
      </Link>

      <ActionSheet
        open={!!actionTarget}
        title={actionTarget ? `${actionTarget.name} · ${eventNameById[actionTarget.event_id] || ''}` : ''}
        actions={actionTarget ? actionItems(actionTarget) : []}
        onClose={() => setActionTarget(null)}
      />

      <BulkConfirmDialog
        open={confirmCancelOpen}
        title="Cancel registrations?"
        count={selectedIds.length}
        sampleNames={selectedRows.slice(0, 3).map((r) => r.name)}
        confirmLabel={`Cancel ${selectedIds.length}`}
        onConfirm={() => {
          setConfirmCancelOpen(false);
          bulkSetStatus('cancelled');
        }}
        onCancel={() => setConfirmCancelOpen(false)}
      />
    </div>
  );
}
