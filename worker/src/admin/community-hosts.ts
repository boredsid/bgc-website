import type { Env } from '../index';
import { getSupabase } from '../supabase';
import { jsonResponse, sanitizeEmail, sanitizeName, sanitizePhone } from '../validation';
import {
  COMMUNITY_HOST_SOURCE,
  getActiveMembership,
  grantCommunityHostMembership,
  revokeCommunityHostMembership,
} from '../guild';

export interface CommunityHost {
  id: string;
  name: string | null;
  phone: string;
  email: string | null;
  community_host_since: string | null;
  community_host_notes: string | null;
  sessions_hosted: number;
  membership_tier: string | null;
  membership_never_expires: boolean;
}

/**
 * The community host roster, ordered so the most active hosts come first.
 *
 * Powers both the Hosts screen and the host picker on the registration form —
 * picking a name from a short list beats typing a phone number.
 */
export async function handleListCommunityHosts(env: Env): Promise<Response> {
  const supabase = getSupabase(env);

  const { data: users, error } = await supabase
    .from('users')
    .select('id, name, phone, email, community_host_since, community_host_notes')
    .eq('is_community_host', true)
    .order('name', { ascending: true });
  if (error) return jsonResponse({ error: 'Failed to load community hosts' }, 500);

  const ids = (users || []).map((u: { id: string }) => u.id);
  if (ids.length === 0) return jsonResponse({ hosts: [] });

  const [{ data: hostSeats }, { data: memberships }] = await Promise.all([
    supabase
      .from('registrations')
      .select('user_id')
      .in('user_id', ids)
      .eq('is_community_host', true)
      .neq('payment_status', 'cancelled'),
    supabase
      .from('guild_path_members')
      .select('user_id, tier, expires_at, never_expires')
      .in('user_id', ids)
      .eq('status', 'paid')
      .gte('expires_at', new Date().toISOString().split('T')[0]),
  ]);

  const sessionCounts = new Map<string, number>();
  for (const row of hostSeats || []) {
    sessionCounts.set(row.user_id, (sessionCounts.get(row.user_id) || 0) + 1);
  }

  const bestByUser = new Map<string, { tier: string; never_expires: boolean }>();
  const rank: Record<string, number> = { initiate: 1, adventurer: 2, guildmaster: 3 };
  for (const row of memberships || []) {
    const current = bestByUser.get(row.user_id);
    if (!current || (rank[row.tier] ?? 0) > (rank[current.tier] ?? 0)) {
      bestByUser.set(row.user_id, { tier: row.tier, never_expires: !!row.never_expires });
    }
  }

  const hosts: CommunityHost[] = (users || []).map((u: any) => ({
    id: u.id,
    name: u.name,
    phone: u.phone,
    email: u.email,
    community_host_since: u.community_host_since,
    community_host_notes: u.community_host_notes,
    sessions_hosted: sessionCounts.get(u.id) || 0,
    membership_tier: bestByUser.get(u.id)?.tier ?? null,
    membership_never_expires: bestByUser.get(u.id)?.never_expires ?? false,
  }));

  hosts.sort((a, b) => {
    if (b.sessions_hosted !== a.sessions_hosted) return b.sessions_hosted - a.sessions_hosted;
    return (a.name || a.phone).localeCompare(b.name || b.phone);
  });

  return jsonResponse({ hosts });
}

/**
 * Mark a user as a community host, or stand them down.
 *
 * Turning it on also grants the free never-expiring Initiate membership;
 * turning it off cancels that membership but never touches one they paid for.
 */
export async function handleSetCommunityHost(
  userId: string,
  request: Request,
  env: Env,
): Promise<Response> {
  const body = (await request.json().catch(() => null)) as
    | { is_community_host?: boolean; notes?: string | null }
    | null;
  if (!body || typeof body.is_community_host !== 'boolean') {
    return jsonResponse({ error: 'Say whether this person is a community host' }, 400);
  }

  const notes = typeof body.notes === 'string' ? body.notes.trim() : null;
  if (notes && notes.length > 500) {
    return jsonResponse({ error: 'Notes must be 500 characters or fewer' }, 400);
  }

  const supabase = getSupabase(env);
  const { data: user, error: userError } = await supabase
    .from('users')
    .select('id, name, is_community_host, community_host_since')
    .eq('id', userId)
    .maybeSingle();
  if (userError) return jsonResponse({ error: 'Failed to load user' }, 500);
  if (!user) return jsonResponse({ error: 'User not found' }, 404);

  if (body.is_community_host) {
    let membership: { membership_id: string; created: boolean };
    try {
      membership = await grantCommunityHostMembership(supabase, userId);
    } catch (err) {
      console.error('[community-hosts] grant failed', err);
      return jsonResponse({ error: 'Could not set up the free host membership' }, 500);
    }

    const { error: updateError } = await supabase
      .from('users')
      .update({
        is_community_host: true,
        // Keep the original date if they were already a host — this is when
        // they joined the roster, not when the flag was last touched.
        community_host_since: user.community_host_since || new Date().toISOString().split('T')[0],
        community_host_notes: notes,
      })
      .eq('id', userId);
    if (updateError) return jsonResponse({ error: 'Failed to update user' }, 500);

    // Report the membership actually in force: a host who already holds a paid
    // Adventurer keeps it, and the free Initiate sits underneath as their floor.
    const active = await getActiveMembership(supabase, userId);
    return jsonResponse({
      is_community_host: true,
      membership_id: membership.membership_id,
      membership_created: membership.created,
      active_tier: active?.tier ?? null,
      active_never_expires: !!active?.never_expires,
    });
  }

  const cancelled = await revokeCommunityHostMembership(supabase, userId);
  const { error: updateError } = await supabase
    .from('users')
    .update({ is_community_host: false, community_host_notes: notes })
    .eq('id', userId);
  if (updateError) return jsonResponse({ error: 'Failed to update user' }, 500);

  const active = await getActiveMembership(supabase, userId);
  return jsonResponse({
    is_community_host: false,
    memberships_cancelled: cancelled,
    active_tier: active?.tier ?? null,
    active_never_expires: !!active?.never_expires,
  });
}

/**
 * Add someone to the community host roster by phone number.
 *
 * Hosts don't necessarily have a registration history — someone can be invited
 * to host before they've ever booked a seat — so this creates the user record
 * when the number is new instead of making the admin register them first.
 */
export async function handleCreateCommunityHost(request: Request, env: Env): Promise<Response> {
  const body = (await request.json().catch(() => null)) as
    | { phone?: string; name?: string; email?: string | null; notes?: string | null }
    | null;
  if (!body) return jsonResponse({ error: 'Invalid request body' }, 400);

  const phone = sanitizePhone(body.phone || '');
  if (!phone) return jsonResponse({ error: 'Enter a valid 10-digit phone number' }, 400);

  const email = body.email ? sanitizeEmail(body.email) : null;
  if (body.email && !email) return jsonResponse({ error: 'Enter a valid email, or leave it blank' }, 400);

  const notes = typeof body.notes === 'string' ? body.notes.trim() : null;
  if (notes && notes.length > 500) {
    return jsonResponse({ error: 'Notes must be 500 characters or fewer' }, 400);
  }

  const supabase = getSupabase(env);
  const { data: existing } = await supabase
    .from('users')
    .select('id, name, is_community_host')
    .eq('phone', phone)
    .maybeSingle();

  let userId: string;
  if (existing) {
    userId = existing.id;
    if (existing.is_community_host) {
      return jsonResponse({ error: 'That number is already a community host', code: 'already_host' }, 409);
    }
    // Only fill in a name/email we were given; never blank out what's on file.
    const patch: Record<string, unknown> = {};
    const name = body.name ? sanitizeName(body.name) : null;
    if (name && !existing.name) patch.name = name;
    if (email) patch.email = email;
    if (Object.keys(patch).length > 0) await supabase.from('users').update(patch).eq('id', userId);
  } else {
    const name = sanitizeName(body.name || '');
    if (!name) return jsonResponse({ error: 'Enter a name for this new host' }, 400);
    const { data: created, error } = await supabase
      .from('users')
      .insert({ phone, name, email, source: 'community_host' })
      .select('id')
      .single();
    if (error || !created) return jsonResponse({ error: 'Could not create this host' }, 500);
    userId = created.id;
  }

  try {
    await grantCommunityHostMembership(supabase, userId);
  } catch (err) {
    console.error('[community-hosts] grant failed', err);
    return jsonResponse({ error: 'Could not set up the free host membership' }, 500);
  }

  const { error: updateError } = await supabase
    .from('users')
    .update({
      is_community_host: true,
      community_host_since: new Date().toISOString().split('T')[0],
      community_host_notes: notes,
    })
    .eq('id', userId);
  if (updateError) return jsonResponse({ error: 'Failed to update user' }, 500);

  const active = await getActiveMembership(supabase, userId);
  return jsonResponse({
    user_id: userId,
    is_community_host: true,
    active_tier: active?.tier ?? null,
  });
}

/**
 * Guard for the free host seat: only someone currently on the roster may be
 * added to an event as a host.
 */
export async function assertCommunityHost(
  supabase: ReturnType<typeof getSupabase>,
  phone: string,
): Promise<{ id: string; name: string | null; email: string | null } | null> {
  const { data } = await supabase
    .from('users')
    .select('id, name, email, is_community_host')
    .eq('phone', phone)
    .maybeSingle();
  if (!data || !data.is_community_host) return null;
  return { id: data.id, name: data.name, email: data.email };
}

export { COMMUNITY_HOST_SOURCE };
