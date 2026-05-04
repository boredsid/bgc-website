import type { Env } from '../index';
import { jsonResponse } from '../validation';

interface LogPayload {
  message: string;
  stack?: string;
  url?: string;
  user_agent?: string;
}

interface ValidatedPayload extends LogPayload {
  message: string;
  stack?: string;
  url?: string;
  user_agent?: string;
}

export function validateLogPayload(raw: any): { ok: true; value: ValidatedPayload } | { ok: false } {
  if (!raw || typeof raw.message !== 'string' || raw.message.length === 0) return { ok: false };
  const v: ValidatedPayload = {
    message: raw.message.slice(0, 2000),
    stack: typeof raw.stack === 'string' ? raw.stack.slice(0, 4000) : undefined,
    url: typeof raw.url === 'string' ? raw.url.slice(0, 500) : undefined,
    user_agent: typeof raw.user_agent === 'string' ? raw.user_agent.slice(0, 500) : undefined,
  };
  return { ok: true, value: v };
}

export async function handleLog(request: Request, env: Env, adminEmail: string): Promise<Response> {
  void env; // reserved for future persistence
  const raw = await request.json().catch(() => null);
  const v = validateLogPayload(raw);
  if (!v.ok) return jsonResponse({ error: 'Invalid payload' }, 400);

  const entry = {
    ts: new Date().toISOString(),
    admin: adminEmail,
    ...v.value,
  };

  console.warn('[admin-client-error]', JSON.stringify(entry));
  return jsonResponse({ ok: true });
}
