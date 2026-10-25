import type { RenderedEmail } from './email-templates';

// Sends one rendered email through Resend's HTTP API. Never throws: every
// outcome comes back as a ResendResult so the caller can decide whether to fall
// back. This runs inside ctx.waitUntil, which is cut off 30s after the
// response, so the worst case here — three 4s attempts and the pauses between
// them — is kept to 15.5s, leaving the rest for a fallback send.

export const EMAIL_FROM = 'Board Game Company <hello@boardgamecompany.in>';

const RESEND_URL = 'https://api.resend.com/emails';
export const ATTEMPT_TIMEOUT_MS = 4_000;
export const RETRY_DELAY_MS = 1_000;
// Resend's answer when an earlier attempt with the same key is still being
// processed — typically the first attempt timed out on our side but reached
// Resend. Asking again a little later returns that attempt's outcome instead
// of sending twice, so this case earns a third attempt.
export const CONCURRENT_RETRY_DELAY_MS = 2_500;
const MAX_ATTEMPTS = 3;
const MAX_ERROR_LENGTH = 300;

export interface ResendResult {
  ok: boolean;
  id?: string;
  // HTTP status of the last attempt; absent when no reply arrived at all.
  status?: number;
  error?: string;
  // True when the email may have been accepted despite the failure (no reply,
  // a timeout, a 5xx, or a request still in flight). A fallback send can then
  // duplicate it; false means Resend definitely did not send it.
  ambiguous?: boolean;
}

interface ResendErrorBody {
  name?: string;
  message?: string;
}

export async function sendViaResend(
  apiKey: string,
  email: RenderedEmail,
  type: string,
): Promise<ResendResult> {
  const body = JSON.stringify({
    from: EMAIL_FROM,
    to: email.to,
    subject: email.subject,
    ...(email.html !== undefined ? { html: email.html } : {}),
    ...(email.text !== undefined ? { text: email.text } : {}),
    ...(email.attachments ? { attachments: email.attachments } : {}),
    tags: [{ name: 'type', value: type }],
  });
  // One key per email, reused on the retry, so a retry after a lost response
  // can't send it twice. Resend keeps keys for 24 hours.
  const idempotencyKey = crypto.randomUUID();

  let result = await attempt(apiKey, body, idempotencyKey);
  for (let attempts = 1; attempts < MAX_ATTEMPTS; attempts++) {
    const delay = retryDelay(result, attempts);
    if (delay === null) break;
    await sleep(delay);
    result = await attempt(apiKey, body, idempotencyKey);
  }
  return result;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function attempt(apiKey: string, body: string, idempotencyKey: string): Promise<ResendResult> {
  // A plain timer rather than AbortSignal.timeout, so tests can drive it with
  // fake timers.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ATTEMPT_TIMEOUT_MS);
  try {
    let res: Response;
    try {
      res = await fetch(RESEND_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          // Resend answers 403 (error 1010) to requests without a User-Agent.
          'User-Agent': 'bgc-worker',
          'Idempotency-Key': idempotencyKey,
        },
        body,
        signal: controller.signal,
      });
    } catch (err) {
      const reason = controller.signal.aborted
        ? `timed out after ${ATTEMPT_TIMEOUT_MS}ms`
        : err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      return { ok: false, error: redactEmails(reason), ambiguous: true };
    }

    const text = await res.text().catch(() => '');
    if (res.ok) {
      let id: string | undefined;
      try {
        id = (JSON.parse(text) as { id?: string }).id;
      } catch {
        // A 2xx without a readable id still means Resend accepted the email.
      }
      return { ok: true, id, status: res.status };
    }

    let parsed: ResendErrorBody = {};
    try {
      parsed = JSON.parse(text) as ResendErrorBody;
    } catch {
      // Non-JSON error body; keep the raw text below.
    }
    const error = parsed.name || parsed.message
      ? `${parsed.name ?? 'error'}: ${parsed.message ?? ''}`.trim()
      : text.slice(0, 200);
    const concurrent = res.status === 409 && parsed.name === 'concurrent_idempotent_requests';
    return {
      ok: false,
      status: res.status,
      error: redactEmails(error),
      ambiguous: res.status >= 500 || concurrent,
    };
  } finally {
    clearTimeout(timer);
  }
}

// How long to wait before the next attempt, or null to stop. Any failure that
// retrying can fix gets one retry; only "an earlier attempt is still in
// flight" earns a third, since that attempt may already have sent the email.
function retryDelay(result: ResendResult, attemptsSoFar: number): number | null {
  if (result.ok) return null;
  if (result.status === 409 && result.error?.startsWith('concurrent_idempotent_requests')) {
    return CONCURRENT_RETRY_DELAY_MS;
  }
  if (attemptsSoFar >= 2) return null;
  if (result.status === undefined) return RETRY_DELAY_MS; // no reply or timeout
  if (result.status === 429 || result.status >= 500) return RETRY_DELAY_MS;
  return null; // 400, 401, 403, 404, 422, other 409s: the request itself is wrong
}

// Error text from Resend or the Apps Script can quote an address; worker logs
// never hold one. Capped first so a huge error body can't slow the regex.
export function redactEmails(s: string): string {
  return s.slice(0, MAX_ERROR_LENGTH).replace(/[^\s<>"'(),;:]+@[^\s<>"'(),;:]+/g, '<email>');
}
