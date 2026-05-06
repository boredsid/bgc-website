import type { SupabaseClient } from '@supabase/supabase-js';

export type CreditReason =
  | 'cancellation'
  | 'cancellation_reversal'
  | 'registration_use'
  | 'guild_use'
  | 'admin_adjustment';

export interface CreditEvent {
  user_id: string;
  amount: number;
  reason: CreditReason;
  registration_id?: string | null;
  guild_member_id?: string | null;
  note?: string | null;
  created_by?: string | null;
}

export async function getUserBalance(supabase: SupabaseClient, userId: string): Promise<number> {
  const { data, error } = await supabase
    .from('user_credits')
    .select('amount')
    .eq('user_id', userId);
  if (error || !data) return 0;
  return data.reduce((sum: number, r: { amount: number }) => sum + r.amount, 0);
}

export async function recordCreditEvent(
  supabase: SupabaseClient,
  event: CreditEvent,
): Promise<void> {
  const row = {
    user_id: event.user_id,
    amount: event.amount,
    reason: event.reason,
    registration_id: event.registration_id ?? null,
    guild_member_id: event.guild_member_id ?? null,
    note: event.note ?? null,
    created_by: event.created_by ?? null,
  };
  const { error } = await supabase.from('user_credits').insert(row);
  if (error) {
    console.error('[credits] insert failed', error);
    throw error;
  }
}

export async function applyCreditsToTotal(
  supabase: SupabaseClient,
  userId: string,
  totalAmount: number,
): Promise<{ creditsApplied: number; finalAmount: number }> {
  if (totalAmount <= 0) return { creditsApplied: 0, finalAmount: totalAmount };
  const balance = await getUserBalance(supabase, userId);
  const applied = Math.max(0, Math.min(balance, totalAmount));
  return { creditsApplied: applied, finalAmount: totalAmount - applied };
}
