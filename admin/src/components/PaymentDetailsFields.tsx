import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { FinanceAccount, FinancePaymentMethod } from '@/lib/types';

export interface PaymentDetailsValue {
  payment_account_id: string;
  paid_at: string;
  payment_method: FinancePaymentMethod;
}

interface Props {
  accounts: FinanceAccount[];
  value: PaymentDetailsValue;
  onChange: (value: PaymentDetailsValue) => void;
  disabled?: boolean;
}

export function PaymentDetailsFields({ accounts, value, onChange, disabled }: Props) {
  const activeAccounts = accounts.filter((account) => account.is_active);
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <div>
        <Label>Received in</Label>
        <Select
          value={value.payment_account_id}
          onValueChange={(payment_account_id) => onChange({ ...value, payment_account_id })}
          disabled={disabled}
        >
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
        <Label>Payment date</Label>
        <Input
          type="date"
          value={value.paid_at}
          onChange={(event) => onChange({ ...value, paid_at: event.target.value })}
          disabled={disabled}
        />
      </div>
      <div>
        <Label>Payment method</Label>
        <Select
          value={value.payment_method}
          onValueChange={(payment_method) => onChange({
            ...value,
            payment_method: payment_method as FinancePaymentMethod,
          })}
          disabled={disabled}
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
    </div>
  );
}
