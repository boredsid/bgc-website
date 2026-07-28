import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { fetchAdmin, showApiError } from '@/lib/api';
import { toast } from 'sonner';
import type { FinanceAccount, FinancePaymentMethod, FinanceSummary } from '@/lib/types';

type Untracked = FinanceSummary['untracked'];

interface Props {
  open: boolean;
  accounts: FinanceAccount[];
  untracked: Untracked;
  onClose: () => void;
  onReconciled: () => void;
}

interface ReconcileRow {
  key: string;
  kind: 'registration' | 'guild';
  id: string;
  label: string;
  detail: string;
  amount: number;
  sourceDate: string;
}

function today(): string {
  return new Date().toLocaleDateString('en-CA');
}

function registrationDate(value: string): string {
  return new Date(value).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

export function FinanceReconcileDialog({
  open,
  accounts,
  untracked,
  onClose,
  onReconciled,
}: Props) {
  const rows = useMemo<ReconcileRow[]>(() => [
    ...untracked.registrations.map((registration) => ({
      key: `registration:${registration.id}`,
      kind: 'registration' as const,
      id: registration.id,
      label: registration.name,
      detail: registration.events?.name || 'Event registration',
      amount: registration.total_amount,
      sourceDate: registrationDate(registration.created_at),
    })),
    ...untracked.guild_members.map((member) => ({
      key: `guild:${member.id}`,
      kind: 'guild' as const,
      id: member.id,
      label: member.users?.name || 'Guild Path member',
      detail: `${member.tier} membership`,
      amount: member.amount,
      sourceDate: member.starts_at.slice(0, 10),
    })),
  ], [untracked]);
  const activeAccounts = accounts.filter((account) => account.is_active);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [accountId, setAccountId] = useState('');
  const [method, setMethod] = useState<FinancePaymentMethod>('upi');
  const [dateRule, setDateRule] = useState<'source' | 'chosen'>('source');
  const [chosenDate, setChosenDate] = useState(today());
  const [duplicateChecked, setDuplicateChecked] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    const remembered = localStorage.getItem('bgc-finance-account');
    const defaultAccount = activeAccounts.find((account) => account.id === remembered)
      || activeAccounts.find((account) => account.is_default)
      || activeAccounts[0];
    setSelected(new Set());
    setAccountId(defaultAccount?.id || '');
    setMethod('upi');
    setDateRule('source');
    setChosenDate(today());
    setDuplicateChecked(false);
  }, [open, accounts]); // eslint-disable-line react-hooks/exhaustive-deps

  function toggle(key: string, checked: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(key); else next.delete(key);
      return next;
    });
  }

  async function reconcile() {
    const chosenRows = rows.filter((row) => selected.has(row.key));
    if (!chosenRows.length || !accountId || !duplicateChecked) return;
    if (dateRule === 'chosen' && !chosenDate) return;
    setSaving(true);
    localStorage.setItem('bgc-finance-account', accountId);
    const failed: string[] = [];
    let completed = 0;
    for (const row of chosenRows) {
      try {
        await fetchAdmin(
          row.kind === 'registration'
            ? `/api/admin/registrations/${row.id}`
            : `/api/admin/guild-members/${row.id}`,
          {
            method: 'PATCH',
            body: JSON.stringify({
              payment_account_id: accountId,
              paid_at: dateRule === 'source' ? row.sourceDate : chosenDate,
              payment_method: method,
            }),
          },
        );
        completed++;
        setSelected((current) => {
          const next = new Set(current);
          next.delete(row.key);
          return next;
        });
      } catch {
        failed.push(row.label);
      }
    }
    setSaving(false);
    onReconciled();
    if (completed) toast.success(`Posted ${completed} legacy payment${completed === 1 ? '' : 's'} to Finance`);
    if (failed.length) {
      showApiError(new Error(), `${failed.length} record${failed.length === 1 ? '' : 's'} could not be reconciled. The successful records are safe.`);
    } else {
      onClose();
    }
  }

  const allSelected = rows.length > 0 && selected.size === rows.length;

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !saving) onClose(); }}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Reconcile legacy payments</DialogTitle>
          <DialogDescription>
            Assign where old paid registrations and memberships were received. Each selected record will post one new income transaction.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
          <div className="flex gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Do not select a payment already represented by an imported Income row. That would count the same income twice.
            </span>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <Label>Received in</Label>
            <Select value={accountId} onValueChange={setAccountId} disabled={saving}>
              <SelectTrigger><SelectValue placeholder="Choose account" /></SelectTrigger>
              <SelectContent>
                {activeAccounts.map((account) => (
                  <SelectItem key={account.id} value={account.id}>
                    {account.name}{account.is_default ? ' (default)' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Payment method</Label>
            <Select value={method} onValueChange={(value) => setMethod(value as FinancePaymentMethod)} disabled={saving}>
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
          <div>
            <Label>Payment date</Label>
            <Select value={dateRule} onValueChange={(value) => setDateRule(value as 'source' | 'chosen')} disabled={saving}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="source">Use each original date</SelectItem>
                <SelectItem value="chosen">Use one chosen date</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        {dateRule === 'chosen' && (
          <div className="max-w-48">
            <Label>Chosen date</Label>
            <Input type="date" value={chosenDate} onChange={(event) => setChosenDate(event.target.value)} disabled={saving} />
          </div>
        )}

        <div className="rounded-md border">
          <div className="flex items-center gap-3 border-b bg-muted/30 px-3 py-2 text-sm">
            <Checkbox
              checked={allSelected ? true : selected.size > 0 ? 'indeterminate' : false}
              onCheckedChange={(checked) => setSelected(checked ? new Set(rows.map((row) => row.key)) : new Set())}
              aria-label="Select all legacy payments"
              disabled={saving}
            />
            <span className="font-medium">{selected.size} of {rows.length} selected</span>
          </div>
          <div className="max-h-64 overflow-y-auto divide-y">
            {rows.map((row) => (
              <label key={row.key} className="flex cursor-pointer items-center gap-3 px-3 py-2.5 text-sm">
                <Checkbox
                  checked={selected.has(row.key)}
                  onCheckedChange={(checked) => toggle(row.key, checked === true)}
                  disabled={saving}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{row.label}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {row.detail} · {row.sourceDate}
                  </span>
                </span>
                <span className="font-medium">₹{row.amount.toLocaleString('en-IN')}</span>
              </label>
            ))}
          </div>
        </div>

        <label className="flex items-start gap-2 text-sm">
          <Checkbox
            checked={duplicateChecked}
            onCheckedChange={(checked) => setDuplicateChecked(checked === true)}
            disabled={saving}
          />
          <span>I checked that the selected payments are not already included in imported income.</span>
        </label>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button
            onClick={reconcile}
            disabled={saving || selected.size === 0 || !accountId || !duplicateChecked || (dateRule === 'chosen' && !chosenDate)}
          >
            {saving ? 'Posting payments…' : `Post ${selected.size || ''} payment${selected.size === 1 ? '' : 's'}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
