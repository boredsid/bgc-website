import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ChevronDown, ChevronRight, AlertCircle } from 'lucide-react';
import DashboardCard from '@/components/DashboardCard';
import { fetchAdmin, showApiError } from '@/lib/api';
import type { SummaryCard } from '@/lib/types';

interface SummaryResponse {
  upcoming: SummaryCard[];
  past: SummaryCard[];
  pending_guild_count?: number;
}

export default function Dashboard() {
  const [data, setData] = useState<SummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [showPast, setShowPast] = useState(false);

  useEffect(() => {
    fetchAdmin<SummaryResponse>('/api/admin/summary')
      .then(setData)
      .catch(showApiError)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p>Loading…</p>;
  if (!data) return null;

  const pendingGuild = data.pending_guild_count ?? 0;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      {pendingGuild > 0 && (
        <Link
          to="/guild?status=pending"
          className="flex items-center gap-3 rounded-md border border-amber-300 bg-amber-50 text-amber-900 p-3 hover:bg-amber-100 transition-colors"
        >
          <AlertCircle className="h-5 w-5 shrink-0" />
          <div className="text-sm flex-1">
            <strong>{pendingGuild}</strong> guild membership{pendingGuild === 1 ? '' : 's'} awaiting verification.
            Click to review and update status.
          </div>
        </Link>
      )}
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
