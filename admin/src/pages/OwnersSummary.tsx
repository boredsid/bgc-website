import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import DataTable, { Column } from '@/components/DataTable';
import MobileCardList, { CardField } from '@/components/MobileCardList';
import { fetchAdmin, showApiError } from '@/lib/api';
import { useRevalidate } from '@/lib/revalidate';
import type { OwnerSummaryRow } from '@/lib/types';

const UNOWNED_SENTINEL = '__unowned__';

function ownerLabel(owner: string | null): string {
  return owner ?? 'Unowned';
}

function formatHolders(row: OwnerSummaryRow): string {
  if (row.top_holders.length === 0) return '—';
  const list = row.top_holders.map((h) => `${h.name} (${h.count})`).join(', ');
  return row.more_holders > 0 ? `${list}, +${row.more_holders} more` : list;
}

export default function OwnersSummary() {
  const [owners, setOwners] = useState<OwnerSummaryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const refresh = useCallback(() => {
    setLoading(true);
    fetchAdmin<{ owners: OwnerSummaryRow[] }>('/api/admin/games/owners-summary')
      .then((r) => setOwners(r.owners))
      .catch(showApiError)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  useRevalidate(refresh);

  function openOwner(row: OwnerSummaryRow) {
    const param = row.owner ?? UNOWNED_SENTINEL;
    navigate(`/games?owned_by=${encodeURIComponent(param)}`);
  }

  const columns: Column<OwnerSummaryRow>[] = [
    {
      key: 'owner', header: 'Owner',
      render: (r) => ownerLabel(r.owner),
      sortable: true,
      sortValue: (r) => ownerLabel(r.owner).toLowerCase(),
    },
    {
      key: 'total', header: 'Total',
      render: (r) => r.total,
      sortable: true, sortValue: (r) => r.total,
    },
    {
      key: 'with_owner', header: 'With owner',
      render: (r) => r.with_owner,
      sortable: true, sortValue: (r) => r.with_owner,
    },
    {
      key: 'with_others', header: 'With others',
      render: (r) => r.with_others,
      sortable: true, sortValue: (r) => r.with_others,
    },
    {
      key: 'currently_with', header: 'Currently with',
      render: (r) => formatHolders(r),
    },
  ];

  const fields: CardField<OwnerSummaryRow>[] = [
    { key: 'owner', render: (r) => ownerLabel(r.owner), primary: true },
    {
      key: 'meta',
      render: (r) => `${r.total} owned · ${r.with_others} with others`,
    },
    {
      key: 'holders',
      render: (r) => formatHolders(r),
    },
  ];

  if (loading) return <p>Loading…</p>;

  return (
    <>
      <div className="md:hidden">
        <MobileCardList
          rows={owners}
          fields={fields}
          rowKey={(r) => r.owner ?? UNOWNED_SENTINEL}
          onRowClick={openOwner}
          emptyMessage="No owners yet."
        />
      </div>
      <div className="hidden md:block">
        <DataTable
          rows={owners}
          columns={columns}
          rowKey={(r) => r.owner ?? UNOWNED_SENTINEL}
          onRowClick={openOwner}
          emptyMessage="No owners yet."
        />
      </div>
    </>
  );
}
