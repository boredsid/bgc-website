import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowDownCircle, ArrowRightLeft, ArrowUpCircle, Download, Plus, Settings, Upload, WalletCards } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import DataTable, { type Column } from '@/components/DataTable';
import MobileCardList, { type CardField } from '@/components/MobileCardList';
import { FinanceSettingsDialog } from '@/components/FinanceSettingsDialog';
import { FinanceImportDialog } from '@/components/FinanceImportDialog';
import { FinanceReconcileDialog } from '@/components/FinanceReconcileDialog';
import { fetchAdmin, showApiError } from '@/lib/api';
import { useRevalidate } from '@/lib/revalidate';
import type {
  Event,
  FinanceAccount,
  FinanceCategory,
  FinanceSummary,
  FinanceTransaction,
} from '@/lib/types';

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '';

function inr(amount: number | null): string {
  if (amount === null) return '—';
  return amount < 0
    ? `−₹${Math.abs(amount).toLocaleString('en-IN')}`
    : `₹${amount.toLocaleString('en-IN')}`;
}

function firstDayOfMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
}

function today(): string {
  return new Date().toLocaleDateString('en-CA');
}

function MetricCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'positive' | 'negative' | 'neutral';
}) {
  const toneClass = tone === 'positive'
    ? 'text-emerald-700'
    : tone === 'negative' ? 'text-red-700' : '';
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={`text-2xl font-semibold mt-1 ${toneClass}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

export default function Finance() {
  const [params, setParams] = useSearchParams();
  const dateFrom = params.get('date_from') || firstDayOfMonth();
  const dateTo = params.get('date_to') || today();
  const type = params.get('type') || '';
  const accountId = params.get('account') || '';
  const categoryId = params.get('category') || '';
  const [summary, setSummary] = useState<FinanceSummary | null>(null);
  const [transactions, setTransactions] = useState<FinanceTransaction[]>([]);
  const [accounts, setAccounts] = useState<FinanceAccount[]>([]);
  const [categories, setCategories] = useState<FinanceCategory[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [reconcileOpen, setReconcileOpen] = useState(false);
  const navigate = useNavigate();

  function setFilter(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next);
  }

  const loadBootstrap = useCallback(() => {
    Promise.all([
      fetchAdmin<{ accounts: FinanceAccount[]; categories: FinanceCategory[] }>('/api/admin/finance/bootstrap'),
      fetchAdmin<{ events: Event[] }>('/api/admin/events'),
    ])
      .then(([bootstrap, eventData]) => {
        setAccounts(bootstrap.accounts);
        setCategories(bootstrap.categories);
        setEvents(eventData.events);
      })
      .catch(showApiError);
  }, []);

  const refresh = useCallback(() => {
    setLoading(true);
    const query = new URLSearchParams({ date_from: dateFrom, date_to: dateTo });
    if (type) query.set('type', type);
    if (accountId) query.set('account_id', accountId);
    if (categoryId) query.set('category_id', categoryId);
    Promise.all([
      fetchAdmin<FinanceSummary>(`/api/admin/finance/summary?${new URLSearchParams({ date_from: dateFrom, date_to: dateTo })}`),
      fetchAdmin<{ transactions: FinanceTransaction[] }>(`/api/admin/finance/transactions?${query}`),
    ])
      .then(([summaryData, transactionData]) => {
        setSummary(summaryData);
        setTransactions(transactionData.transactions);
      })
      .catch(showApiError)
      .finally(() => setLoading(false));
  }, [accountId, categoryId, dateFrom, dateTo, type]);

  useEffect(() => { loadBootstrap(); }, [loadBootstrap]);
  useEffect(() => { refresh(); }, [refresh]);
  useRevalidate(() => { loadBootstrap(); refresh(); });

  const filteredCategories = categories.filter((category) =>
    !type || type === 'transfer' || category.transaction_type === type
  );
  const eventName = useMemo(() => Object.fromEntries(events.map((event) => [event.id, event.name])), [events]);

  function openTransaction(transaction: FinanceTransaction) {
    if (transaction.source === 'registration' && transaction.registration_id) {
      navigate(`/registrations/${transaction.registration_id}`);
    } else if (transaction.source === 'guild' && transaction.guild_member_id) {
      navigate(`/guild/${transaction.guild_member_id}`);
    } else {
      navigate(`/finance/${transaction.id}`);
    }
  }

  const columns: Column<FinanceTransaction>[] = [
    {
      key: 'date',
      header: 'Date',
      render: (row) => new Date(`${row.occurred_on}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }),
      sortable: true,
      sortValue: (row) => row.occurred_on,
    },
    {
      key: 'title',
      header: 'Title',
      render: (row) => (
        <div>
          <div className="font-medium">{row.title}</div>
          <div className="text-xs text-muted-foreground">{row.category?.name || 'Internal transfer'}</div>
        </div>
      ),
      sortable: true,
      sortValue: (row) => row.title.toLowerCase(),
    },
    {
      key: 'account',
      header: 'Account',
      render: (row) => row.transaction_type === 'transfer'
        ? `${row.from_account?.name || '—'} → ${row.to_account?.name || '—'}`
        : row.transaction_type === 'income' ? row.to_account?.name || '—' : row.from_account?.name || '—',
    },
    {
      key: 'event',
      header: 'Event',
      render: (row) => row.event?.name || (row.event_id ? eventName[row.event_id] : '') || '—',
    },
    {
      key: 'amount',
      header: 'Amount',
      render: (row) => (
        <span className={row.transaction_type === 'income' ? 'text-emerald-700' : row.transaction_type === 'expense' ? 'text-red-700' : ''}>
          {row.transaction_type === 'income' ? '+' : row.transaction_type === 'expense' ? '−' : ''}{inr(row.amount)}
        </span>
      ),
      sortable: true,
      sortValue: (row) => row.amount,
    },
  ];

  const mobileFields: CardField<FinanceTransaction>[] = [
    { key: 'title', render: (row) => row.title, primary: true },
    {
      key: 'meta',
      render: (row) => `${row.category?.name || 'Transfer'} · ${new Date(`${row.occurred_on}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`,
    },
    {
      key: 'account',
      render: (row) => row.transaction_type === 'transfer'
        ? `${row.from_account?.name || '—'} → ${row.to_account?.name || '—'}`
        : row.transaction_type === 'income' ? row.to_account?.name || '—' : row.from_account?.name || '—',
    },
  ];

  const maxMonthly = Math.max(1, ...(summary?.monthly.flatMap((row) => [row.income, row.expenses]) || [1]));
  const untrackedCount = (summary?.untracked.registrations.length || 0) + (summary?.untracked.guild_members.length || 0);
  const exportQuery = new URLSearchParams({ date_from: dateFrom, date_to: dateTo, limit: '1000' });
  if (type) exportQuery.set('type', type);
  if (accountId) exportQuery.set('account_id', accountId);
  if (categoryId) exportQuery.set('category_id', categoryId);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Finance</h1>
          <p className="text-sm text-muted-foreground">Cash movement, account balances, and event profitability.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setImportOpen(true)}><Upload className="h-4 w-4 mr-1" /> Import</Button>
          <Button variant="outline" onClick={() => setSettingsOpen(true)}><Settings className="h-4 w-4 mr-1" /> Settings</Button>
          <Button asChild><Link to="/finance/new?type=expense"><Plus className="h-4 w-4 mr-1" /> Add transaction</Link></Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Money in" value={inr(summary?.totals.income ?? 0)} tone="positive" />
        <MetricCard label="Money out" value={inr(summary?.totals.expenses ?? 0)} tone="negative" />
        <MetricCard
          label="Operating surplus"
          value={inr(summary?.totals.surplus ?? 0)}
          tone={(summary?.totals.surplus ?? 0) >= 0 ? 'positive' : 'negative'}
        />
        <MetricCard label="Customer credits owed" value={inr(summary?.totals.outstanding_credits ?? null)} />
      </div>

      {untrackedCount > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
          <div>
            <strong>{untrackedCount} paid legacy record{untrackedCount === 1 ? '' : 's'}</strong> need review during cutover:
            {' '}{summary?.untracked.registrations.length || 0} registrations and {summary?.untracked.guild_members.length || 0} memberships.
            They are not included in Finance totals yet.
          </div>
          <Button size="sm" variant="outline" onClick={() => setReconcileOpen(true)}>
            Reconcile
          </Button>
        </div>
      )}

      <section>
        <div className="flex flex-wrap gap-2">
          <Input type="date" className="w-40" value={dateFrom} onChange={(event) => setFilter('date_from', event.target.value)} aria-label="From date" />
          <Input type="date" className="w-40" value={dateTo} onChange={(event) => setFilter('date_to', event.target.value)} aria-label="To date" />
          <Select value={type || 'all'} onValueChange={(value) => {
            setFilter('type', value === 'all' ? '' : value);
            setFilter('category', '');
          }}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              <SelectItem value="income">Income</SelectItem>
              <SelectItem value="expense">Expenses</SelectItem>
              <SelectItem value="transfer">Transfers</SelectItem>
            </SelectContent>
          </Select>
          <Select value={accountId || 'all'} onValueChange={(value) => setFilter('account', value === 'all' ? '' : value)}>
            <SelectTrigger className="w-48"><SelectValue placeholder="All accounts" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All accounts</SelectItem>
              {accounts.map((account) => <SelectItem key={account.id} value={account.id}>{account.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={categoryId || 'all'} onValueChange={(value) => setFilter('category', value === 'all' ? '' : value)} disabled={type === 'transfer'}>
            <SelectTrigger className="w-48"><SelectValue placeholder="All categories" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {filteredCategories.map((category) => <SelectItem key={category.id} value={category.id}>{category.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="outline" asChild>
            <a href={`${API_BASE}/api/admin/finance/export?${exportQuery}`}><Download className="h-4 w-4 mr-1" /> Export</a>
          </Button>
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><WalletCards className="h-4 w-4" /> Funds held</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {(summary?.account_balances || []).map((account) => (
              <div key={account.id} className="flex items-center justify-between text-sm">
                <span>{account.name}</span>
                <span className={account.balance < 0 ? 'text-red-700' : 'font-medium'}>{inr(account.balance)}</span>
              </div>
            ))}
            {!summary?.account_balances.length && <div className="text-sm text-muted-foreground">No accounts yet.</div>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Spend by category</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {(summary?.category_spend || []).slice(0, 8).map((row) => (
              <div key={row.category} className="flex items-center justify-between text-sm">
                <span>{row.category}</span><span>{inr(row.amount)}</span>
              </div>
            ))}
            {!summary?.category_spend.length && <div className="text-sm text-muted-foreground">No expenses in this period.</div>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Monthly movement</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {(summary?.monthly || []).slice(-6).map((row) => (
              <div key={row.month}>
                <div className="text-xs text-muted-foreground mb-1">{row.month}</div>
                <div className="space-y-1">
                  <div className="h-2 rounded bg-emerald-100 overflow-hidden">
                    <div className="h-full bg-emerald-500" style={{ width: `${row.income / maxMonthly * 100}%` }} />
                  </div>
                  <div className="h-2 rounded bg-red-100 overflow-hidden">
                    <div className="h-full bg-red-400" style={{ width: `${row.expenses / maxMonthly * 100}%` }} />
                  </div>
                </div>
              </div>
            ))}
            {!summary?.monthly.length && <div className="text-sm text-muted-foreground">No movement in this period.</div>}
          </CardContent>
        </Card>
      </div>

      {summary && summary.event_profit.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Event profitability</CardTitle></CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground">
                <tr><th className="pb-2">Event</th><th className="pb-2 text-right">Income</th><th className="pb-2 text-right">Expenses</th><th className="pb-2 text-right">Surplus</th></tr>
              </thead>
              <tbody>
                {summary.event_profit.slice(0, 12).map((event) => (
                  <tr key={event.event_id} className="border-t">
                    <td className="py-2">{event.event_name}</td>
                    <td className="py-2 text-right">{inr(event.income)}</td>
                    <td className="py-2 text-right">{inr(event.expenses)}</td>
                    <td className={`py-2 text-right font-medium ${event.surplus < 0 ? 'text-red-700' : 'text-emerald-700'}`}>{inr(event.surplus)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <section>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h2 className="text-lg font-medium">Transactions</h2>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" asChild><Link to="/finance/new?type=income"><ArrowDownCircle className="h-4 w-4 mr-1" /> Income</Link></Button>
            <Button variant="outline" size="sm" asChild><Link to="/finance/new?type=expense"><ArrowUpCircle className="h-4 w-4 mr-1" /> Expense</Link></Button>
            <Button variant="outline" size="sm" asChild><Link to="/finance/new?type=transfer"><ArrowRightLeft className="h-4 w-4 mr-1" /> Transfer</Link></Button>
          </div>
        </div>
        {loading ? <p>Loading…</p> : (
          <>
            <div className="md:hidden">
              <MobileCardList
                rows={transactions}
                fields={mobileFields}
                rowKey={(row) => row.id}
                onRowClick={openTransaction}
                emptyMessage="No transactions match these filters."
                trailing={(row) => (
                  <span className={row.transaction_type === 'income' ? 'text-emerald-700 font-medium' : row.transaction_type === 'expense' ? 'text-red-700 font-medium' : 'font-medium'}>
                    {row.transaction_type === 'income' ? '+' : row.transaction_type === 'expense' ? '−' : ''}{inr(row.amount)}
                  </span>
                )}
              />
            </div>
            <div className="hidden md:block">
              <DataTable rows={transactions} columns={columns} rowKey={(row) => row.id} onRowClick={openTransaction} emptyMessage="No transactions match these filters." />
            </div>
          </>
        )}
      </section>

      <FinanceSettingsDialog
        open={settingsOpen}
        accounts={accounts}
        categories={categories}
        onClose={() => setSettingsOpen(false)}
        onChanged={() => { loadBootstrap(); refresh(); }}
      />
      <FinanceImportDialog
        open={importOpen}
        categories={categories}
        onClose={() => setImportOpen(false)}
        onImported={() => { loadBootstrap(); refresh(); }}
      />
      {summary && (
        <FinanceReconcileDialog
          open={reconcileOpen}
          accounts={accounts}
          untracked={summary.untracked}
          onClose={() => setReconcileOpen(false)}
          onReconciled={() => { loadBootstrap(); refresh(); }}
        />
      )}
    </div>
  );
}
