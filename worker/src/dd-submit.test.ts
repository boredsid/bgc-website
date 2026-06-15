// worker/src/dd-submit.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

function mockEnv() {
  return {
    SUPABASE_URL: 'x', SUPABASE_SERVICE_KEY: 'x',
    UPI_ID: 'x', APPS_SCRIPT_URL: '', APPS_SCRIPT_SECRET: '', BGC_SITE_URL: '',
    CF_ACCESS_TEAM_DOMAIN: 'x', CF_ACCESS_AUD: 'x', ADMIN_EMAILS: '', ENVIRONMENT: 'production',
    DD_SUBMISSION_EMAILS: 'a@example.com, b@example.com',
    DD_DEADLINE: '2099-01-01T00:00:00+05:30',
  } as any;
}

const ctx = { waitUntil: (_p: Promise<unknown>) => {} } as any;

vi.mock('./supabase', () => ({ getSupabase: vi.fn() }));
vi.mock('./email', () => ({ sendDdSubmissionEmail: vi.fn(async () => {}) }));

import { getSupabase } from './supabase';
import { sendDdSubmissionEmail } from './email';
import { handleDdSubmit, _resetDdSubmitRateLimit } from './dd-submit';

function buildSupabaseMock(
  capture: { insertArg: any },
  opts: { insertError?: boolean } = {},
) {
  const insertError = opts.insertError ?? false;
  return {
    from: (table: string) => {
      if (table !== 'dd_submissions') throw new Error('unexpected table ' + table);
      return {
        insert: (arg: any) => {
          capture.insertArg = arg;
          return {
            select: () => ({
              single: async () =>
                insertError
                  ? { data: null, error: { message: 'boom' } }
                  : { data: { id: 'dd-1' }, error: null },
            }),
          };
        },
      };
    },
  };
}

function req(body: unknown) {
  return new Request('http://localhost/api/dd-submit', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const VALID = {
  name: 'Asha',
  phone: '9876543210',
  email: 'Asha@Example.com',
  script_json: ['_meta', 'washerwoman', 'imp'],
};

beforeEach(() => {
  _resetDdSubmitRateLimit();
  (sendDdSubmissionEmail as any).mockClear();
});

describe('handleDdSubmit', () => {
  it('inserts a valid submission and returns the id', async () => {
    const capture = { insertArg: null as any };
    (getSupabase as any).mockReturnValue(buildSupabaseMock(capture));
    const res = await handleDdSubmit(req(VALID), mockEnv(), ctx);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true, id: 'dd-1' });
    expect(capture.insertArg.name).toBe('Asha');
    expect(capture.insertArg.phone).toBe('9876543210');
    expect(capture.insertArg.email).toBe('asha@example.com');
    expect(capture.insertArg.script_json).toEqual(['_meta', 'washerwoman', 'imp']);
  });

  it('emails the recipients from DD_SUBMISSION_EMAILS', async () => {
    (getSupabase as any).mockReturnValue(buildSupabaseMock({ insertArg: null }));
    await handleDdSubmit(req(VALID), mockEnv(), ctx);
    expect(sendDdSubmissionEmail).toHaveBeenCalledTimes(1);
    const arg = (sendDdSubmissionEmail as any).mock.calls[0][0];
    expect(arg.to).toEqual(['a@example.com', 'b@example.com']);
    expect(arg.submission_id).toBe('dd-1');
  });

  it('accepts script_json as a pasted JSON string', async () => {
    const capture = { insertArg: null as any };
    (getSupabase as any).mockReturnValue(buildSupabaseMock(capture));
    const res = await handleDdSubmit(
      req({ ...VALID, script_json: JSON.stringify(['_meta', 'imp']) }),
      mockEnv(), ctx,
    );
    expect(res.status).toBe(200);
    expect(capture.insertArg.script_json).toEqual(['_meta', 'imp']);
  });

  it('rejects invalid request JSON with 400', async () => {
    (getSupabase as any).mockReturnValue(buildSupabaseMock({ insertArg: null }));
    const res = await handleDdSubmit(req('not json'), mockEnv(), ctx);
    expect(res.status).toBe(400);
  });

  it('rejects empty name with 400', async () => {
    (getSupabase as any).mockReturnValue(buildSupabaseMock({ insertArg: null }));
    const res = await handleDdSubmit(req({ ...VALID, name: '   ' }), mockEnv(), ctx);
    expect(res.status).toBe(400);
  });

  it('rejects bad phone with 400', async () => {
    (getSupabase as any).mockReturnValue(buildSupabaseMock({ insertArg: null }));
    const res = await handleDdSubmit(req({ ...VALID, phone: '123' }), mockEnv(), ctx);
    expect(res.status).toBe(400);
  });

  it('rejects bad email with 400', async () => {
    (getSupabase as any).mockReturnValue(buildSupabaseMock({ insertArg: null }));
    const res = await handleDdSubmit(req({ ...VALID, email: 'nope' }), mockEnv(), ctx);
    expect(res.status).toBe(400);
  });

  it('rejects non-array script_json with 400', async () => {
    (getSupabase as any).mockReturnValue(buildSupabaseMock({ insertArg: null }));
    const res = await handleDdSubmit(req({ ...VALID, script_json: { id: 'imp' } }), mockEnv(), ctx);
    expect(res.status).toBe(400);
  });

  it('rejects script_json string that is not valid JSON with 400', async () => {
    (getSupabase as any).mockReturnValue(buildSupabaseMock({ insertArg: null }));
    const res = await handleDdSubmit(req({ ...VALID, script_json: '[oops' }), mockEnv(), ctx);
    expect(res.status).toBe(400);
  });

  it('rejects oversized script_json with 400', async () => {
    (getSupabase as any).mockReturnValue(buildSupabaseMock({ insertArg: null }));
    const big = new Array(60000).fill('washerwoman'); // > 256KB serialized
    const res = await handleDdSubmit(req({ ...VALID, script_json: big }), mockEnv(), ctx);
    expect(res.status).toBe(400);
  });

  it('returns 500 when the DB insert fails', async () => {
    (getSupabase as any).mockReturnValue(buildSupabaseMock({ insertArg: null }, { insertError: true }));
    const res = await handleDdSubmit(req(VALID), mockEnv(), ctx);
    expect(res.status).toBe(500);
  });

  it('rejects with 403 once the deadline has passed (no insert)', async () => {
    const capture = { insertArg: null as any };
    (getSupabase as any).mockReturnValue(buildSupabaseMock(capture));
    const env = { ...mockEnv(), DD_DEADLINE: '2000-01-01T00:00:00+05:30' };
    const res = await handleDdSubmit(req(VALID), env, ctx);
    expect(res.status).toBe(403);
    expect(capture.insertArg).toBeNull();
  });

  it('rate-limits a duplicate within the window without a second insert', async () => {
    const capture = { insertArg: null as any };
    (getSupabase as any).mockReturnValue(buildSupabaseMock(capture));
    await handleDdSubmit(req(VALID), mockEnv(), ctx);
    expect(capture.insertArg).not.toBeNull();
    capture.insertArg = null;
    const res2 = await handleDdSubmit(req(VALID), mockEnv(), ctx);
    expect(res2.status).toBe(200);
    expect(capture.insertArg).toBeNull();
  });

  it('allows an immediate retry after a failed insert (does not mask failure as success)', async () => {
    const capture = { insertArg: null as any };
    // First call: insert fails -> 500.
    (getSupabase as any).mockReturnValue(buildSupabaseMock(capture, { insertError: true }));
    const res1 = await handleDdSubmit(req(VALID), mockEnv(), ctx);
    expect(res1.status).toBe(500);

    // Immediate retry (within the rate-limit window) must attempt the insert
    // again rather than returning a false { ok: true }.
    capture.insertArg = null;
    (getSupabase as any).mockReturnValue(buildSupabaseMock(capture));
    const res2 = await handleDdSubmit(req(VALID), mockEnv(), ctx);
    expect(res2.status).toBe(200);
    expect(capture.insertArg).not.toBeNull();
  });
});
