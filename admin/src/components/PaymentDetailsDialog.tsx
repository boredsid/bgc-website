import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { PaymentDetailsFields, type PaymentDetailsValue } from './PaymentDetailsFields';
import { fetchAdmin, showApiError } from '@/lib/api';
import type { FinanceAccount, FinanceCategory } from '@/lib/types';

const LAST_ACCOUNT_KEY = 'admin.finance.lastAccountId';

interface Props {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  onConfirm: (value: PaymentDetailsValue) => Promise<void> | void;
  onCancel: () => void;
}

export function PaymentDetailsDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm payment',
  onConfirm,
  onCancel,
}: Props) {
  const [accounts, setAccounts] = useState<FinanceAccount[]>([]);
  const [value, setValue] = useState<PaymentDetailsValue>({
    payment_account_id: '',
    paid_at: new Date().toISOString().slice(0, 10),
    payment_method: 'upi',
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    fetchAdmin<{ accounts: FinanceAccount[]; categories: FinanceCategory[] }>('/api/admin/finance/bootstrap')
      .then((data) => {
        setAccounts(data.accounts);
        const remembered = localStorage.getItem(LAST_ACCOUNT_KEY);
        const account = data.accounts.find((item) => item.is_active && item.id === remembered)
          || data.accounts.find((item) => item.is_active && item.is_default)
          || null;
        setValue((current) => ({ ...current, payment_account_id: account?.id || '' }));
      })
      .catch(showApiError);
  }, [open]);

  async function confirm() {
    if (!value.payment_account_id || !value.paid_at) return;
    setSaving(true);
    try {
      localStorage.setItem(LAST_ACCOUNT_KEY, value.payment_account_id);
      await onConfirm(value);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !saving) onCancel(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
        <PaymentDetailsFields accounts={accounts} value={value} onChange={setValue} disabled={saving} />
        {accounts.length === 0 && (
          <p className="text-xs text-destructive">
            Add an active account in Finance before confirming a paid item.
          </p>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel} disabled={saving}>Cancel</Button>
          <Button
            onClick={confirm}
            disabled={saving || !value.payment_account_id || !value.paid_at}
          >
            {saving ? 'Saving…' : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
