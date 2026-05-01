import type { Env } from './index';
import { getSupabase } from './supabase';
import { sanitizePhone, sanitizeEmail, sanitizeName, sanitizeSource, jsonResponse } from './validation';
import { sendGuildPurchaseEmail } from './email';

const VALID_TIERS = ['initiate', 'adventurer', 'guildmaster'] as const;
type Tier = typeof VALID_TIERS[number];

const TIER_PRICES: Record<Tier, number> = {
  initiate: 600,
  adventurer: 2000,
  guildmaster: 8000,
};

const TIER_DURATION_MONTHS: Record<Tier, number> = {
  initiate: 3,
  adventurer: 3,
  guildmaster: 12,
};

const TIER_DISPLAY_NAME: Record<Tier, string> = {
  initiate: 'Initiate',
  adventurer: 'Adventurer',
  guildmaster: 'Guildmaster',
};

export async function handleGuildPurchase(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const body = await request.json<{
    name: string;
    phone: string;
    email: string;
    tier: string;
    source?: string;
  }>();

  // Validate inputs
  const phone = sanitizePhone(body.phone || '');
  if (!phone) return jsonResponse({ error: 'Invalid phone number' }, 400);

  const name = sanitizeName(body.name || '');
  if (!name) return jsonResponse({ error: 'Invalid name' }, 400);

  const email = sanitizeEmail(body.email || '');
  if (!email) return jsonResponse({ error: 'Invalid email' }, 400);

  if (!VALID_TIERS.includes(body.tier as Tier)) {
    return jsonResponse({ error: 'Invalid tier' }, 400);
  }

  const source = sanitizeSource(body.source);

  const tier = body.tier as Tier;
  const amount = TIER_PRICES[tier];

  const supabase = getSupabase(env);

  // Upsert user — find by phone, update or insert
  const { data: existingUser } = await supabase
    .from('users')
    .select('id')
    .eq('phone', phone)
    .maybeSingle();

  let userId: string;

  if (existingUser) {
    await supabase
      .from('users')
      .update({ name, email, last_registered_at: new Date().toISOString() })
      .eq('id', existingUser.id);
    userId = existingUser.id;
  } else {
    const { data: newUser, error: userError } = await supabase
      .from('users')
      .insert({ phone, name, email, source })
      .select('id')
      .single();

    if (userError || !newUser) {
      return jsonResponse({ error: 'Failed to create user' }, 500);
    }
    userId = newUser.id;
  }

  // Calculate dates
  const startsAt = new Date().toISOString().split('T')[0];
  const expiresDate = new Date();
  expiresDate.setMonth(expiresDate.getMonth() + TIER_DURATION_MONTHS[tier]);
  const expiresAt = expiresDate.toISOString().split('T')[0];

  // Insert guild_path_members row
  const { data: purchase, error: purchaseError } = await supabase
    .from('guild_path_members')
    .insert({
      user_id: userId,
      tier,
      amount,
      status: 'pending',
      starts_at: startsAt,
      expires_at: expiresAt,
      source,
    })
    .select('id')
    .single();

  if (purchaseError || !purchase) {
    return jsonResponse({ error: 'Purchase failed' }, 500);
  }

  // Send confirmation email (fire-and-forget)
  const tierName = TIER_DISPLAY_NAME[tier];
  const payment_url = env.BGC_SITE_URL
    ? `${env.BGC_SITE_URL}/pay?amount=${amount}&for=${encodeURIComponent(tierName + ' (Guild Path)')}`
    : '';

  ctx.waitUntil(
    sendGuildPurchaseEmail(
      {
        to: email,
        name,
        tier_key: tier,
        tier_name: tierName,
        period_months: TIER_DURATION_MONTHS[tier],
        starts_at: startsAt,
        expires_at: expiresAt,
        total_amount: amount,
        upi: {
          id: env.UPI_ID,
          payee_name: 'Board Game Company',
        },
        payment_url,
      },
      env
    ).catch((err) => console.error('[email] send error', err))
  );

  return jsonResponse({ success: true, purchase_id: purchase.id });
}
