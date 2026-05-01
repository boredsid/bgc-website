import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import DataTable, { Column } from '@/components/DataTable';
import { fetchAdmin, showApiError } from '@/lib/api';
import type { GuildMember } from '@/lib/types';

export default function GuildList() {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') || '';
  const tier = params.get('tier') || '';
  const [members, setMembers] = useState<GuildMember[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    setLoading(true);
    const qs = new URLSearchParams();
    if (status) qs.set('status', status);
    if (tier) qs.set('tier', tier);
    fetchAdmin<{ members: GuildMember[] }>(`/api/admin/guild-members?${qs}`)
      .then((r) => setMembers(r.members))
      .catch(showApiError)
      .finally(() => setLoading(false));
  }, [status, tier]);

  const columns: Column<GuildMember>[] = [
    { key: 'name', header: 'Name', render: (m) => m.user_name || '—' },
    { key: 'phone', header: 'Phone', render: (m) => m.user_phone },
    { key: 'tier', header: 'Tier', render: (m) => m.tier },
    { key: 'starts', header: 'Starts', render: (m) => m.starts_at },
    { key: 'expires', header: 'Expires', render: (m) => m.expires_at },
    { key: 'status', header: 'Status', render: (m) => m.status },
    { key: 'plus_ones', header: 'Plus-ones used', render: (m) => m.plus_ones_used },
  ];

  function setFilter(k: string, v: string) {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v); else next.delete(k);
    setParams(next);
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-4">Guild members</h1>
      <div className="flex gap-2 mb-3">
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
        <DataTable
          rows={members}
          columns={columns}
          rowKey={(m) => m.id}
          onRowClick={(m) => navigate(`/guild/${m.id}`)}
          emptyMessage="No guild members match."
        />
      )}
    </div>
  );
}
