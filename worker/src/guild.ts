import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Far-future expiry stamped on memberships that never lapse (community hosts).
 *
 * Every "is this membership active?" query in the codebase filters on
 * `expires_at >= today`. Rather than teach all of them about a NULL expiry, a
 * never-expiring membership carries this sentinel and sets `never_expires`,
 * which is the column the UI and exports read for display.
 */
export const NEVER_EXPIRES_DATE = '2999-12-31';

/** `guild_path_members.source` for the free membership that comes with hosting. */
export const COMMUNITY_HOST_SOURCE = 'community_host';

/** Free Initiate is the floor a community host always sits on. */
export const COMMUNITY_HOST_TIER = 'initiate';

const TIER_RANK: Record<string, number> = { initiate: 1, adventurer: 2, guildmaster: 3 };

export interface MembershipRow {
  id: string;
  tier: string;
  expires_at: string;
  plus_ones_used: number;
  never_expires?: boolean | null;
  source?: string | null;
}

/**
 * Pick the membership that should apply, out of everything currently active.
 *
 * Community hosts made multiple concurrent memberships a real case: the free
 * never-expiring Initiate row sits underneath any upgrade they buy. Sorting by
 * expiry alone would hand them Initiate forever, because the sentinel expiry
 * outranks every real one — so tier wins first, and expiry only breaks ties.
 */
export function pickBestMembership<T extends MembershipRow>(rows: T[] | null | undefined): T | null {
  const candidates = rows || [];
  if (candidates.length === 0) return null;
  return candidates.reduce((best, row) => {
    const bestRank = TIER_RANK[best.tier] ?? 0;
    const rowRank = TIER_RANK[row.tier] ?? 0;
    if (rowRank !== bestRank) return rowRank > bestRank ? row : best;
    return row.expires_at > best.expires_at ? row : best;
  });
}

export function today(): string {
  return new Date().toISOString().split('T')[0];
}

/**
 * The Guild Path membership currently in force for a user, or null.
 *
 * Single source of truth for the paid + unexpired + best-tier rule. Callers that
 * need extra columns can pass `columns`; the defaults cover pricing.
 */
export async function getActiveMembership(
  supabase: SupabaseClient,
  userId: string,
  columns = 'id, tier, expires_at, plus_ones_used, never_expires, source',
): Promise<MembershipRow | null> {
  const { data } = await supabase
    .from('guild_path_members')
    .select(columns)
    .eq('user_id', userId)
    .eq('status', 'paid')
    .gte('expires_at', today())
    .order('expires_at', { ascending: false });

  return pickBestMembership(data as unknown as MembershipRow[] | null);
}

/**
 * Give a user the free, never-expiring Initiate membership that comes with
 * being a community host.
 *
 * Idempotent, and deliberately additive: an existing paid membership (including
 * an Adventurer or Guildmaster upgrade) is left completely alone. The host row
 * is the floor they fall back to when a paid upgrade lapses.
 */
export async function grantCommunityHostMembership(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ membership_id: string; created: boolean }> {
  const { data: existing } = await supabase
    .from('guild_path_members')
    .select('id, status')
    .eq('user_id', userId)
    .eq('source', COMMUNITY_HOST_SOURCE)
    .order('starts_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) {
    // Re-flagging someone who was a host before revives their old row rather
    // than stacking a second one.
    if (existing.status !== 'paid') {
      await supabase
        .from('guild_path_members')
        .update({
          status: 'paid',
          tier: COMMUNITY_HOST_TIER,
          amount: 0,
          starts_at: today(),
          expires_at: NEVER_EXPIRES_DATE,
          never_expires: true,
        })
        .eq('id', existing.id);
    }
    return { membership_id: existing.id, created: false };
  }

  // amount 0 keeps the finance trigger out of this entirely: it only posts
  // income for paid memberships with amount > 0, so no payment details are
  // required and no cash transaction is created.
  const { data: created, error } = await supabase
    .from('guild_path_members')
    .insert({
      user_id: userId,
      tier: COMMUNITY_HOST_TIER,
      amount: 0,
      status: 'paid',
      starts_at: today(),
      expires_at: NEVER_EXPIRES_DATE,
      never_expires: true,
      source: COMMUNITY_HOST_SOURCE,
    })
    .select('id')
    .single();

  if (error || !created) throw new Error('Could not create the free host membership');
  return { membership_id: created.id, created: true };
}

/**
 * Withdraw the free host membership when someone stops being a community host.
 *
 * Cancels rather than deletes, so the history stays readable, and only ever
 * touches rows sourced from hosting — anything they actually paid for survives.
 */
export async function revokeCommunityHostMembership(
  supabase: SupabaseClient,
  userId: string,
): Promise<number> {
  const { data } = await supabase
    .from('guild_path_members')
    .update({ status: 'cancelled' })
    .eq('user_id', userId)
    .eq('source', COMMUNITY_HOST_SOURCE)
    .neq('status', 'cancelled')
    .select('id');

  return (data || []).length;
}
