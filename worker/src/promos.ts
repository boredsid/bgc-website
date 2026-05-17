import type { SupabaseClient } from '@supabase/supabase-js';

export interface ActivePromo {
  id: string;
  remaining_uses: number;
  max_event_price: number;
  expires_at: string | null;
}

export async function getActivePromo(
  supabase: SupabaseClient,
  userId: string,
): Promise<ActivePromo | null> {
  const today = new Date().toISOString().split('T')[0];
  const { data } = await supabase
    .from('user_promos')
    .select('id, remaining_uses, max_event_price, expires_at')
    .eq('user_id', userId)
    .gt('remaining_uses', 0)
    .or(`expires_at.is.null,expires_at.gte.${today}`)
    .order('expires_at', { ascending: true, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  return (data as ActivePromo | null) ?? null;
}

export async function getApplicablePromo(
  supabase: SupabaseClient,
  userId: string,
  eventPrice: number,
): Promise<ActivePromo | null> {
  const promo = await getActivePromo(supabase, userId);
  if (!promo) return null;
  if (eventPrice > promo.max_event_price) return null;
  return promo;
}

// Optimistically decrement remaining_uses by `uses`. Returns true on success,
// false if a concurrent write changed the count (caller should retry or skip).
export async function consumePromoUses(
  supabase: SupabaseClient,
  promo: ActivePromo,
  uses: number,
): Promise<boolean> {
  if (uses <= 0) return true;
  const next = promo.remaining_uses - uses;
  if (next < 0) return false;
  const { data, error } = await supabase
    .from('user_promos')
    .update({ remaining_uses: next })
    .eq('id', promo.id)
    .eq('remaining_uses', promo.remaining_uses)
    .select('id')
    .maybeSingle();
  if (error) {
    console.error('[promos] consume failed', error);
    return false;
  }
  return !!data;
}

// Restore `uses` back to the promo. Used on cancellation / reversal.
export async function restorePromoUses(
  supabase: SupabaseClient,
  promoId: string,
  uses: number,
): Promise<void> {
  if (uses <= 0) return;
  const { data: current } = await supabase
    .from('user_promos')
    .select('remaining_uses')
    .eq('id', promoId)
    .maybeSingle();
  if (!current) return;
  await supabase
    .from('user_promos')
    .update({ remaining_uses: current.remaining_uses + uses })
    .eq('id', promoId);
}
