import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { FormDrawer } from '@/components/FormDrawer';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { NumberInput } from '@/components/NumberInput';
import { fetchAdmin, showApiError } from '@/lib/api';
import { toast } from 'sonner';
import type {
  CorporateEvent,
  Event,
  FinanceAccount,
  FinanceCategory,
  FinancePaymentMethod,
  FinanceTransaction,
  FinanceTransactionType,
  Game,
} from '@/lib/types';

interface Draft {
  transaction_type: FinanceTransactionType;
  occurred_on: string;
  amount: number;
  title: string;
  category_id: string | null;
  from_account_id: string | null;
  to_account_id: string | null;
  payment_method: FinancePaymentMethod | null;
  event_id: string | null;
  corporate_event_id: string | null;
  game_id: string | null;
  notes: string | null;
  receipt_url: string | null;
}

function blankDraft(type: FinanceTransactionType): Draft {
  return {
    transaction_type: type,
    occurred_on: new Date().toISOString().slice(0, 10),
    amount: 0,
    title: type === 'transfer' ? 'Internal transfer' : '',
    category_id: null,
    from_account_id: null,
    to_account_id: null,
    payment_method: type === 'transfer' ? null : 'upi',
    event_id: null,
    corporate_event_id: null,
    game_id: null,
    notes: null,
    receipt_url: null,
  };
}

export default function FinanceTransactionDrawer() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const requestedType = searchParams.get('type');
  const initialType: FinanceTransactionType = requestedType === 'income' || requestedType === 'transfer'
    ? requestedType
    : 'expense';
  const [draft, setDraft] = useState<Draft>(() => blankDraft(initialType));
  const [initial, setInitial] = useState<Draft | null>(null);
  const [source, setSource] = useState<FinanceTransaction['source']>('manual');
  const [accounts, setAccounts] = useState<FinanceAccount[]>([]);
  const [categories, setCategories] = useState<FinanceCategory[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [corporateEvents, setCorporateEvents] = useState<CorporateEvent[]>([]);
  const [games, setGames] = useState<Game[]>([]);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);

  useEffect(() => {
    Promise.all([
      fetchAdmin<{ accounts: FinanceAccount[]; categories: FinanceCategory[] }>('/api/admin/finance/bootstrap'),
      fetchAdmin<{ events: Event[] }>('/api/admin/events'),
      fetchAdmin<{ corporate_events: CorporateEvent[] }>('/api/admin/corporate-events'),
      fetchAdmin<{ games: Game[] }>('/api/admin/games'),
    ])
      .then(([bootstrap, eventData, corporateData, gameData]) => {
        setAccounts(bootstrap.accounts);
        setCategories(bootstrap.categories);
        setEvents(eventData.events);
        setCorporateEvents(corporateData.corporate_events);
        setGames(gameData.games);

        if (!id) {
          const remembered = localStorage.getItem('admin.finance.lastAccountId');
          const account = bootstrap.accounts.find((item) => item.is_active && item.id === remembered)
            || bootstrap.accounts.find((item) => item.is_active && item.is_default);
          const category = bootstrap.categories.find((item) =>
            item.is_active && item.transaction_type === initialType
          );
          setDraft((current) => {
            const next = {
              ...current,
              category_id: initialType === 'transfer' ? null : category?.id || null,
              from_account_id: initialType === 'expense' || initialType === 'transfer' ? account?.id || null : null,
              to_account_id: initialType === 'income' ? account?.id || null : null,
            };
            setInitial(next);
            return next;
          });
        }
      })
      .catch(showApiError);
  }, [id, initialType]);

  useEffect(() => {
    if (!id) return;
    fetchAdmin<{ transaction: FinanceTransaction }>(`/api/admin/finance/transactions/${id}`)
      .then(({ transaction }) => {
        const next: Draft = {
          transaction_type: transaction.transaction_type,
          occurred_on: transaction.occurred_on,
          amount: transaction.amount,
          title: transaction.title,
          category_id: transaction.category_id,
          from_account_id: transaction.from_account_id,
          to_account_id: transaction.to_account_id,
          payment_method: transaction.payment_method,
          event_id: transaction.event_id,
          corporate_event_id: transaction.corporate_event_id,
          game_id: transaction.game_id,
          notes: transaction.notes,
          receipt_url: transaction.receipt_url,
        };
        setDraft(next);
        setInitial(next);
        setSource(transaction.source);
      })
      .catch(showApiError);
  }, [id]);

  const errors = useMemo(() => {
    const next: Record<string, string> = {};
    if (!draft.title.trim()) next.title = 'Add a clear title.';
    if (!draft.occurred_on) next.occurred_on = 'Choose a date.';
    if (!Number.isInteger(draft.amount) || draft.amount <= 0) next.amount = 'Enter an amount greater than zero.';
    if (draft.transaction_type === 'income' && !draft.to_account_id) next.to_account_id = 'Choose where the money was received.';
    if (draft.transaction_type === 'expense' && !draft.from_account_id) next.from_account_id = 'Choose which account paid.';
    if (draft.transaction_type !== 'transfer' && !draft.category_id) next.category_id = 'Choose a category.';
    if (draft.transaction_type === 'transfer') {
      if (!draft.from_account_id) next.from_account_id = 'Choose the sending account.';
      if (!draft.to_account_id) next.to_account_id = 'Choose the receiving account.';
      if (draft.from_account_id && draft.from_account_id === draft.to_account_id) {
        next.to_account_id = 'Choose a different receiving account.';
      }
    }
    return next;
  }, [draft]);

  const dirty = !!initial && JSON.stringify(initial) !== JSON.stringify(draft);
  const editable = source !== 'registration' && source !== 'guild';
  const activeAccounts = accounts.filter((account) => account.is_active || account.id === draft.from_account_id || account.id === draft.to_account_id);
  const visibleCategories = categories.filter((category) =>
    category.transaction_type === draft.transaction_type
    && (category.is_active || category.id === draft.category_id)
  );

  function close() {
    navigate('/finance');
  }

  function update<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function changeType(type: FinanceTransactionType) {
    const remembered = localStorage.getItem('admin.finance.lastAccountId');
    const account = accounts.find((item) => item.is_active && item.id === remembered)
      || accounts.find((item) => item.is_active && item.is_default);
    const category = categories.find((item) => item.is_active && item.transaction_type === type);
    setDraft((current) => ({
      ...current,
      transaction_type: type,
      title: current.title === 'Internal transfer' && type !== 'transfer' ? '' : current.title || (type === 'transfer' ? 'Internal transfer' : ''),
      category_id: type === 'transfer' ? null : category?.id || null,
      from_account_id: type === 'expense' || type === 'transfer' ? current.from_account_id || account?.id || null : null,
      to_account_id: type === 'income' ? current.to_account_id || account?.id || null : type === 'transfer' ? current.to_account_id : null,
      payment_method: type === 'transfer' ? null : current.payment_method || 'upi',
    }));
  }

  async function save() {
    setShowErrors(true);
    if (Object.keys(errors).length > 0 || !editable) return;
    setSaving(true);
    setServerError(null);
    try {
      const endpoint = id ? `/api/admin/finance/transactions/${id}` : '/api/admin/finance/transactions';
      await fetchAdmin(endpoint, {
        method: id ? 'PATCH' : 'POST',
        body: JSON.stringify(draft),
      });
      const accountId = draft.transaction_type === 'income' ? draft.to_account_id : draft.from_account_id;
      if (accountId) localStorage.setItem('admin.finance.lastAccountId', accountId);
      toast.success(id ? 'Transaction updated' : 'Transaction added');
      close();
    } catch (error) {
      setServerError(error instanceof Error ? error.message : 'Something went wrong.');
    } finally {
      setSaving(false);
    }
  }

  async function voidTransaction() {
    if (!id) return;
    const reason = window.prompt('Why are you voiding this transaction?')?.trim();
    if (!reason) return;
    try {
      await fetchAdmin(`/api/admin/finance/transactions/${id}/void`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      });
      toast.success('Transaction voided');
      close();
    } catch (error) {
      showApiError(error);
    }
  }

  function field(key: keyof Draft, label: string, control: React.ReactNode) {
    const error = showErrors ? errors[key] : undefined;
    return (
      <div>
        <Label className={error ? 'text-destructive' : undefined}>{label}</Label>
        {control}
        {error && <div className="text-xs text-destructive mt-1">{error}</div>}
      </div>
    );
  }

  return (
    <FormDrawer
      open
      title={id ? 'Transaction details' : `Add ${draft.transaction_type}`}
      dirty={dirty}
      saving={saving}
      onCancel={close}
      onSave={save}
      errorCount={showErrors ? Object.keys(errors).length : 0}
      errorMessage={serverError}
    >
      {id && !initial ? <p>Loading…</p> : (
        <div className="space-y-4">
          {!editable && (
            <div className="rounded-md border bg-muted/40 p-3 text-sm">
              This entry is kept in sync with its linked {source === 'registration' ? 'registration' : 'Guild membership'}.
              Edit the source record to change its amount or payment details.
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <Label>Type</Label>
              <Select value={draft.transaction_type} onValueChange={(value) => changeType(value as FinanceTransactionType)} disabled={!editable || !!id}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="expense">Expense</SelectItem>
                  <SelectItem value="income">Income</SelectItem>
                  <SelectItem value="transfer">Transfer</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {field('occurred_on', 'Date', (
              <Input type="date" value={draft.occurred_on} onChange={(event) => update('occurred_on', event.target.value)} disabled={!editable} />
            ))}
            {field('amount', 'Amount (₹)', (
              <NumberInput value={draft.amount} onChange={(amount) => update('amount', amount ?? 0)} allowRupees min={1} disabled={!editable} />
            ))}
          </div>

          {field('title', 'Title', (
            <Input value={draft.title} onChange={(event) => update('title', event.target.value)} placeholder="e.g. Venue payout" disabled={!editable} />
          ))}

          <div className="grid gap-3 sm:grid-cols-2">
            {(draft.transaction_type === 'expense' || draft.transaction_type === 'transfer') && field('from_account_id', 'Paid from', (
              <Select value={draft.from_account_id || ''} onValueChange={(value) => update('from_account_id', value)} disabled={!editable}>
                <SelectTrigger><SelectValue placeholder="Choose account" /></SelectTrigger>
                <SelectContent>{activeAccounts.map((account) => <SelectItem key={account.id} value={account.id}>{account.name}</SelectItem>)}</SelectContent>
              </Select>
            ))}
            {(draft.transaction_type === 'income' || draft.transaction_type === 'transfer') && field('to_account_id', 'Received in', (
              <Select value={draft.to_account_id || ''} onValueChange={(value) => update('to_account_id', value)} disabled={!editable}>
                <SelectTrigger><SelectValue placeholder="Choose account" /></SelectTrigger>
                <SelectContent>{activeAccounts.map((account) => <SelectItem key={account.id} value={account.id}>{account.name}</SelectItem>)}</SelectContent>
              </Select>
            ))}
            {draft.transaction_type !== 'transfer' && field('category_id', 'Category', (
              <Select value={draft.category_id || ''} onValueChange={(value) => update('category_id', value)} disabled={!editable}>
                <SelectTrigger><SelectValue placeholder="Choose category" /></SelectTrigger>
                <SelectContent>{visibleCategories.map((category) => <SelectItem key={category.id} value={category.id}>{category.name}</SelectItem>)}</SelectContent>
              </Select>
            ))}
            {draft.transaction_type !== 'transfer' && (
              <div>
                <Label>Payment method</Label>
                <Select
                  value={draft.payment_method || 'other'}
                  onValueChange={(value) => update('payment_method', value as FinancePaymentMethod)}
                  disabled={!editable}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="upi">UPI</SelectItem>
                    <SelectItem value="cash">Cash</SelectItem>
                    <SelectItem value="bank_transfer">Bank transfer</SelectItem>
                    <SelectItem value="card">Card</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {draft.transaction_type !== 'transfer' && (
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <Label>Event (optional)</Label>
                <Select value={draft.event_id || '__none'} onValueChange={(value) => update('event_id', value === '__none' ? null : value)} disabled={!editable}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">No event</SelectItem>
                    {events.map((event) => <SelectItem key={event.id} value={event.id}>{event.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Corporate event (optional)</Label>
                <Select value={draft.corporate_event_id || '__none'} onValueChange={(value) => update('corporate_event_id', value === '__none' ? null : value)} disabled={!editable}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">None</SelectItem>
                    {corporateEvents.map((event) => <SelectItem key={event.id} value={event.id}>{event.title || event.company_name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Game (optional)</Label>
                <Select value={draft.game_id || '__none'} onValueChange={(value) => update('game_id', value === '__none' ? null : value)} disabled={!editable}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">None</SelectItem>
                    {games.map((game) => <SelectItem key={game.id} value={game.id}>{game.title}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          <div>
            <Label>Notes</Label>
            <Textarea value={draft.notes || ''} onChange={(event) => update('notes', event.target.value || null)} disabled={!editable} />
          </div>
          <div>
            <Label>Receipt link</Label>
            <Input
              type="url"
              value={draft.receipt_url || ''}
              onChange={(event) => update('receipt_url', event.target.value || null)}
              placeholder="Google Drive or invoice link"
              disabled={!editable}
            />
          </div>
          {id && editable && (
            <div className="border-t pt-4">
              <Button variant="destructive" onClick={voidTransaction}>Void transaction</Button>
              <p className="text-xs text-muted-foreground mt-1">Voiding keeps the audit trail but removes the amount from reports.</p>
            </div>
          )}
        </div>
      )}
    </FormDrawer>
  );
}
