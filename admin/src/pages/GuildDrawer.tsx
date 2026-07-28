import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FormDrawer } from '@/components/FormDrawer';
import { NumberInput } from '@/components/NumberInput';
import { PaymentDetailsFields } from '@/components/PaymentDetailsFields';
import { fetchAdmin, showApiError } from '@/lib/api';
import { validateGuildMember, type ValidationErrors } from '@/lib/validation';
import { toast } from 'sonner';
import type { GuildMember, FinanceAccount, FinanceCategory } from '@/lib/types';

export default function GuildDrawer() {
  const navigate = useNavigate();
  const { id } = useParams();
  const [m, setM] = useState<GuildMember | null>(null);
  const [initial, setInitial] = useState<GuildMember | null>(null);
  const [saving, setSaving] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [financeAccounts, setFinanceAccounts] = useState<FinanceAccount[]>([]);

  useEffect(() => {
    if (!id) return;
    fetchAdmin<{ member: GuildMember }>(`/api/admin/guild-members/${id}`)
      .then((r) => { setM(r.member); setInitial(r.member); })
      .catch(showApiError);
  }, [id]);

  useEffect(() => {
    fetchAdmin<{ accounts: FinanceAccount[]; categories: FinanceCategory[] }>('/api/admin/finance/bootstrap')
      .then((data) => setFinanceAccounts(data.accounts))
      .catch(showApiError);
  }, []);

  const errors: ValidationErrors = useMemo(() => validateGuildMember({
    tier: m?.tier,
    amount: m?.amount,
    status: m?.status,
    starts_at: m?.starts_at,
    expires_at: m?.expires_at,
    plus_ones_used: m?.plus_ones_used,
  }), [m]);
  const errorCount = Object.keys(errors).length;
  const dirty = useMemo(() => JSON.stringify(m) !== JSON.stringify(initial), [m, initial]);

  function close() { navigate('/guild'); }

  async function save() {
    if (!m) return;
    setShowErrors(true);
    if (errorCount > 0) {
      const first = Object.keys(errors)[0];
      const el = document.getElementById(`field-${first}`);
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el?.focus();
      return;
    }
    setSaving(true);
    setServerError(null);
    try {
      const payload = {
        tier: m.tier, amount: m.amount, status: m.status,
        starts_at: m.starts_at, expires_at: m.expires_at,
        plus_ones_used: m.plus_ones_used, source: m.source,
        payment_account_id: m.payment_account_id,
        paid_at: m.paid_at,
        payment_method: m.payment_method,
      };
      await fetchAdmin(`/api/admin/guild-members/${m.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
      toast.success('Guild member updated');
      navigate('/guild');
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setSaving(false);
    }
  }

  function set<K extends keyof GuildMember>(k: K, v: GuildMember[K]) {
    setM((x) => x ? { ...x, [k]: v } : x);
  }

  function field(key: string, label: string, control: React.ReactNode) {
    const err = showErrors ? errors[key] : undefined;
    return (
      <div id={`field-${key}`}>
        <Label className={err ? 'text-destructive' : undefined}>{label}</Label>
        {control}
        {err && <div className="text-xs text-destructive mt-1">{err}</div>}
      </div>
    );
  }

  return (
    <FormDrawer
      open
      title="Edit guild member"
      dirty={dirty}
      saving={saving}
      onCancel={close}
      onSave={save}
      errorCount={showErrors ? errorCount : 0}
      errorMessage={serverError}
    >
      {!m ? <p>Loading…</p> : (
        <div className="space-y-3">
          <div className="rounded-md bg-muted/40 p-3 text-sm">
            <div><span className="text-muted-foreground">Name:</span> {m.user_name || '—'}</div>
            <div><span className="text-muted-foreground">Phone:</span> {m.user_phone}</div>
            <div><span className="text-muted-foreground">Email:</span> {m.user_email || '—'}</div>
            <Link to={`/guild/${m.id}/user`} className="text-xs underline mt-1 inline-block">Edit user details</Link>
          </div>
          {field('tier', 'Tier', (
            <Select value={m.tier} onValueChange={(v) => set('tier', v as GuildMember['tier'])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="initiate">Initiate</SelectItem>
                <SelectItem value="adventurer">Adventurer</SelectItem>
                <SelectItem value="guildmaster">Guildmaster</SelectItem>
              </SelectContent>
            </Select>
          ))}
          {field('status', 'Status', (
            <Select
              value={m.status}
              onValueChange={(v) => {
                const status = v as GuildMember['status'];
                setM((current) => {
                  if (!current) return current;
                  if (status !== 'paid' || current.status === 'paid' || current.amount <= 0) {
                    return { ...current, status };
                  }
                  const remembered = localStorage.getItem('admin.finance.lastAccountId');
                  const account = financeAccounts.find((item) => item.is_active && item.id === remembered)
                    || financeAccounts.find((item) => item.is_active && item.is_default);
                  return {
                    ...current,
                    status,
                    payment_account_id: current.payment_account_id || account?.id || null,
                    paid_at: current.paid_at || new Date().toISOString().slice(0, 10),
                    payment_method: current.payment_method || 'upi',
                  };
                });
              }}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="paid">Paid</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
          ))}
          {m.status === 'paid' && m.amount > 0 && (
            <div className="rounded-md border bg-muted/30 p-3">
              <div className="text-sm font-medium mb-2">Payment details</div>
              <PaymentDetailsFields
                accounts={financeAccounts}
                value={{
                  payment_account_id: m.payment_account_id || '',
                  paid_at: m.paid_at?.slice(0, 10) || '',
                  payment_method: m.payment_method || 'upi',
                }}
                onChange={(value) => {
                  setM((current) => current ? { ...current, ...value } : current);
                  if (value.payment_account_id) {
                    localStorage.setItem('admin.finance.lastAccountId', value.payment_account_id);
                  }
                }}
              />
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            {field('starts_at', 'Starts at', (
              <Input type="date" value={m.starts_at} onChange={(e) => set('starts_at', e.target.value)} />
            ))}
            {field('expires_at', 'Expires at', (
              <Input type="date" value={m.expires_at} onChange={(e) => set('expires_at', e.target.value)} />
            ))}
            {field('amount', 'Amount (₹)', (
              <NumberInput
                value={m.amount}
                onChange={(n) => set('amount', n ?? 0)}
                allowRupees
                aria-label="Amount"
              />
            ))}
            {field('plus_ones_used', 'Plus-ones used', (
              <NumberInput
                value={m.plus_ones_used}
                onChange={(n) => set('plus_ones_used', n ?? 0)}
                aria-label="Plus-ones used"
              />
            ))}
          </div>
        </div>
      )}
    </FormDrawer>
  );
}
