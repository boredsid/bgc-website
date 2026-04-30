import type { Env } from './index';

export interface EmailPayload {
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
}

export async function sendRegistrationEmail(payload: EmailPayload, env: Env): Promise<void> {
  if (!env.APPS_SCRIPT_URL || !env.APPS_SCRIPT_SECRET) {
    console.error('[email] APPS_SCRIPT_URL or APPS_SCRIPT_SECRET not configured; skipping');
    return;
  }

  const body = JSON.stringify({ ...payload, secret: env.APPS_SCRIPT_SECRET });

  const res = await fetch(env.APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
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
