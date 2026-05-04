import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import DataTable, { Column } from '@/components/DataTable';
import MobileCardList, { CardField } from '@/components/MobileCardList';
import { StatusBadge } from '@/components/StatusBadge';
import { RelativeDate } from '@/components/RelativeDate';
import { fetchAdmin, showApiError } from '@/lib/api';
import type { Event } from '@/lib/types';

export default function EventsList() {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    fetchAdmin<{ events: Event[] }>('/api/admin/events')
      .then((r) => setEvents(r.events))
      .catch(showApiError)
      .finally(() => setLoading(false));
  }, []);

  const columns: Column<Event>[] = [
    { key: 'name', header: 'Name', render: (e) => e.name },
    { key: 'date', header: 'Date', render: (e) => <RelativeDate iso={e.date} />, sortable: true, sortValue: (e) => e.date },
    { key: 'venue', header: 'Venue', render: (e) => e.venue_name || '—' },
    { key: 'capacity', header: 'Capacity', render: (e) => e.capacity, sortable: true, sortValue: (e) => e.capacity },
    { key: 'published', header: 'Status', render: (e) => <StatusBadge status={e.is_published ? 'published' : 'draft'} /> },
  ];

  const fields: CardField<Event>[] = [
    { key: 'name', render: (e) => e.name, primary: true },
    { key: 'date', render: (e) => <RelativeDate iso={e.date} /> },
    { key: 'venue', render: (e) => e.venue_name || '—' },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">Events</h1>
        <Button asChild className="hidden md:inline-flex">
          <Link to="/events/new">New event</Link>
        </Button>
      </div>
      {loading ? <p>Loading…</p> : (
        <>
          <div className="md:hidden">
            <MobileCardList
              rows={events}
              fields={fields}
              rowKey={(e) => e.id}
              onRowClick={(e) => navigate(`/events/${e.id}`)}
              emptyMessage="No events yet."
              trailing={(e) => <StatusBadge status={e.is_published ? 'published' : 'draft'} />}
            />
          </div>
          <div className="hidden md:block">
            <DataTable
              rows={events}
              columns={columns}
              rowKey={(e) => e.id}
              onRowClick={(e) => navigate(`/events/${e.id}`)}
              emptyMessage="No events yet."
            />
          </div>
        </>
      )}

      <Link
        to="/events/new"
        className="md:hidden fixed right-4 bottom-20 z-30 h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center"
        style={{ bottom: 'calc(5rem + env(safe-area-inset-bottom))' }}
        aria-label="New event"
      >
        <Plus className="h-6 w-6" />
      </Link>
    </div>
  );
}
