import type { Env } from '../index';
import { getSupabase } from '../supabase';
import { jsonResponse } from '../validation';
import { toCsv } from './csv';

export type FinanceTransactionType = 'income' | 'expense' | 'transfer';
export type FinancePaymentMethod = 'upi' | 'cash' | 'bank_transfer' | 'card' | 'other';

export interface FinanceTransactionInput {
  transaction_type?: FinanceTransactionType;
  occurred_on?: string;
  amount?: number;
  title?: string;
  category_id?: string | null;
  from_account_id?: string | null;
  to_account_id?: string | null;
  payment_method?: FinancePaymentMethod | null;
  event_id?: string | null;
  registration_id?: string | null;
  guild_member_id?: string | null;
  corporate_event_id?: string | null;
  game_id?: string | null;
  notes?: string | null;
  receipt_url?: string | null;
}

interface FinanceImportRow extends FinanceTransactionInput {
  source_row?: number;
  account_name?: string;
  from_account_name?: string;
  to_account_name?: string;
  category_name?: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PAYMENT_METHODS = ['upi', 'cash', 'bank_transfer', 'card', 'other'];
const TRANSACTION_TYPES = ['income', 'expense', 'transfer'];
const ACCOUNT_TYPES = ['person', 'bank', 'upi', 'cash', 'other'];

const TRANSACTION_FIELDS = [
  'transaction_type',
  'occurred_on',
  'amount',
  'title',
  'category_id',
  'from_account_id',
  'to_account_id',
  'payment_method',
  'event_id',
  'registration_id',
  'guild_member_id',
  'corporate_event_id',
  'game_id',
  'notes',
  'receipt_url',
] as const;

const TRANSACTION_SELECT = [
  '*',
  'category:finance_categories(id,name,transaction_type)',
  'from_account:finance_accounts!finance_transactions_from_account_id_fkey(id,name,account_type)',
  'to_account:finance_accounts!finance_transactions_to_account_id_fkey(id,name,account_type)',
  'event:events(id,name)',
  'corporate_event:corporate_events(id,company_name,title)',
  'game:games(id,title)',
].join(',');

function isIsoDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function trimmedOrNull(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function pickTransactionFields(body: Record<string, unknown>): FinanceTransactionInput {
  const out: Record<string, unknown> = {};
  for (const field of TRANSACTION_FIELDS) {
    if (field in body) out[field] = body[field];
  }
  return out as FinanceTransactionInput;
}

export function validateFinanceTransaction(
  input: FinanceTransactionInput,
  requireAll: boolean,
): string | null {
  if (requireAll || 'transaction_type' in input) {
    if (!TRANSACTION_TYPES.includes(input.transaction_type || '')) {
      return 'Transaction type must be income, expense, or transfer';
    }
  }
  if (requireAll || 'occurred_on' in input) {
    if (
      typeof input.occurred_on !== 'string'
      || !isIsoDate(input.occurred_on)
    ) {
      return 'Date must be a valid YYYY-MM-DD date';
    }
  }
  if (requireAll || 'amount' in input) {
    if (typeof input.amount !== 'number' || !Number.isInteger(input.amount) || input.amount <= 0) {
      return 'Amount must be a whole number greater than zero';
    }
  }
  if (requireAll || 'title' in input) {
    if (typeof input.title !== 'string' || input.title.trim().length < 1 || input.title.trim().length > 200) {
      return 'Title is required and must be 200 characters or fewer';
    }
  }
  if ('payment_method' in input && input.payment_method !== null) {
    if (!PAYMENT_METHODS.includes(input.payment_method || '')) {
      return 'Payment method must be UPI, cash, bank transfer, card, or other';
    }
  }

  if (!requireAll) return null;

  if (input.transaction_type === 'income') {
    if (!input.to_account_id) return 'Received-in account is required for income';
    if (input.from_account_id) return 'Income cannot have a paid-from account';
    if (!input.category_id) return 'Category is required for income';
  }
  if (input.transaction_type === 'expense') {
    if (!input.from_account_id) return 'Paid-from account is required for an expense';
    if (input.to_account_id) return 'Expense cannot have a received-in account';
    if (!input.category_id) return 'Category is required for an expense';
  }
  if (input.transaction_type === 'transfer') {
    if (!input.from_account_id || !input.to_account_id) {
      return 'Both from and to accounts are required for a transfer';
    }
    if (input.from_account_id === input.to_account_id) {
      return 'Transfer accounts must be different';
    }
    if (input.category_id) return 'Transfers do not use an income or expense category';
  }
  return null;
}

function normalizeTransaction(input: FinanceTransactionInput): FinanceTransactionInput {
  const out: FinanceTransactionInput = { ...input };
  if ('title' in input) out.title = typeof input.title === 'string' ? input.title.trim() : input.title;
  if ('notes' in input) out.notes = trimmedOrNull(input.notes, 4000);
  if ('receipt_url' in input) out.receipt_url = trimmedOrNull(input.receipt_url, 1000);
  if ('category_id' in input) out.category_id = input.category_id || null;
  if ('from_account_id' in input) out.from_account_id = input.from_account_id || null;
  if ('to_account_id' in input) out.to_account_id = input.to_account_id || null;
  if ('payment_method' in input) out.payment_method = input.payment_method || null;
  if ('event_id' in input) out.event_id = input.event_id || null;
  if ('registration_id' in input) out.registration_id = input.registration_id || null;
  if ('guild_member_id' in input) out.guild_member_id = input.guild_member_id || null;
  if ('corporate_event_id' in input) out.corporate_event_id = input.corporate_event_id || null;
  if ('game_id' in input) out.game_id = input.game_id || null;
  return out;
}

async function validateReferences(
  input: FinanceTransactionInput,
  env: Env,
): Promise<string | null> {
  const supabase = getSupabase(env);
  const accountIds = [...new Set([input.from_account_id, input.to_account_id].filter(Boolean))] as string[];
  if (accountIds.length > 0) {
    const { data, error } = await supabase
      .from('finance_accounts')
      .select('id,is_active')
      .in('id', accountIds);
    if (error || !data || data.length !== accountIds.length) return 'Choose a valid finance account';
    if (data.some((account) => !account.is_active)) return 'Choose an active finance account';
  }

  if (input.category_id) {
    const { data, error } = await supabase
      .from('finance_categories')
      .select('id,transaction_type,is_active')
      .eq('id', input.category_id)
      .maybeSingle();
    if (error || !data) return 'Choose a valid category';
    if (!data.is_active) return 'Choose an active category';
    if (data.transaction_type !== input.transaction_type) {
      return `Choose a ${input.transaction_type} category`;
    }
  }
  return null;
}

export async function handleFinanceBootstrap(env: Env): Promise<Response> {
  const supabase = getSupabase(env);
  const [accountsResult, categoriesResult] = await Promise.all([
    supabase.from('finance_accounts').select('*').order('is_active', { ascending: false }).order('name'),
    supabase.from('finance_categories').select('*').order('transaction_type').order('name'),
  ]);
  if (accountsResult.error || categoriesResult.error) {
    return jsonResponse({ error: 'Failed to load finance settings' }, 500);
  }
  return jsonResponse({
    accounts: accountsResult.data || [],
    categories: categoriesResult.data || [],
  });
}

export async function handleCreateFinanceAccount(
  request: Request,
  env: Env,
): Promise<Response> {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return jsonResponse({ error: 'Invalid request body' }, 400);
  const name = trimmedOrNull(body.name, 100);
  if (!name) return jsonResponse({ error: 'Account name is required' }, 400);
  const accountType = typeof body.account_type === 'string' ? body.account_type : 'person';
  if (!ACCOUNT_TYPES.includes(accountType)) {
    return jsonResponse({ error: 'Choose a valid account type' }, 400);
  }
  const isDefault = body.is_default === true;
  const supabase = getSupabase(env);
  const { data, error } = await supabase
    .from('finance_accounts')
    .insert({
      name,
      account_type: accountType,
      is_default: isDefault,
    })
    .select('*')
    .single();
  if (error) {
    const duplicate = String(error.message || '').toLowerCase().includes('duplicate');
    return jsonResponse({ error: duplicate ? 'An account with this name already exists' : 'Failed to create account' }, duplicate ? 409 : 500);
  }
  return jsonResponse({ account: data }, 201);
}

export async function handleUpdateFinanceAccount(
  id: string,
  request: Request,
  env: Env,
): Promise<Response> {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return jsonResponse({ error: 'Invalid request body' }, 400);
  const updates: Record<string, unknown> = {};
  if ('name' in body) {
    const name = trimmedOrNull(body.name, 100);
    if (!name) return jsonResponse({ error: 'Account name is required' }, 400);
    updates.name = name;
  }
  if ('account_type' in body) {
    if (typeof body.account_type !== 'string' || !ACCOUNT_TYPES.includes(body.account_type)) {
      return jsonResponse({ error: 'Choose a valid account type' }, 400);
    }
    updates.account_type = body.account_type;
  }
  if ('is_active' in body) {
    if (typeof body.is_active !== 'boolean') return jsonResponse({ error: 'Active must be true or false' }, 400);
    updates.is_active = body.is_active;
  }
  if ('is_default' in body) {
    if (typeof body.is_default !== 'boolean') return jsonResponse({ error: 'Default must be true or false' }, 400);
    updates.is_default = body.is_default;
  }
  if (Object.keys(updates).length === 0) return jsonResponse({ error: 'No fields to update' }, 400);
  updates.updated_at = new Date().toISOString();

  const supabase = getSupabase(env);
  const { data, error } = await supabase
    .from('finance_accounts')
    .update(updates)
    .eq('id', id)
    .select('*')
    .maybeSingle();
  if (error) return jsonResponse({ error: 'Failed to update account' }, 500);
  if (!data) return jsonResponse({ error: 'Account not found' }, 404);
  return jsonResponse({ account: data });
}

export async function handleCreateFinanceCategory(
  request: Request,
  env: Env,
): Promise<Response> {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return jsonResponse({ error: 'Invalid request body' }, 400);
  const name = trimmedOrNull(body.name, 100);
  if (!name) return jsonResponse({ error: 'Category name is required' }, 400);
  if (body.transaction_type !== 'income' && body.transaction_type !== 'expense') {
    return jsonResponse({ error: 'Category must be for income or expenses' }, 400);
  }
  const supabase = getSupabase(env);
  const { data, error } = await supabase
    .from('finance_categories')
    .insert({ name, transaction_type: body.transaction_type })
    .select('*')
    .single();
  if (error) {
    const duplicate = String(error.message || '').toLowerCase().includes('duplicate');
    return jsonResponse({ error: duplicate ? 'That category already exists' : 'Failed to create category' }, duplicate ? 409 : 500);
  }
  return jsonResponse({ category: data }, 201);
}

export async function handleListFinanceTransactions(
  url: URL,
  env: Env,
): Promise<Response> {
  const supabase = getSupabase(env);
  let query = supabase
    .from('finance_transactions')
    .select(TRANSACTION_SELECT)
    .order('occurred_on', { ascending: false })
    .order('created_at', { ascending: false });

  const type = url.searchParams.get('type');
  const accountId = url.searchParams.get('account_id');
  const categoryId = url.searchParams.get('category_id');
  const eventId = url.searchParams.get('event_id');
  const dateFrom = url.searchParams.get('date_from');
  const dateTo = url.searchParams.get('date_to');
  const includeVoided = url.searchParams.get('include_voided') === 'true';
  const requestedLimit = Number(url.searchParams.get('limit') || 500);
  const limit = Math.min(Math.max(Number.isFinite(requestedLimit) ? requestedLimit : 500, 1), 1000);

  if (type && TRANSACTION_TYPES.includes(type)) query = query.eq('transaction_type', type);
  if (accountId) query = query.or(`from_account_id.eq.${accountId},to_account_id.eq.${accountId}`);
  if (categoryId) query = query.eq('category_id', categoryId);
  if (eventId) query = query.eq('event_id', eventId);
  if (dateFrom && DATE_RE.test(dateFrom)) query = query.gte('occurred_on', dateFrom);
  if (dateTo && DATE_RE.test(dateTo)) query = query.lte('occurred_on', dateTo);
  if (!includeVoided) query = query.is('voided_at', null);

  const { data, error } = await query.limit(limit);
  if (error) {
    console.error('[finance] list failed', error);
    return jsonResponse({ error: 'Failed to load transactions' }, 500);
  }
  return jsonResponse({ transactions: data || [] });
}

export async function handleGetFinanceTransaction(
  id: string,
  env: Env,
): Promise<Response> {
  const supabase = getSupabase(env);
  const [{ data, error }, historyResult] = await Promise.all([
    supabase.from('finance_transactions').select(TRANSACTION_SELECT).eq('id', id).maybeSingle(),
    supabase.from('finance_transaction_history').select('*').eq('transaction_id', id).order('created_at', { ascending: false }),
  ]);
  if (error) return jsonResponse({ error: 'Failed to load transaction' }, 500);
  if (!data) return jsonResponse({ error: 'Transaction not found' }, 404);
  return jsonResponse({ transaction: data, history: historyResult.data || [] });
}

export async function handleCreateFinanceTransaction(
  request: Request,
  env: Env,
  adminEmail: string,
): Promise<Response> {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return jsonResponse({ error: 'Invalid request body' }, 400);
  const input = normalizeTransaction(pickTransactionFields(body));
  const validationError = validateFinanceTransaction(input, true);
  if (validationError) return jsonResponse({ error: validationError }, 400);
  const referenceError = await validateReferences(input, env);
  if (referenceError) return jsonResponse({ error: referenceError }, 400);

  const supabase = getSupabase(env);
  const { data, error } = await supabase
    .from('finance_transactions')
    .insert({
      ...input,
      source: 'manual',
      created_by: adminEmail,
    })
    .select(TRANSACTION_SELECT)
    .single();
  if (error) {
    console.error('[finance] create failed', error);
    return jsonResponse({ error: 'Failed to create transaction' }, 500);
  }
  return jsonResponse({ transaction: data }, 201);
}

export async function handleUpdateFinanceTransaction(
  id: string,
  request: Request,
  env: Env,
  adminEmail: string,
): Promise<Response> {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return jsonResponse({ error: 'Invalid request body' }, 400);
  const updates = normalizeTransaction(pickTransactionFields(body));
  if (Object.keys(updates).length === 0) return jsonResponse({ error: 'No fields to update' }, 400);

  const supabase = getSupabase(env);
  const { data: existing, error: existingError } = await supabase
    .from('finance_transactions')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (existingError) return jsonResponse({ error: 'Failed to load transaction' }, 500);
  if (!existing) return jsonResponse({ error: 'Transaction not found' }, 404);
  if (existing.voided_at) return jsonResponse({ error: 'Restore this transaction before editing it' }, 409);
  if (existing.source === 'registration' || existing.source === 'guild') {
    return jsonResponse({ error: 'Edit the linked registration or Guild membership instead' }, 409);
  }

  const merged = { ...existing, ...updates } as FinanceTransactionInput;
  const validationError = validateFinanceTransaction(merged, true);
  if (validationError) return jsonResponse({ error: validationError }, 400);
  const referenceError = await validateReferences(merged, env);
  if (referenceError) return jsonResponse({ error: referenceError }, 400);

  const { data, error } = await supabase
    .from('finance_transactions')
    .update({
      ...updates,
      updated_by: adminEmail,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select(TRANSACTION_SELECT)
    .maybeSingle();
  if (error) return jsonResponse({ error: 'Failed to update transaction' }, 500);
  return jsonResponse({ transaction: data });
}

export async function handleVoidFinanceTransaction(
  id: string,
  request: Request,
  env: Env,
  adminEmail: string,
): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { reason?: unknown; restore?: unknown } | null;
  if (!body) return jsonResponse({ error: 'Invalid request body' }, 400);
  const supabase = getSupabase(env);
  const { data: existing, error: existingError } = await supabase
    .from('finance_transactions')
    .select('id,source')
    .eq('id', id)
    .maybeSingle();
  if (existingError) return jsonResponse({ error: 'Failed to load transaction' }, 500);
  if (!existing) return jsonResponse({ error: 'Transaction not found' }, 404);
  if (existing.source === 'registration' || existing.source === 'guild') {
    return jsonResponse({ error: 'Change the linked registration or Guild membership instead' }, 409);
  }

  if (body.restore === true) {
    const { data, error } = await supabase
      .from('finance_transactions')
      .update({
        voided_at: null,
        voided_by: null,
        void_reason: null,
        updated_by: adminEmail,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select(TRANSACTION_SELECT)
      .maybeSingle();
    if (error) return jsonResponse({ error: 'Failed to restore transaction' }, 500);
    if (!data) return jsonResponse({ error: 'Transaction not found' }, 404);
    return jsonResponse({ transaction: data });
  }

  const reason = trimmedOrNull(body.reason, 500);
  if (!reason) return jsonResponse({ error: 'Explain why this transaction is being voided' }, 400);
  const { data, error } = await supabase
    .from('finance_transactions')
    .update({
      voided_at: new Date().toISOString(),
      voided_by: adminEmail,
      void_reason: reason,
      updated_by: adminEmail,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .is('voided_at', null)
    .select(TRANSACTION_SELECT)
    .maybeSingle();
  if (error) return jsonResponse({ error: 'Failed to void transaction' }, 500);
  if (!data) return jsonResponse({ error: 'Transaction not found or already voided' }, 404);
  return jsonResponse({ transaction: data });
}

async function fetchAllPages<T>(
  makeQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<{ rows: T[]; error: unknown }> {
  const rows: T[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const result = await makeQuery(from, from + pageSize - 1);
    if (result.error) return { rows, error: result.error };
    const page = result.data || [];
    rows.push(...page);
    if (page.length < pageSize) return { rows, error: null };
  }
}

export async function handleFinanceSummary(url: URL, env: Env): Promise<Response> {
  const dateFrom = url.searchParams.get('date_from');
  const dateTo = url.searchParams.get('date_to');
  if (dateFrom && !DATE_RE.test(dateFrom)) return jsonResponse({ error: 'Invalid start date' }, 400);
  if (dateTo && !DATE_RE.test(dateTo)) return jsonResponse({ error: 'Invalid end date' }, 400);

  const supabase = getSupabase(env);
  const periodResult = await fetchAllPages<any>((from, to) => {
    let query = supabase
      .from('finance_transactions')
      .select(TRANSACTION_SELECT)
      .is('voided_at', null)
      .order('occurred_on', { ascending: false });
    if (dateFrom) query = query.gte('occurred_on', dateFrom);
    if (dateTo) query = query.lte('occurred_on', dateTo);
    return query.range(from, to);
  });
  if (periodResult.error) return jsonResponse({ error: 'Failed to calculate finance summary' }, 500);

  const allTimeResult = await fetchAllPages<any>((from, to) =>
    supabase
      .from('finance_transactions')
      .select('transaction_type,amount,from_account_id,to_account_id')
      .is('voided_at', null)
      .range(from, to)
  );
  if (allTimeResult.error) return jsonResponse({ error: 'Failed to calculate account balances' }, 500);

  const [accountsResult, registrationsResult, guildResult, reconciliationLinksResult] = await Promise.all([
    supabase.from('finance_accounts').select('*').order('name'),
    supabase
      .from('registrations')
      .select('id,name,total_amount,event_id,created_at,events(name)')
      .eq('payment_status', 'confirmed')
      .gt('total_amount', 0)
      .is('payment_account_id', null)
      .order('created_at', { ascending: false })
      .limit(500),
    supabase
      .from('guild_path_members')
      .select('id,amount,tier,starts_at,users(name)')
      .eq('status', 'paid')
      .gt('amount', 0)
      .is('payment_account_id', null)
      .order('starts_at', { ascending: false })
      .limit(500),
    supabase
      .from('finance_reconciliation_links')
      .select('source_type,source_id'),
  ]);
  if (accountsResult.error) return jsonResponse({ error: 'Failed to load account balances' }, 500);
  if (registrationsResult.error || guildResult.error || reconciliationLinksResult.error) {
    return jsonResponse({ error: 'Failed to load legacy payment reconciliation' }, 500);
  }

  const reconciledRegistrations = new Set(
    (reconciliationLinksResult.data || [])
      .filter((link) => link.source_type === 'registration')
      .map((link) => link.source_id),
  );
  const reconciledGuildMembers = new Set(
    (reconciliationLinksResult.data || [])
      .filter((link) => link.source_type === 'guild')
      .map((link) => link.source_id),
  );
  const untrackedRegistrations = (registrationsResult.data || [])
    .filter((registration) => !reconciledRegistrations.has(registration.id))
    .slice(0, 50);
  const untrackedGuildMembers = (guildResult.data || [])
    .filter((member) => !reconciledGuildMembers.has(member.id))
    .slice(0, 50);

  const creditResult = await fetchAllPages<{ amount: number }>((from, to) =>
    supabase.from('user_credits').select('amount').range(from, to)
  );

  let income = 0;
  let expenses = 0;
  const categorySpend = new Map<string, number>();
  const eventProfit = new Map<string, { event_id: string; event_name: string; income: number; expenses: number }>();
  const monthly = new Map<string, { month: string; income: number; expenses: number }>();

  for (const row of periodResult.rows) {
    if (row.transaction_type === 'income') income += row.amount;
    if (row.transaction_type === 'expense') expenses += row.amount;
    if (row.transaction_type === 'expense' && row.category?.name) {
      categorySpend.set(row.category.name, (categorySpend.get(row.category.name) || 0) + row.amount);
    }
    const month = String(row.occurred_on).slice(0, 7);
    const monthlyRow = monthly.get(month) || { month, income: 0, expenses: 0 };
    if (row.transaction_type === 'income') monthlyRow.income += row.amount;
    if (row.transaction_type === 'expense') monthlyRow.expenses += row.amount;
    monthly.set(month, monthlyRow);

    if (row.event_id && row.transaction_type !== 'transfer') {
      const current = eventProfit.get(row.event_id) || {
        event_id: row.event_id,
        event_name: row.event?.name || 'Event',
        income: 0,
        expenses: 0,
      };
      if (row.transaction_type === 'income') current.income += row.amount;
      if (row.transaction_type === 'expense') current.expenses += row.amount;
      eventProfit.set(row.event_id, current);
    }
  }

  const balances = new Map<string, number>();
  for (const account of accountsResult.data || []) balances.set(account.id, 0);
  for (const row of allTimeResult.rows) {
    if (row.to_account_id) balances.set(row.to_account_id, (balances.get(row.to_account_id) || 0) + row.amount);
    if (row.from_account_id) balances.set(row.from_account_id, (balances.get(row.from_account_id) || 0) - row.amount);
  }

  return jsonResponse({
    totals: {
      income,
      expenses,
      surplus: income - expenses,
      outstanding_credits: creditResult.error
        ? null
        : creditResult.rows.reduce((sum, row) => sum + Number(row.amount || 0), 0),
    },
    account_balances: (accountsResult.data || []).map((account) => ({
      ...account,
      balance: balances.get(account.id) || 0,
    })),
    category_spend: [...categorySpend.entries()]
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount),
    monthly: [...monthly.values()].sort((a, b) => a.month.localeCompare(b.month)),
    event_profit: [...eventProfit.values()]
      .map((event) => ({ ...event, surplus: event.income - event.expenses }))
      .sort((a, b) => b.income - a.income),
    untracked: {
      registrations: untrackedRegistrations,
      guild_members: untrackedGuildMembers,
    },
    recent_transactions: periodResult.rows.slice(0, 10),
  });
}

export async function handleImportFinanceTransactions(
  request: Request,
  env: Env,
  adminEmail: string,
): Promise<Response> {
  const body = (await request.json().catch(() => null)) as
    | { source_name?: unknown; source_sha256?: unknown; rows?: unknown }
    | null;
  if (!body || !Array.isArray(body.rows)) return jsonResponse({ error: 'Invalid import payload' }, 400);
  const sourceName = trimmedOrNull(body.source_name, 200);
  const sourceHash = typeof body.source_sha256 === 'string' ? body.source_sha256.toLowerCase() : '';
  if (!sourceName) return jsonResponse({ error: 'Import source name is required' }, 400);
  if (!/^[a-f0-9]{64}$/.test(sourceHash)) return jsonResponse({ error: 'Import checksum is invalid' }, 400);
  if (body.rows.length < 1 || body.rows.length > 1000) {
    return jsonResponse({ error: 'Import must contain between 1 and 1,000 rows' }, 400);
  }

  const supabase = getSupabase(env);
  const [accountsResult, categoriesResult, duplicateResult] = await Promise.all([
    supabase.from('finance_accounts').select('id,name,is_active'),
    supabase.from('finance_categories').select('id,name,transaction_type,is_active'),
    supabase.from('finance_import_batches').select('id').eq('source_sha256', sourceHash).maybeSingle(),
  ]);
  if (duplicateResult.data) return jsonResponse({ error: 'This exact file has already been imported' }, 409);
  if (accountsResult.error || categoriesResult.error) return jsonResponse({ error: 'Failed to prepare import' }, 500);

  const accounts = new Map((accountsResult.data || []).map((row) => [row.name.trim().toLowerCase(), row]));
  const categories = new Map((categoriesResult.data || []).map((row) => [`${row.transaction_type}:${row.name.trim().toLowerCase()}`, row]));
  const normalizedRows: Array<Record<string, unknown>> = [];
  const errors: Array<{ row: number; error: string }> = [];

  for (let index = 0; index < body.rows.length; index++) {
    const raw = body.rows[index] as FinanceImportRow;
    const sourceRow = Number.isInteger(raw.source_row) ? raw.source_row! : index + 2;
    const type = raw.transaction_type;
    const accountName = trimmedOrNull(raw.account_name, 100)?.toLowerCase();
    const fromName = trimmedOrNull(raw.from_account_name, 100)?.toLowerCase();
    const toName = trimmedOrNull(raw.to_account_name, 100)?.toLowerCase();
    const categoryName = trimmedOrNull(raw.category_name, 100)?.toLowerCase();

    const resolved: FinanceTransactionInput = normalizeTransaction({
      ...pickTransactionFields(raw as unknown as Record<string, unknown>),
      from_account_id: type === 'expense'
        ? accounts.get(accountName || '')?.id
        : type === 'transfer' ? accounts.get(fromName || '')?.id : null,
      to_account_id: type === 'income'
        ? accounts.get(accountName || '')?.id
        : type === 'transfer' ? accounts.get(toName || '')?.id : null,
      category_id: type === 'transfer'
        ? null
        : categories.get(`${type}:${categoryName || ''}`)?.id,
    });
    const error = validateFinanceTransaction(resolved, true);
    if (error) {
      errors.push({ row: sourceRow, error });
      continue;
    }
    normalizedRows.push({
      ...resolved,
      source: 'import',
      source_key: `import:${sourceHash}:${sourceRow}`,
      source_row: sourceRow,
      created_by: adminEmail,
    });
  }

  if (errors.length > 0) return jsonResponse({ error: 'Some rows need attention', row_errors: errors }, 400);
  const controlTotal = normalizedRows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const { data: batchId, error: importError } = await supabase.rpc('finance_import_transactions', {
    p_source_name: sourceName,
    p_source_sha256: sourceHash,
    p_control_total: controlTotal,
    p_imported_by: adminEmail,
    p_rows: normalizedRows,
  });
  if (importError || !batchId) {
    const duplicate = importError?.code === '23505';
    console.error('[finance] import failed', importError);
    if (duplicate) return jsonResponse({ error: 'This exact file has already been imported' }, 409);
    return jsonResponse({ error: 'Import failed; no rows were added' }, 500);
  }
  return jsonResponse({
    imported: normalizedRows.length,
    control_total: controlTotal,
    batch_id: batchId,
  }, 201);
}

export async function handleExportFinanceTransactions(
  request: Request,
  env: Env,
): Promise<Response> {
  const listResponse = await handleListFinanceTransactions(new URL(request.url), env);
  if (!listResponse.ok) return listResponse;
  const body = await listResponse.json() as { transactions: any[] };
  const rows = body.transactions.map((row) => ({
    date: row.occurred_on,
    type: row.transaction_type,
    title: row.title,
    amount: row.amount,
    category: row.category?.name || '',
    from_account: row.from_account?.name || '',
    to_account: row.to_account?.name || '',
    payment_method: row.payment_method || '',
    event: row.event?.name || '',
    notes: row.notes || '',
    source: row.source,
    receipt_url: row.receipt_url || '',
    created_by: row.created_by,
  }));
  const csv = toCsv(
    ['date', 'type', 'title', 'amount', 'category', 'from_account', 'to_account', 'payment_method', 'event', 'notes', 'source', 'receipt_url', 'created_by'],
    rows,
  );
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="bgc-finance.csv"',
      'Cache-Control': 'no-store',
    },
  });
}
