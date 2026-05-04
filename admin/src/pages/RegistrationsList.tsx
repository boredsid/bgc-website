import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus } from 'lucide-react';
import DataTable, { Column } from '@/components/DataTable';
import MobileCardList, { CardField } from '@/components/MobileCardList';
import { StatusBadge } from '@/components/StatusBadge';
import { PhoneCell } from '@/components/PhoneCell';
import { RelativeDate } from '@/components/RelativeDate';
import { ActionSheet, type ActionItem } from '@/components/ActionSheet';
import { fetchAdmin, showApiError } from '@/lib/api';
import { toast } from 'sonner';
import type { Registration, Event } from '@/lib/types';

export default function RegistrationsList() {
  const [params, setParams] = useSearchParams();
  const eventFilter = params.get('event') || '';
  const statusFilter = params.get('status') || '';
  const [regs, setRegs] = useState<Registration[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionTarget, setActionTarget] = useState<Registration | null>(null);
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

  const columns: Column<Registration>[] = [
    { key: 'name', header: 'Name', render: (r) => r.name },
    { key: 'phone', header: 'Phone', render: (r) => <PhoneCell phone={r.phone} /> },
    { key: 'event', header: 'Event', render: (r) => eventNameById[r.event_id] || '—' },
    { key: 'seats', header: 'Seats', render: (r) => r.seats },
    { key: 'total', header: 'Total', render: (r) => `₹${r.total_amount}` },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.payment_status} /> },
    { key: 'created', header: 'Created', render: (r) => <RelativeDate iso={r.created_at} /> },
  ];

  const fields: CardField<Registration>[] = [
    { key: 'name', render: (r) => r.name, primary: true },
    { key: 'event', render: (r) => eventNameById[r.event_id] || '—' },
    { key: 'phone', render: (r) => <PhoneCell phone={r.phone} /> },
    { key: 'total', render: (r) => `${r.seats} seat${r.seats === 1 ? '' : 's'} · ₹${r.total_amount}` },
  ];

  const upcoming = events.filter((e) => Date.parse(e.date) >= Date.now()).sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  const past = events.filter((e) => Date.parse(e.date) < Date.now()).sort((a, b) => Date.parse(b.date) - Date.parse(a.date));

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
            <DataTable
              rows={regs}
              columns={columns}
              rowKey={(r) => r.id}
              onRowClick={(r) => navigate(`/registrations/${r.id}${params.toString() ? '?' + params.toString() : ''}`)}
              emptyMessage="No registrations match."
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
    </div>
  );
}
