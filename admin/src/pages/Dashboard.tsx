import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ChevronDown, ChevronRight } from 'lucide-react';
import DashboardCard from '@/components/DashboardCard';
import { fetchAdmin, showApiError } from '@/lib/api';
import type { SummaryCard } from '@/lib/types';

export default function Dashboard() {
  const [data, setData] = useState<{ upcoming: SummaryCard[]; past: SummaryCard[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [showPast, setShowPast] = useState(false);

  useEffect(() => {
    fetchAdmin<{ upcoming: SummaryCard[]; past: SummaryCard[] }>('/api/admin/summary')
      .then(setData)
      .catch(showApiError)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p>Loading…</p>;
  if (!data) return null;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <section>
        <h2 className="text-lg font-medium mb-3">Upcoming events</h2>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.upcoming.length === 0
            ? <p className="text-sm text-muted-foreground">No upcoming events.</p>
            : data.upcoming.map((c) => <DashboardCard key={c.event.id} summary={c} />)}
        </div>
      </section>
      <section>
        <Button variant="ghost" onClick={() => setShowPast((x) => !x)} className="px-1">
          {showPast ? <ChevronDown className="h-4 w-4 mr-1" /> : <ChevronRight className="h-4 w-4 mr-1" />}
          Past events ({data.past.length})
        </Button>
        {showPast && (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 mt-3">
            {data.past.map((c) => <DashboardCard key={c.event.id} summary={c} />)}
          </div>
        )}
      </section>
    </div>
  );
}
