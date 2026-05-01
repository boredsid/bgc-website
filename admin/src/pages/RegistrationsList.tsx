import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import DataTable, { Column } from '@/components/DataTable';
import { fetchAdmin, showApiError } from '@/lib/api';
import type { Registration, Event } from '@/lib/types';

export default function RegistrationsList() {
  const [params, setParams] = useSearchParams();
  const eventFilter = params.get('event') || '';
  const statusFilter = params.get('status') || '';

  const [regs, setRegs] = useState<Registration[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    fetchAdmin<{ events: Event[] }>('/api/admin/events')
      .then((r) => setEvents(r.events))
      .catch(showApiError);
  }, []);

  useEffect(() => {
    setLoading(true);
    const qs = new URLSearchParams();
    if (eventFilter) qs.set('event_id', eventFilter);
    if (statusFilter) qs.set('status', statusFilter);
    fetchAdmin<{ registrations: Registration[] }>(`/api/admin/registrations?${qs}`)
      .then((r) => setRegs(r.registrations))
      .catch(showApiError)
      .finally(() => setLoading(false));
  }, [eventFilter, statusFilter]);

  const eventOptions = useMemo(() => {
    const now = Date.now();
    const upcoming = events.filter((e) => Date.parse(e.date) >= now).sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
    const past = events.filter((e) => Date.parse(e.date) < now).sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
    return { upcoming, past };
  }, [events]);

  const eventNameById = useMemo(() => Object.fromEntries(events.map((e) => [e.id, e.name])), [events]);

  const columns: Column<Registration>[] = [
    { key: 'name', header: 'Name', render: (r) => r.name },
    { key: 'phone', header: 'Phone', render: (r) => r.phone },
    { key: 'event', header: 'Event', render: (r) => eventNameById[r.event_id] || '—' },
    { key: 'seats', header: 'Seats', render: (r) => r.seats },
    { key: 'total', header: 'Total', render: (r) => `₹${r.total_amount}` },
    { key: 'status', header: 'Status', render: (r) => r.payment_status },
    { key: 'source', header: 'Source', render: (r) => r.source || '—' },
    { key: 'created', header: 'Created', render: (r) => new Date(r.created_at).toLocaleString() },
  ];

  function setFilter(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">Registrations</h1>
        <Button asChild><Link to="/registrations/new">New manual registration</Link></Button>
      </div>
      <div className="flex gap-2 mb-3">
        <Select value={eventFilter || 'all'} onValueChange={(v) => setFilter('event', v === 'all' ? '' : v)}>
          <SelectTrigger className="w-72"><SelectValue placeholder="All events" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All events</SelectItem>
            {eventOptions.upcoming.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
            {eventOptions.past.length > 0 && <SelectItem value="__sep" disabled>── past ──</SelectItem>}
            {eventOptions.past.map((e) => <SelectItem key={e.id} value={e.id}>{e.name} (past)</SelectItem>)}
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
        <DataTable
          rows={regs}
          columns={columns}
          rowKey={(r) => r.id}
          onRowClick={(r) => navigate(`/registrations/${r.id}${params.toString() ? '?' + params.toString() : ''}`)}
          emptyMessage="No registrations match."
        />
      )}
    </div>
  );
}
