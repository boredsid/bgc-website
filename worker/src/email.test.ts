import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FALLBACK_TIMEOUT_MS,
  sendDdSubmissionEmail,
  sendEventRegistrationEmail,
  type EventEmailPayload,
} from './email';
import type { Env } from './index';
import { ATTEMPT_TIMEOUT_MS, CONCURRENT_RETRY_DELAY_MS, RETRY_DELAY_MS } from './resend';

const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/test/exec';
const RESEND_URL = 'https://api.resend.com/emails';

const PAYLOAD: EventEmailPayload = {
  to: 'asha@example.com',
  name: 'Asha',
  event: {
    name: 'Witching Hours',
    date: '2026-10-31T12:30:00+00:00',
    end_date: null,
    is_all_day: false,
    venue_name: 'Don’t Tell Mama',
    venue_area: 'HSR Layout',
    price_includes: null,
  },
  seats: 1,
  total_amount: 450,
  discount_applied: null,
  custom_questions: [],
  upi: { id: 'suranjanadatta24-1@okaxis', payee_name: 'Board Game Company' },
  payment_url: 'https://boardgamecompany.in/pay?amount=450&for=Witching%20Hours',
};

function env(overrides: Partial<Env> = {}): Env {
  return {
    APPS_SCRIPT_URL,
    APPS_SCRIPT_SECRET: 'shared-secret',
    ...overrides,
  } as unknown as Env;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

// Routes fetches by URL so a test can give Resend and the Apps Script
// different behaviour.
function routedFetch(handlers: { resend?: () => Promise<Response>; appsScript?: () => Promise<Response> }) {
  return vi.fn((url: string, _init?: RequestInit) => {
    const handler = url === RESEND_URL ? handlers.resend : url === APPS_SCRIPT_URL ? handlers.appsScript : undefined;
    if (!handler) return Promise.reject(new Error(`unexpected fetch to ${url}`));
    return handler();
  });
}

function hang(signal?: AbortSignal | null): Promise<Response> {
  return new Promise((_resolve, reject) => {
    signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted', 'AbortError')));
  });
}

function urls(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return fetchMock.mock.calls.map((call) => call[0] as string);
}

let logs: string[];

beforeEach(() => {
  vi.useFakeTimers();
  logs = [];
  const capture = (...args: unknown[]) => { logs.push(args.map(String).join(' ')); };
  vi.spyOn(console, 'log').mockImplementation(capture);
  vi.spyOn(console, 'error').mockImplementation(capture);
  vi.spyOn(console, 'warn').mockImplementation(capture);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  // No log line, in any scenario, may carry a recipient's address.
  expect(logs.join('\n')).not.toContain('asha@example.com');
});

describe('apps script (EMAIL_PROVIDER unset)', () => {
  it('sends exactly the request it sent before Resend existed', async () => {
    const fetchMock = routedFetch({ appsScript: async () => json(200, { success: true }) });
    vi.stubGlobal('fetch', fetchMock);

    await sendEventRegistrationEmail(PAYLOAD, env());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(APPS_SCRIPT_URL);
    // Strict: a stray `signal: undefined` (or any other new key) is a change.
    expect(init).toStrictEqual({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'event_registration', ...PAYLOAD, secret: 'shared-secret' }),
      redirect: 'follow',
    });
  });

  it.each(['apps_script', '', '  '])('treats EMAIL_PROVIDER=%j as the apps script', async (provider) => {
    const fetchMock = routedFetch({ appsScript: async () => json(200, { success: true }) });
    vi.stubGlobal('fetch', fetchMock);

    await sendEventRegistrationEmail(PAYLOAD, env({ EMAIL_PROVIDER: provider, RESEND_API_KEY: 're_key' }));

    expect(urls(fetchMock)).toEqual([APPS_SCRIPT_URL]);
    expect(logs).toEqual([]);
  });

  it('uses the apps script and says so when EMAIL_PROVIDER is misspelt', async () => {
    const fetchMock = routedFetch({ appsScript: async () => json(200, { success: true }) });
    vi.stubGlobal('fetch', fetchMock);

    await sendEventRegistrationEmail(PAYLOAD, env({ EMAIL_PROVIDER: 'resnd', RESEND_API_KEY: 're_key' }));

    expect(urls(fetchMock)).toEqual([APPS_SCRIPT_URL]);
    expect(logs.join('\n')).toContain('unknown EMAIL_PROVIDER "resnd"');
  });

  it('still lets a network error reach the caller, as before', async () => {
    vi.stubGlobal('fetch', routedFetch({ appsScript: () => Promise.reject(new TypeError('network down')) }));

    await expect(sendEventRegistrationEmail(PAYLOAD, env())).rejects.toThrow('network down');
  });

  it('keeps the address out of the logs when the script quotes it in an error', async () => {
    vi.stubGlobal('fetch', routedFetch({
      appsScript: async () => json(200, { error: 'Exception: Invalid email: asha@example.com' }),
    }));

    await sendEventRegistrationEmail(PAYLOAD, env());

    expect(logs).toEqual(['[email] non-success body: {"error":"Exception: Invalid email: <email>"}']);
  });
});

describe('resend (EMAIL_PROVIDER=resend)', () => {
  const RESEND_ENV = { EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 're_key' };

  it('sends through Resend only, and logs the Resend id', async () => {
    const fetchMock = routedFetch({ resend: async () => json(200, { id: 're_abc' }) });
    vi.stubGlobal('fetch', fetchMock);

    await sendEventRegistrationEmail(PAYLOAD, env(RESEND_ENV));

    expect(urls(fetchMock)).toEqual([RESEND_URL]);
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.subject).toBe("[BGC] You're registered for Witching Hours!");
    expect(body.to).toEqual(['asha@example.com']);
    expect(body.html).toContain("You're registered, Asha!");
    expect(logs).toEqual(['[email] sent via resend type=event_registration id=re_abc']);
  });

  it('accepts the provider name in any case and with stray spaces', async () => {
    const fetchMock = routedFetch({ resend: async () => json(200, { id: 're_abc' }) });
    vi.stubGlobal('fetch', fetchMock);

    await sendEventRegistrationEmail(PAYLOAD, env({ EMAIL_PROVIDER: ' Resend\n', RESEND_API_KEY: 're_key' }));

    expect(urls(fetchMock)).toEqual([RESEND_URL]);
  });

  it('trims a stray newline from the pasted API key', async () => {
    const fetchMock = routedFetch({ resend: async () => json(200, { id: 're_abc' }) });
    vi.stubGlobal('fetch', fetchMock);

    await sendEventRegistrationEmail(PAYLOAD, env({ EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 're_key\n' }));

    const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer re_key');
  });

  it('sends once, with no fallback, when Resend was still finishing a timed-out attempt', async () => {
    const fetchMock = vi.fn()
      .mockImplementationOnce((_url: string, init?: RequestInit) => hang(init?.signal))
      .mockResolvedValueOnce(json(409, { name: 'concurrent_idempotent_requests', message: 'still processing' }))
      .mockResolvedValueOnce(json(200, { id: 're_first' }));
    vi.stubGlobal('fetch', fetchMock);

    const pending = sendEventRegistrationEmail(PAYLOAD, env(RESEND_ENV));
    await vi.advanceTimersByTimeAsync(ATTEMPT_TIMEOUT_MS + RETRY_DELAY_MS + CONCURRENT_RETRY_DELAY_MS);
    await pending;

    expect(urls(fetchMock)).toEqual([RESEND_URL, RESEND_URL, RESEND_URL]);
    expect(logs).toEqual(['[email] sent via resend type=event_registration id=re_first']);
  });

  it('uses the apps script when the API key is missing', async () => {
    const fetchMock = routedFetch({ appsScript: async () => json(200, { success: true }) });
    vi.stubGlobal('fetch', fetchMock);

    await sendEventRegistrationEmail(PAYLOAD, env({ EMAIL_PROVIDER: 'resend' }));

    expect(urls(fetchMock)).toEqual([APPS_SCRIPT_URL]);
    expect(logs.join('\n')).toContain('RESEND_API_KEY is not set');
  });

  it('falls back to the apps script when Resend definitely did not send', async () => {
    const fetchMock = routedFetch({
      resend: async () => json(403, { name: 'validation_error', message: 'The domain is not verified' }),
      appsScript: async () => json(200, { success: true }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await sendEventRegistrationEmail(PAYLOAD, env(RESEND_ENV));

    expect(urls(fetchMock)).toEqual([RESEND_URL, APPS_SCRIPT_URL]);
    const fallback = fetchMock.mock.calls[1][1] as RequestInit;
    expect(fallback.body).toBe(JSON.stringify({ type: 'event_registration', ...PAYLOAD, secret: 'shared-secret' }));
    expect(fallback.signal).toBeInstanceOf(AbortSignal);
    expect(logs).toEqual([
      '[email] resend failed type=event_registration status=403 validation_error: The domain is not verified',
      '[email] falling back to apps script type=event_registration',
      '[email] sent via apps script fallback type=event_registration',
    ]);
  });

  it('flags a possible duplicate when Resend might have sent before failing', async () => {
    const fetchMock = routedFetch({
      resend: async () => json(503, { name: 'internal_server_error', message: 'down' }),
      appsScript: async () => json(200, { success: true }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const pending = sendEventRegistrationEmail(PAYLOAD, env(RESEND_ENV));
    await vi.advanceTimersByTimeAsync(1_000);
    await pending;

    expect(urls(fetchMock)).toEqual([RESEND_URL, RESEND_URL, APPS_SCRIPT_URL]);
    expect(logs.join('\n')).toContain('resend outcome unknown; falling back to apps script (possible duplicate)');
  });

  it('falls back when the template cannot be rendered', async () => {
    const fetchMock = routedFetch({ appsScript: async () => json(200, { success: true }) });
    vi.stubGlobal('fetch', fetchMock);
    const broken = { ...PAYLOAD, event: { ...PAYLOAD.event, date: 'not a date' } };

    await sendEventRegistrationEmail(broken, env(RESEND_ENV));

    expect(urls(fetchMock)).toEqual([APPS_SCRIPT_URL]);
    expect(logs[0]).toBe('[email] could not render event_registration: Invalid date');
  });

  it('logs and gives up when Resend fails and there is no apps script to fall back on', async () => {
    const fetchMock = routedFetch({ resend: async () => json(422, { name: 'validation_error', message: 'bad' }) });
    vi.stubGlobal('fetch', fetchMock);

    await sendEventRegistrationEmail(PAYLOAD, env({ ...RESEND_ENV, APPS_SCRIPT_URL: '', APPS_SCRIPT_SECRET: '' }));

    expect(urls(fetchMock)).toEqual([RESEND_URL]);
    expect(logs.join('\n')).toContain('no apps script fallback configured; email not sent type=event_registration');
  });

  it('never throws when the fallback itself fails, and says the email was not sent', async () => {
    vi.stubGlobal('fetch', routedFetch({
      resend: async () => json(401, { name: 'missing_api_key', message: 'no key' }),
      appsScript: () => Promise.reject(new TypeError('network down')),
    }));

    await expect(sendEventRegistrationEmail(PAYLOAD, env(RESEND_ENV))).resolves.toBeUndefined();
    expect(logs.join('\n')).toContain(
      '[email] email not sent type=event_registration: apps script fallback failed: TypeError: network down',
    );
  });

  it('says the email was not sent when the fallback script refuses it', async () => {
    vi.stubGlobal('fetch', routedFetch({
      resend: async () => json(403, { name: 'validation_error', message: 'domain not verified' }),
      appsScript: async () => json(200, { error: 'Exception: Invalid email: asha@example.com' }),
    }));

    await sendEventRegistrationEmail(PAYLOAD, env(RESEND_ENV));

    expect(logs.slice(-2)).toEqual([
      '[email] non-success body: {"error":"Exception: Invalid email: <email>"}',
      '[email] email not sent type=event_registration: apps script fallback refused it',
    ]);
  });

  it('finishes inside the 30s waitUntil window when both services hang', async () => {
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => hang(init?.signal));
    vi.stubGlobal('fetch', fetchMock);
    let settled = false;

    const pending = sendEventRegistrationEmail(PAYLOAD, env(RESEND_ENV)).then(() => { settled = true; });
    const total = ATTEMPT_TIMEOUT_MS * 2 + RETRY_DELAY_MS + FALLBACK_TIMEOUT_MS;
    await vi.advanceTimersByTimeAsync(total);
    expect(settled).toBe(true);
    await pending;

    expect(urls(fetchMock)).toEqual([RESEND_URL, RESEND_URL, APPS_SCRIPT_URL]);
    expect(logs.join('\n')).toContain('email not sent type=event_registration: apps script fallback failed');
  });

  it('finishes inside the 30s waitUntil window on the slowest path of all', async () => {
    // Attempt 1 times out, attempt 2 answers "still in flight" just before its
    // own timeout, attempt 3 times out, then the fallback times out too.
    let resendCalls = 0;
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === RESEND_URL && ++resendCalls === 2) {
        return new Promise<Response>((resolve) => setTimeout(
          () => resolve(json(409, { name: 'concurrent_idempotent_requests', message: 'still processing' })),
          ATTEMPT_TIMEOUT_MS - 100,
        ));
      }
      return hang(init?.signal);
    });
    vi.stubGlobal('fetch', fetchMock);
    let settled = false;

    const pending = sendEventRegistrationEmail(PAYLOAD, env(RESEND_ENV)).then(() => { settled = true; });
    const total = ATTEMPT_TIMEOUT_MS * 3 + RETRY_DELAY_MS + CONCURRENT_RETRY_DELAY_MS + FALLBACK_TIMEOUT_MS;
    await vi.advanceTimersByTimeAsync(total);
    expect(settled).toBe(true);
    await pending;

    expect(total).toBeLessThan(28_000);
    expect(urls(fetchMock)).toEqual([RESEND_URL, RESEND_URL, RESEND_URL, APPS_SCRIPT_URL]);
    expect(logs.join('\n')).toContain('possible duplicate');
  });

  it('keeps the address out of the logs when Resend quotes it back', async () => {
    vi.stubGlobal('fetch', routedFetch({
      resend: async () => json(422, { name: 'validation_error', message: 'Invalid `to`: asha@example.com' }),
      appsScript: async () => json(200, { success: true }),
    }));

    await sendEventRegistrationEmail(PAYLOAD, env(RESEND_ENV));

    expect(logs.join('\n')).toContain('Invalid `to`: <email>');
  });

  it("sends the Demon's Draft notification as text with the script attached", async () => {
    const fetchMock = routedFetch({ resend: async () => json(200, { id: 're_dd' }) });
    vi.stubGlobal('fetch', fetchMock);

    await sendDdSubmissionEmail({
      to: ['one@example.com', 'two@example.com'],
      name: 'Zoë',
      phone: '9876543210',
      email: 'zoe@example.com',
      script_json: [{ id: '_meta', name: 'Draft' }],
      submission_id: 'abc',
    }, env(RESEND_ENV));

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.to).toEqual(['one@example.com', 'two@example.com']);
    expect(body.subject).toBe("Demon's Draft submission — Zoë");
    expect(body.html).toBeUndefined();
    expect(body.text).toContain('Submission ID: abc');
    expect(body.attachments[0].filename).toBe('script-abc.json');
    expect(body.tags).toEqual([{ name: 'type', value: 'dd_submission' }]);
  });
});
