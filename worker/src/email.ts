import type { Env } from './index';
import {
  renderDdSubmissionEmail,
  renderEventRegistrationEmail,
  renderGuildPurchaseEmail,
  renderWaitlistEmail,
  type DdSubmissionEmailPayload,
  type EventEmailPayload,
  type GuildPurchaseEmailPayload,
  type RenderedEmail,
  type WaitlistEmailPayload,
} from './email-templates';
import { redactEmails, sendViaResend } from './resend';

export type {
  DdSubmissionEmailPayload,
  EventEmailPayload,
  GuildPurchaseEmailPayload,
  WaitlistEmailPayload,
} from './email-templates';

// Which service sends email is chosen by the EMAIL_PROVIDER secret, so it can
// be switched (and switched back) without a code deploy:
//   - "resend": the worker renders the email and sends it through Resend. If
//     Resend fails and the Apps Script is still configured, the same payload
//     goes to the Apps Script instead, so a Resend problem never loses an email.
//   - anything else, or unset: the Google Apps Script webhook renders and
//     sends it, exactly as before Resend existed.

type EmailType = 'event_registration' | 'guild_purchase' | 'event_waitlist' | 'dd_submission';

// When the Apps Script is the fallback it runs after up to 15.5s of Resend
// attempts, inside a waitUntil that ends 30s after the response, so it gets a
// deadline of its own. As the primary sender it keeps no timeout, as before.
export const FALLBACK_TIMEOUT_MS = 12_000;

// The Resend API key, trimmed (a pasted secret can carry a newline, which
// would make every request's Authorization header invalid), or null when
// Resend isn't the chosen sender.
function resendKey(env: Env): string | null {
  const provider = (env.EMAIL_PROVIDER ?? '').trim().toLowerCase();
  if (provider !== 'resend') {
    if (provider && provider !== 'apps_script') {
      console.error(`[email] unknown EMAIL_PROVIDER "${provider}"; using the apps script`);
    }
    return null;
  }
  const key = (env.RESEND_API_KEY ?? '').trim();
  if (!key) {
    console.error('[email] EMAIL_PROVIDER is resend but RESEND_API_KEY is not set; using the apps script');
    return null;
  }
  return key;
}

function appsScriptConfigured(env: Env): boolean {
  return Boolean(env.APPS_SCRIPT_URL && env.APPS_SCRIPT_SECRET);
}

async function deliver(
  type: EmailType,
  payload: object,
  render: () => RenderedEmail,
  env: Env,
): Promise<void> {
  const apiKey = resendKey(env);
  if (!apiKey) {
    await postToAppsScript({ type, ...payload }, env);
    return;
  }

  let ambiguous = false;
  let rendered: RenderedEmail | null = null;
  try {
    rendered = render();
  } catch (err) {
    console.error(`[email] could not render ${type}: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (rendered) {
    const result = await sendViaResend(apiKey, rendered, type);
    if (result.ok) {
      console.log(`[email] sent via resend type=${type} id=${result.id ?? 'unknown'}`);
      return;
    }
    ambiguous = Boolean(result.ambiguous);
    console.error(`[email] resend failed type=${type} status=${result.status ?? 'no response'} ${result.error ?? ''}`.trim());
  }

  if (!appsScriptConfigured(env)) {
    console.error(`[email] no apps script fallback configured; email not sent type=${type}`);
    return;
  }
  // When Resend may already have accepted the email, sending it again risks a
  // duplicate; a duplicate is better than a customer getting nothing.
  console.error(
    ambiguous
      ? `[email] resend outcome unknown; falling back to apps script (possible duplicate) type=${type}`
      : `[email] falling back to apps script type=${type}`,
  );
  try {
    const sent = await postToAppsScript({ type, ...payload }, env, FALLBACK_TIMEOUT_MS);
    if (sent) {
      console.log(`[email] sent via apps script fallback type=${type}`);
    } else {
      console.error(`[email] email not sent type=${type}: apps script fallback refused it`);
    }
  } catch (err) {
    const reason = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    console.error(`[email] email not sent type=${type}: apps script fallback failed: ${redactEmails(reason)}`);
  }
}

// Returns whether the script reported success. Without a timeout it behaves
// exactly as it did before Resend existed (a network error throws to the
// caller's .catch).
async function postToAppsScript(
  body: Record<string, unknown>,
  env: Env,
  timeoutMs?: number,
): Promise<boolean> {
  if (!env.APPS_SCRIPT_URL || !env.APPS_SCRIPT_SECRET) {
    console.error('[email] APPS_SCRIPT_URL or APPS_SCRIPT_SECRET not configured; skipping');
    return false;
  }

  const controller = timeoutMs === undefined ? null : new AbortController();
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const res = await fetch(env.APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, secret: env.APPS_SCRIPT_SECRET }),
      redirect: 'follow',
      ...(controller ? { signal: controller.signal } : {}),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '<unreadable>');
      console.error(`[email] non-OK response: ${res.status} ${redactEmails(text)}`);
      return false;
    }

    // The script's errors (e.g. MailApp rejecting an address) can quote the
    // recipient, and these logs are kept.
    const result = await res.json<{ success?: boolean; error?: string }>().catch(() => null);
    if (!result?.success) {
      console.error(`[email] non-success body: ${redactEmails(JSON.stringify(result))}`);
      return false;
    }
    return true;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function sendEventRegistrationEmail(
  payload: EventEmailPayload,
  env: Env
): Promise<void> {
  await deliver('event_registration', payload, () => renderEventRegistrationEmail(payload), env);
}

export async function sendGuildPurchaseEmail(
  payload: GuildPurchaseEmailPayload,
  env: Env
): Promise<void> {
  await deliver('guild_purchase', payload, () => renderGuildPurchaseEmail(payload), env);
}

export async function sendWaitlistEmail(
  payload: WaitlistEmailPayload,
  env: Env
): Promise<void> {
  await deliver('event_waitlist', payload, () => renderWaitlistEmail(payload), env);
}

export async function sendDdSubmissionEmail(
  payload: DdSubmissionEmailPayload,
  env: Env
): Promise<void> {
  await deliver('dd_submission', payload, () => renderDdSubmissionEmail(payload), env);
}
