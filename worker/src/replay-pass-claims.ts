import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchReplayPassStatus } from './replay-client';
import type { Env } from './index';

export interface PassCandidate {
  phone: string;
  isPurchaser: boolean;
}

export interface ClaimedPass {
  phone: string;
  isPurchaser: boolean;
  editionName: string | null;
}

/**
 * Ask REPLAY about several numbers at once.
 *
 * One request per number — REPLAY has no batch endpoint — but they go out in
 * parallel, and a booking tops out at ten seats. Each call already fails closed
 * on its own, so a REPLAY outage costs the discount, never the registration.
 */
export async function fetchPassStatuses(
  env: Env,
  candidates: PassCandidate[],
): Promise<Map<string, { hasPass: boolean; editionName: string | null }>> {
  const results = await Promise.all(
    candidates.map(async (c) => {
      const status = await fetchReplayPassStatus(env, c.phone);
      return [c.phone, { hasPass: status.has_pass, editionName: status.edition_name }] as const;
    }),
  );
  return new Map(results);
}

/**
 * Which of these numbers have already spent their pass on this event.
 *
 * Advisory only — it exists so the form can say "already used" before anyone
 * commits. The real arbiter is the unique index in `claimReplayPasses`.
 */
export async function fetchClaimedPhones(
  supabase: SupabaseClient,
  eventId: string,
  phones: string[],
): Promise<Set<string>> {
  if (phones.length === 0) return new Set();
  const { data } = await supabase
    .from('replay_pass_claims')
    .select('phone')
    .eq('event_id', eventId)
    .in('phone', phones);
  return new Set((data || []).map((r: { phone: string }) => r.phone));
}

/**
 * Stake a claim on each pass this booking wants to spend, and report back which
 * ones it actually won.
 *
 * Claims are inserted *before* the registration exists, because the unique index
 * on (event_id, phone) is what decides a race between two bookings naming the
 * same companion — and the price can only be worked out once that is settled.
 * The rows are adopted by the registration afterwards via `attachClaims`.
 *
 * Inserted one at a time rather than as a batch: a batch insert fails whole when
 * any single row collides, which would throw away the claims this booking did
 * win.
 */
export async function claimReplayPasses(
  supabase: SupabaseClient,
  eventId: string,
  candidates: ClaimedPass[],
): Promise<{ won: ClaimedPass[]; claimIds: string[] }> {
  const won: ClaimedPass[] = [];
  const claimIds: string[] = [];

  for (const candidate of candidates) {
    const { data, error } = await supabase
      .from('replay_pass_claims')
      .insert({
        event_id: eventId,
        phone: candidate.phone,
        is_purchaser: candidate.isPurchaser,
      })
      .select('id')
      .single();

    // A unique violation means someone else's booking got there first. Any other
    // error means the claim is not safely ours either, so treat it the same way:
    // this seat simply pays.
    if (error || !data) continue;

    won.push(candidate);
    claimIds.push(data.id);
  }

  return { won, claimIds };
}

/** Hand the won claims to the registration that paid for them. */
export async function attachClaims(
  supabase: SupabaseClient,
  claimIds: string[],
  registrationId: string,
): Promise<void> {
  if (claimIds.length === 0) return;
  await supabase
    .from('replay_pass_claims')
    .update({ registration_id: registrationId })
    .in('id', claimIds);
}

/**
 * Put claims back when the booking they were staked for never happened, or was
 * cancelled. Without this a failed insert would strand a pass for the event.
 */
export async function releaseClaims(supabase: SupabaseClient, claimIds: string[]): Promise<void> {
  if (claimIds.length === 0) return;
  await supabase.from('replay_pass_claims').delete().in('id', claimIds);
}

/** Release every claim made by a registration — used when it is cancelled. */
export async function releaseClaimsForRegistration(
  supabase: SupabaseClient,
  registrationId: string,
): Promise<void> {
  await supabase.from('replay_pass_claims').delete().eq('registration_id', registrationId);
}

/**
 * Normalise the companion numbers a booking submitted.
 *
 * Drops anything unparseable, the purchaser's own number (their pass is handled
 * on its own terms), and repeats — one number is one pass however many times it
 * is typed in. Capped at the number of companion seats actually booked.
 */
export function normaliseCompanionPhones(
  raw: unknown,
  purchaserPhone: string,
  seats: number,
  sanitize: (phone: string) => string | null,
): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>([purchaserPhone]);
  const out: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'string') continue;
    const phone = sanitize(entry);
    if (!phone || seen.has(phone)) continue;
    seen.add(phone);
    out.push(phone);
    if (out.length >= Math.max(0, seats - 1)) break;
  }
  return out;
}
