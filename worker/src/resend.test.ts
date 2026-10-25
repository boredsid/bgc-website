import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ATTEMPT_TIMEOUT_MS,
  CONCURRENT_RETRY_DELAY_MS,
  EMAIL_FROM,
  RETRY_DELAY_MS,
  redactEmails,
  sendViaResend,
} from './resend';
import type { RenderedEmail } from './email-templates';

const HTML_EMAIL: RenderedEmail = { to: ['asha@example.com'], subject: 'Hello', html: '<p>Hi</p>' };

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

// A reply that never comes until the request is aborted.
function hang(init?: RequestInit): Promise<Response> {
  return new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted', 'AbortError')));
  });
}

// A reply that arrives after `ms` of (fake) time.
function after(ms: number, res: Response): Promise<Response> {
  return new Promise((resolve) => setTimeout(() => resolve(res), ms));
}

const CONCURRENT = () => json(409, { name: 'concurrent_idempotent_requests', message: 'still processing' });

function headersOf(call: unknown[]): Record<string, string> {
  return (call[1] as RequestInit).headers as Record<string, string>;
}

function keysOf(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return fetchMock.mock.calls.map((call) => headersOf(call)['Idempotency-Key']);
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('sendViaResend', () => {
  it('posts the email to Resend with the headers it requires', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => json(200, { id: 're_123' }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await sendViaResend('re_key', HTML_EMAIL, 'event_registration');

    expect(result).toEqual({ ok: true, id: 're_123', status: 200 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.method).toBe('POST');
    const headers = headersOf(fetchMock.mock.calls[0]);
    expect(headers.Authorization).toBe('Bearer re_key');
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['User-Agent']).toBe('bgc-worker');
    expect(headers['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.parse(init.body)).toEqual({
      from: EMAIL_FROM,
      to: ['asha@example.com'],
      subject: 'Hello',
      html: '<p>Hi</p>',
      tags: [{ name: 'type', value: 'event_registration' }],
    });
  });

  it('sends text and attachments, and no html, for a plain-text email', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => json(200, { id: 're_dd' }));
    vi.stubGlobal('fetch', fetchMock);

    await sendViaResend('re_key', {
      to: ['a@example.com', 'b@example.com'],
      subject: 'DD',
      text: 'body',
      attachments: [{ filename: 'script-1.json', content: 'e30=' }],
    }, 'dd_submission');

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.html).toBeUndefined();
    expect(body.text).toBe('body');
    expect(body.to).toEqual(['a@example.com', 'b@example.com']);
    expect(body.attachments).toEqual([{ filename: 'script-1.json', content: 'e30=' }]);
  });

  it('retries once after a 5xx with the same idempotency key', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json(502, { name: 'internal_server_error', message: 'oops' }))
      .mockResolvedValueOnce(json(200, { id: 're_2' }));
    vi.stubGlobal('fetch', fetchMock);

    const pending = sendViaResend('re_key', HTML_EMAIL, 'event_registration');
    await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS);
    const result = await pending;

    expect(result).toEqual({ ok: true, id: 're_2', status: 200 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(new Set(keysOf(fetchMock)).size).toBe(1);
  });

  it('stops after two 5xx replies and marks the failure as ambiguous', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => json(500, { name: 'internal_server_error', message: 'down' }));
    vi.stubGlobal('fetch', fetchMock);

    const pending = sendViaResend('re_key', HTML_EMAIL, 'event_registration');
    await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS * 5);
    const result = await pending;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ ok: false, status: 500, ambiguous: true });
  });

  it.each([400, 401, 403, 404, 422])('does not retry a %i, which means the request itself is wrong', async (status) => {
    const fetchMock = vi.fn().mockImplementation(async () => json(status, { name: 'validation_error', message: 'bad' }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await sendViaResend('re_key', HTML_EMAIL, 'event_registration');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ok: false, status, error: 'validation_error: bad', ambiguous: false });
  });

  it('retries a 429 once and reports a second one as a definite failure', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => json(429, { name: 'daily_quota_exceeded', message: 'quota' }));
    vi.stubGlobal('fetch', fetchMock);

    const pending = sendViaResend('re_key', HTML_EMAIL, 'event_registration');
    await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS * 5);
    const result = await pending;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ ok: false, status: 429, ambiguous: false });
  });

  it('waits out a first attempt that timed out on our side but reached Resend', async () => {
    // Attempt 1 hangs past the timeout; attempt 2 finds it still in flight;
    // attempt 3 gets its outcome. One email, no fallback.
    const fetchMock = vi.fn()
      .mockImplementationOnce((_url: string, init?: RequestInit) => hang(init))
      .mockResolvedValueOnce(CONCURRENT())
      .mockResolvedValueOnce(json(200, { id: 're_first' }));
    vi.stubGlobal('fetch', fetchMock);

    const pending = sendViaResend('re_key', HTML_EMAIL, 'event_registration');
    await vi.advanceTimersByTimeAsync(ATTEMPT_TIMEOUT_MS + RETRY_DELAY_MS);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(CONCURRENT_RETRY_DELAY_MS);
    const result = await pending;

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(new Set(keysOf(fetchMock)).size).toBe(1);
    expect(result).toEqual({ ok: true, id: 're_first', status: 200 });
  });

  it('gives up after three attempts when the first is still in flight, and calls it ambiguous', async () => {
    const fetchMock = vi.fn()
      .mockImplementationOnce((_url: string, init?: RequestInit) => hang(init))
      .mockImplementation(async () => CONCURRENT());
    vi.stubGlobal('fetch', fetchMock);

    const pending = sendViaResend('re_key', HTML_EMAIL, 'event_registration');
    await vi.advanceTimersByTimeAsync(30_000);
    const result = await pending;

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({ ok: false, status: 409, ambiguous: true });
  });

  it('does not retry a 409 for a reused key with a different payload', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => json(409, { name: 'invalid_idempotent_request', message: 'mismatch' }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await sendViaResend('re_key', HTML_EMAIL, 'event_registration');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ ok: false, status: 409, ambiguous: false });
  });

  it('treats network errors as ambiguous and retries once', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Network connection lost'));
    vi.stubGlobal('fetch', fetchMock);

    const pending = sendViaResend('re_key', HTML_EMAIL, 'event_registration');
    await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS * 5);
    const result = await pending;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ ok: false, error: 'TypeError: Network connection lost', ambiguous: true });
  });

  it('times out two hanging attempts and gives up', async () => {
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => hang(init));
    vi.stubGlobal('fetch', fetchMock);
    let settled = false;

    const pending = sendViaResend('re_key', HTML_EMAIL, 'event_registration').then((r) => {
      settled = true;
      return r;
    });
    await vi.advanceTimersByTimeAsync(ATTEMPT_TIMEOUT_MS * 2 + RETRY_DELAY_MS);
    expect(settled).toBe(true);
    const result = await pending;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ ok: false, error: `timed out after ${ATTEMPT_TIMEOUT_MS}ms`, ambiguous: true });
  });

  it('finishes within 15.5s on the slowest path (timeout, late 409, timeout)', async () => {
    const fetchMock = vi.fn()
      .mockImplementationOnce((_url: string, init?: RequestInit) => hang(init))
      .mockImplementationOnce(() => after(ATTEMPT_TIMEOUT_MS - 100, CONCURRENT()))
      .mockImplementationOnce((_url: string, init?: RequestInit) => hang(init));
    vi.stubGlobal('fetch', fetchMock);
    let settled = false;

    const pending = sendViaResend('re_key', HTML_EMAIL, 'event_registration').then(() => { settled = true; });
    const worstCase = ATTEMPT_TIMEOUT_MS * 3 + RETRY_DELAY_MS + CONCURRENT_RETRY_DELAY_MS;
    await vi.advanceTimersByTimeAsync(worstCase);
    expect(settled).toBe(true);
    await pending;

    expect(worstCase).toBeLessThanOrEqual(15_500);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('never throws, even when the response body cannot be read', async () => {
    const broken = new Response('x', { status: 200 });
    vi.spyOn(broken, 'text').mockRejectedValue(new Error('stream broke'));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(broken));

    await expect(sendViaResend('re_key', HTML_EMAIL, 'event_registration')).resolves.toEqual({
      ok: true,
      id: undefined,
      status: 200,
    });
  });

  it('keeps recipient addresses out of the error it reports', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      json(422, { name: 'validation_error', message: 'Invalid `to` field: asha@example.com is not valid' }),
    ));

    const result = await sendViaResend('re_key', HTML_EMAIL, 'event_registration');

    expect(result.error).toBe('validation_error: Invalid `to` field: <email> is not valid');
  });
});

describe('redactEmails', () => {
  it('replaces every address and leaves other text alone', () => {
    expect(redactEmails('to <a.b+c@example.co.in>, x@y.com; status 422')).toBe('to <<email>>, <email>; status 422');
  });

  it('caps very long error text', () => {
    expect(redactEmails('x'.repeat(5_000))).toHaveLength(300);
  });
});
