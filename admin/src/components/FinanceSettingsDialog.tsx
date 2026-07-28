import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { fetchAdmin, showApiError } from '@/lib/api';
import { toast } from 'sonner';
import type { FinanceAccount, FinanceCategory, FinanceTransactionType } from '@/lib/types';

interface Props {
  open: boolean;
  accounts: FinanceAccount[];
  categories: FinanceCategory[];
  onClose: () => void;
  onChanged: () => void;
}

export function FinanceSettingsDialog({ open, accounts, categories, onClose, onChanged }: Props) {
  const [accountName, setAccountName] = useState('');
  const [accountType, setAccountType] = useState<FinanceAccount['account_type']>('person');
  const [categoryName, setCategoryName] = useState('');
  const [categoryType, setCategoryType] = useState<Exclude<FinanceTransactionType, 'transfer'>>('expense');
  const [saving, setSaving] = useState(false);

  async function addAccount() {
    if (!accountName.trim()) return;
    setSaving(true);
    try {
      await fetchAdmin('/api/admin/finance/accounts', {
        method: 'POST',
        body: JSON.stringify({ name: accountName, account_type: accountType }),
      });
      setAccountName('');
      toast.success('Account added');
      onChanged();
    } catch (error) {
      showApiError(error);
    } finally {
      setSaving(false);
    }
  }

  async function updateAccount(account: FinanceAccount, updates: Partial<FinanceAccount>) {
    try {
      await fetchAdmin(`/api/admin/finance/accounts/${account.id}`, {
        method: 'PATCH',
        body: JSON.stringify(updates),
      });
      onChanged();
    } catch (error) {
      showApiError(error);
    }
  }

  async function addCategory() {
    if (!categoryName.trim()) return;
    setSaving(true);
    try {
      await fetchAdmin('/api/admin/finance/categories', {
        method: 'POST',
        body: JSON.stringify({ name: categoryName, transaction_type: categoryType }),
      });
      setCategoryName('');
      toast.success('Category added');
      onChanged();
    } catch (error) {
      showApiError(error);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle>Finance settings</DialogTitle></DialogHeader>
        <section className="space-y-3">
          <div>
            <h3 className="font-medium">Accounts</h3>
            <p className="text-xs text-muted-foreground">Where BGC money is received or spent.</p>
          </div>
          <div className="space-y-2">
            {accounts.map((account) => (
              <div key={account.id} className="flex items-center gap-2 rounded-md border p-2">
                <div className="min-w-0 flex-1">
                  <div className="font-medium truncate">{account.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {account.account_type}{account.is_default ? ' · default for guest confirmations' : ''}
                  </div>
                </div>
                {!account.is_default && account.is_active && (
                  <Button variant="outline" size="sm" onClick={() => updateAccount(account, { is_default: true })}>
                    Make default
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => updateAccount(account, { is_active: !account.is_active, ...(account.is_default ? { is_default: false } : {}) })}
                >
                  {account.is_active ? 'Archive' : 'Restore'}
                </Button>
              </div>
            ))}
          </div>
          <div className="grid gap-2 sm:grid-cols-[1fr_160px_auto]">
            <div><Label>New account</Label><Input value={accountName} onChange={(event) => setAccountName(event.target.value)} /></div>
            <div>
              <Label>Type</Label>
              <Select value={accountType} onValueChange={(value) => setAccountType(value as FinanceAccount['account_type'])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="person">Person</SelectItem>
                  <SelectItem value="bank">Bank</SelectItem>
                  <SelectItem value="upi">UPI</SelectItem>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button className="self-end" onClick={addAccount} disabled={saving || !accountName.trim()}>Add</Button>
          </div>
        </section>

        <section className="space-y-3 border-t pt-4">
          <div>
            <h3 className="font-medium">Categories</h3>
            <p className="text-xs text-muted-foreground">Existing categories stay available for historical reporting.</p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {categories.map((category) => (
              <span key={category.id} className="rounded-full border px-2 py-1 text-xs">
                {category.name} · {category.transaction_type}
              </span>
            ))}
          </div>
          <div className="grid gap-2 sm:grid-cols-[1fr_140px_auto]">
            <div><Label>New category</Label><Input value={categoryName} onChange={(event) => setCategoryName(event.target.value)} /></div>
            <div>
              <Label>For</Label>
              <Select value={categoryType} onValueChange={(value) => setCategoryType(value as 'income' | 'expense')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="expense">Expenses</SelectItem>
                  <SelectItem value="income">Income</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button className="self-end" onClick={addCategory} disabled={saving || !categoryName.trim()}>Add</Button>
          </div>
        </section>
      </DialogContent>
    </Dialog>
  );
}
