// worker/src/dd-submit.ts
import type { Env } from './index';
import { getSupabase } from './supabase';
import { sanitizeName, sanitizePhone, sanitizeEmail, jsonResponse } from './validation';
import { sendDdSubmissionEmail } from './email';

const MAX_JSON_BYTES = 256 * 1024;

// Best-effort, per-isolate dedup of double-clicks. Map(phone -> last ms).
const RATE_LIMIT_MS = 2000;
const lastSeen = new Map<string, number>();

export function _resetDdSubmitRateLimit(): void {
  lastSeen.clear();
}

interface DdSubmitBody {
  name?: string;
  phone?: string;
  email?: string;
  script_json?: unknown;
}

export async function handleDdSubmit(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  let body: DdSubmitBody;
  try {
    body = (await request.json()) as DdSubmitBody;
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400);
  }

  const name = sanitizeName(body.name || '');
  if (!name) return jsonResponse({ error: 'Please enter your name.' }, 400);

  const phone = sanitizePhone(body.phone || '');
  if (!phone) return jsonResponse({ error: 'Please enter a valid 10-digit phone number.' }, 400);

  const email = sanitizeEmail(body.email || '');
  if (!email) return jsonResponse({ error: 'Please enter a valid email address.' }, 400);

  // script_json may arrive as a pasted JSON string or already-parsed array.
  let script: unknown = body.script_json;
  if (typeof script === 'string') {
    try {
      script = JSON.parse(script);
    } catch {
      return jsonResponse({ error: 'Your script JSON is not valid JSON.' }, 400);
    }
  }
  if (!Array.isArray(script) || script.length === 0) {
    return jsonResponse(
      { error: 'Paste the JSON exported from the script tool (it must be a non-empty list).' },
      400,
    );
  }
  const serialized = JSON.stringify(script);
  if (serialized.length > MAX_JSON_BYTES) {
    return jsonResponse({ error: 'That script JSON is too large.' }, 400);
  }

  // Rate-limit drop (absorb double-clicks).
  const now = Date.now();
  const prev = lastSeen.get(phone);
  if (prev && now - prev < RATE_LIMIT_MS) {
    return jsonResponse({ ok: true });
  }
  lastSeen.set(phone, now);

  const supabase = getSupabase(env);
  const { data, error } = await supabase
    .from('dd_submissions')
    .insert({ name, phone, email, script_json: script })
    .select('id')
    .single();

  if (error || !data) {
    // Allow an immediate retry after a failed save — don't let the rate-limit
    // entry we set above mask the failure as a success on the next attempt.
    lastSeen.delete(phone);
    return jsonResponse({ error: 'Could not save your submission. Please try again.' }, 500);
  }

  const recipients = (env.DD_SUBMISSION_EMAILS || 'boardgamecompany2024@gmail.com')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  // Email is a best-effort notification; the row is already persisted.
  ctx.waitUntil(
    sendDdSubmissionEmail(
      { to: recipients, name, phone, email, script_json: script, submission_id: data.id },
      env,
    ).catch(() => {}),
  );

  return jsonResponse({ ok: true, id: data.id });
}
