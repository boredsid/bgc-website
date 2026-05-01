import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import DataTable, { Column } from '@/components/DataTable';
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
    { key: 'date', header: 'Date', render: (e) => new Date(e.date).toLocaleString() },
    { key: 'venue', header: 'Venue', render: (e) => e.venue_name || '—' },
    { key: 'capacity', header: 'Capacity', render: (e) => e.capacity },
    { key: 'published', header: 'Status', render: (e) => (e.is_published ? 'Published' : 'Draft') },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">Events</h1>
        <Button asChild>
          <Link to="/events/new">New event</Link>
        </Button>
      </div>
      {loading ? <p>Loading…</p> : (
        <DataTable
          rows={events}
          columns={columns}
          rowKey={(e) => e.id}
          onRowClick={(e) => navigate(`/events/${e.id}`)}
          emptyMessage="No events yet."
        />
      )}
    </div>
  );
}
