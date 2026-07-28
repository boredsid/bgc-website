export interface CustomQuestionOption {
  value: string;
  capacity?: number;
  price?: number;
}

export interface CustomQuestion {
  id: string;
  label: string;
  type: 'select' | 'radio' | 'text' | 'checkbox';
  required: boolean;
  options?: CustomQuestionOption[];
}

export interface Event {
  id: string;
  name: string;
  description: string | null;
  date: string;
  venue_name: string | null;
  venue_area: string | null;
  price: number;
  capacity: number;
  custom_questions: CustomQuestion[] | null;
  price_includes: string | null;
  llm_notes: string | null;
  is_published: boolean;
  guild_path_exclusive: boolean;
  is_collaboration: boolean;
  externally_managed: boolean;
  external_registration_url: string | null;
  created_at: string;
}

export interface Game {
  id: string;
  title: string;
  player_count: string | null;
  max_players: number | null;
  avg_rating: number | null;
  weight: number | null;
  complexity: string | null;
  play_time: string | null;
  max_play_time: number | null;
  length: string | null;
  owned_by: string | null;
  currently_with: string | null;
}

export interface CorporateEvent {
  id: string;
  company_name: string;
  title: string | null;
  event_date: string;
  headcount: number | null;
  description: string | null;
  logo_url: string | null;
  testimonial: string | null;
  is_published: boolean;
  created_at: string;
}

export interface Registration {
  id: string;
  event_id: string;
  user_id: string | null;
  name: string;
  phone: string;
  email: string | null;
  seats: number;
  total_amount: number;
  discount_applied: string | null;
  custom_answers: Record<string, string | boolean> | null;
  payment_status: 'pending' | 'confirmed' | 'cancelled';
  plus_ones_consumed: number;
  credits_applied: number;
  source: string | null;
  payment_account_id: string | null;
  paid_at: string | null;
  payment_method: FinancePaymentMethod | null;
  payment_recorded_by: string | null;
  created_at: string;
}

export interface GuildMember {
  id: string;
  user_id: string;
  tier: 'initiate' | 'adventurer' | 'guildmaster';
  amount: number;
  status: 'pending' | 'paid' | 'cancelled';
  starts_at: string;
  expires_at: string;
  plus_ones_used: number;
  source: string | null;
  payment_account_id: string | null;
  paid_at: string | null;
  payment_method: FinancePaymentMethod | null;
  payment_recorded_by: string | null;
  user_name: string | null;
  user_phone: string;
  user_email: string | null;
}

export interface User {
  id: string;
  phone: string;
  name: string | null;
  email: string | null;
  first_registered_at: string;
  last_registered_at: string;
  source: string | null;
}

export type QuestionSummary =
  | { type: 'select' | 'radio'; counts: Record<string, number> }
  | { type: 'checkbox'; yes: number; no: number }
  | { type: 'text'; count: number; answers: string[] };

export interface SummaryCard {
  event: Event;
  totals: { pending: number; confirmed: number; cancelled: number };
  guild_member_count: number;
  capacity_used: number;
  custom_question_summary: Record<string, QuestionSummary>;
}

export type UserCreditReason =
  | 'cancellation'
  | 'cancellation_reversal'
  | 'registration_use'
  | 'guild_use'
  | 'admin_adjustment';

export interface UserCreditEntry {
  id: string;
  user_id: string;
  amount: number;
  reason: UserCreditReason;
  registration_id: string | null;
  guild_member_id: string | null;
  note: string | null;
  created_by: string | null;
  created_at: string;
}

export interface UserListItem extends User {
  credit_balance: number;
}

export interface UserDetail {
  user: User;
  credit_balance: number;
  credits: UserCreditEntry[];
}

export interface OwnerSummaryRow {
  owner: string | null;
  total: number;
  with_owner: number;
  with_others: number;
  top_holders: Array<{ name: string; count: number }>;
  more_holders: number;
}

export type FinanceTransactionType = 'income' | 'expense' | 'transfer';
export type FinancePaymentMethod = 'upi' | 'cash' | 'bank_transfer' | 'card' | 'other';

export interface FinanceAccount {
  id: string;
  name: string;
  account_type: 'person' | 'bank' | 'upi' | 'cash' | 'other';
  is_active: boolean;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface FinanceCategory {
  id: string;
  name: string;
  transaction_type: 'income' | 'expense';
  is_active: boolean;
  created_at: string;
}

export interface FinanceTransaction {
  id: string;
  transaction_type: FinanceTransactionType;
  occurred_on: string;
  amount: number;
  title: string;
  category_id: string | null;
  from_account_id: string | null;
  to_account_id: string | null;
  payment_method: FinancePaymentMethod | null;
  event_id: string | null;
  registration_id: string | null;
  guild_member_id: string | null;
  corporate_event_id: string | null;
  game_id: string | null;
  notes: string | null;
  receipt_url: string | null;
  source: 'manual' | 'registration' | 'guild' | 'import' | 'adjustment' | 'refund';
  source_key: string | null;
  source_row: number | null;
  created_by: string;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  voided_at: string | null;
  voided_by: string | null;
  void_reason: string | null;
  category?: Pick<FinanceCategory, 'id' | 'name' | 'transaction_type'> | null;
  from_account?: Pick<FinanceAccount, 'id' | 'name' | 'account_type'> | null;
  to_account?: Pick<FinanceAccount, 'id' | 'name' | 'account_type'> | null;
  event?: { id: string; name: string } | null;
  corporate_event?: { id: string; company_name: string; title: string | null } | null;
  game?: { id: string; title: string } | null;
}

export interface FinanceSummary {
  totals: {
    income: number;
    expenses: number;
    surplus: number;
    outstanding_credits: number | null;
  };
  account_balances: Array<FinanceAccount & { balance: number }>;
  category_spend: Array<{ category: string; amount: number }>;
  monthly: Array<{ month: string; income: number; expenses: number }>;
  event_profit: Array<{
    event_id: string;
    event_name: string;
    income: number;
    expenses: number;
    surplus: number;
  }>;
  untracked: {
    registrations: Array<{
      id: string;
      name: string;
      total_amount: number;
      event_id: string;
      created_at: string;
      events?: { name: string } | null;
    }>;
    guild_members: Array<{
      id: string;
      amount: number;
      tier: string;
      starts_at: string;
      users?: { name: string } | null;
    }>;
  };
  recent_transactions: FinanceTransaction[];
}
