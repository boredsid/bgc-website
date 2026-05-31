import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import DataTable, { Column } from '@/components/DataTable';
import MobileCardList, { CardField } from '@/components/MobileCardList';
import { PhoneCell } from '@/components/PhoneCell';
import { RelativeDate } from '@/components/RelativeDate';
import { fetchAdmin, showApiError } from '@/lib/api';
import { useRevalidate } from '@/lib/revalidate';
import type { UserListItem } from '@/lib/types';

const PAGE_SIZE = 50;

export default function UsersList() {
  const [users, setUsers] = useState<UserListItem[]>([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const navigate = useNavigate();

  const refresh = useCallback(() => {
    setLoading(true);
    fetchAdmin<{ users: UserListItem[]; hasMore?: boolean }>(
      `/api/admin/users?q=${encodeURIComponent(q)}&limit=${PAGE_SIZE}&offset=0`,
    )
      .then((r) => {
        setUsers(r.users);
        setHasMore(Boolean(r.hasMore));
      })
      .catch(showApiError)
      .finally(() => setLoading(false));
  }, [q]);

  const loadMore = useCallback(() => {
    setLoadingMore(true);
    fetchAdmin<{ users: UserListItem[]; hasMore?: boolean }>(
      `/api/admin/users?q=${encodeURIComponent(q)}&limit=${PAGE_SIZE}&offset=${users.length}`,
    )
      .then((r) => {
        setUsers((prev) => [...prev, ...r.users]);
        setHasMore(Boolean(r.hasMore));
      })
      .catch(showApiError)
      .finally(() => setLoadingMore(false));
  }, [q, users.length]);

  useEffect(() => {
    const t = setTimeout(refresh, 200);
    return () => clearTimeout(t);
  }, [refresh]);
  useRevalidate(refresh);

  const columns: Column<UserListItem>[] = [
    {
      key: 'name', header: 'Name', render: (u) => u.name || '—',
      sortable: true, sortValue: (u) => (u.name ?? '').toLowerCase(),
    },
    { key: 'phone', header: 'Phone', render: (u) => <PhoneCell phone={u.phone} /> },
    { key: 'email', header: 'Email', render: (u) => u.email || '—' },
    {
      key: 'credits', header: 'Credits', render: (u) => `₹${u.credit_balance}`,
      sortable: true, sortValue: (u) => u.credit_balance,
    },
    {
      key: 'last_registered', header: 'Last registered',
      render: (u) => <RelativeDate iso={u.last_registered_at} />,
      sortable: true, sortValue: (u) => u.last_registered_at,
    },
  ];

  const fields: CardField<UserListItem>[] = [
    { key: 'name', render: (u) => u.name || u.phone, primary: true },
    { key: 'phone', render: (u) => <PhoneCell phone={u.phone} /> },
    { key: 'meta', render: (u) => `₹${u.credit_balance} credit · last ${new Date(u.last_registered_at).toLocaleDateString()}` },
  ];

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-4">Users</h1>
      <div className="mb-3">
        <Input placeholder="Search name, phone, email" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {loading ? <p>Loading…</p> : (
        <>
          <div className="md:hidden">
            <MobileCardList
              rows={users}
              fields={fields}
              rowKey={(u) => u.id}
              onRowClick={(u) => navigate(`/users/${u.id}`)}
              emptyMessage="No users match."
            />
          </div>
          <div className="hidden md:block">
            <DataTable
              rows={users}
              columns={columns}
              rowKey={(u) => u.id}
              onRowClick={(u) => navigate(`/users/${u.id}`)}
              emptyMessage="No users match."
            />
          </div>
          {hasMore && (
            <div className="mt-4 flex justify-center">
              <Button variant="outline" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? 'Loading…' : 'Load more'}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
