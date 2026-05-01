import type { Env } from './index';

export interface EventEmailPayload {
  to: string;
  name: string;
  event: {
    name: string;
    date: string;
    venue_name: string;
    venue_area: string | null;
    price_includes: string | null;
  };
  seats: number;
  total_amount: number;
  discount_applied: string | null;
  custom_questions: Array<{ id: string; label: string; answer: string | boolean }>;
  upi: {
    id: string;
    payee_name: string;
  };
  payment_url: string;
}

export interface GuildPurchaseEmailPayload {
  to: string;
  name: string;
  tier_key: 'initiate' | 'adventurer' | 'guildmaster';
  tier_name: string;
  period_months: number;
  starts_at: string;
  expires_at: string;
  total_amount: number;
  upi: {
    id: string;
    payee_name: string;
  };
  payment_url: string;
}

async function postToAppsScript(
  body: Record<string, unknown>,
  env: Env
): Promise<void> {
  if (!env.APPS_SCRIPT_URL || !env.APPS_SCRIPT_SECRET) {
    console.error('[email] APPS_SCRIPT_URL or APPS_SCRIPT_SECRET not configured; skipping');
    return;
  }

  const res = await fetch(env.APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, secret: env.APPS_SCRIPT_SECRET }),
    redirect: 'follow',
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '<unreadable>');
    console.error(`[email] non-OK response: ${res.status} ${text}`);
    return;
  }

  const result = await res.json<{ success?: boolean; error?: string }>().catch(() => null);
  if (!result?.success) {
    console.error(`[email] non-success body: ${JSON.stringify(result)}`);
  }
}

export async function sendEventRegistrationEmail(
  payload: EventEmailPayload,
  env: Env
): Promise<void> {
  await postToAppsScript({ type: 'event_registration', ...payload }, env);
}

export async function sendGuildPurchaseEmail(
  payload: GuildPurchaseEmailPayload,
  env: Env
): Promise<void> {
  await postToAppsScript({ type: 'guild_purchase', ...payload }, env);
}
