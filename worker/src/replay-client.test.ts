import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { fetchReplayPassStatus, NO_REPLAY_PASS } from './replay-client';

function mockEnv(overrides: Record<string, unknown> = {}) {
  return {
    REPLAY_WORKER_URL: 'https://api.replaycon.in',
    REPLAY_TO_BGC_SECRET: 'shared-secret',
    ...overrides,
  } as any;
}

beforeEach(() => vi.restoreAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe('fetchReplayPassStatus', () => {
  it('calls the REPLAY worker with the shared secret', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ has_pass: true, edition_name: 'REPLAY 3', pass_type: 'campaign', days: ['day1'] })),
    );
    vi.stubGlobal('fetch', fetchMock);

    const status = await fetchReplayPassStatus(mockEnv(), '9876543210');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.replaycon.in/api/pass-status',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer shared-secret' }),
        body: JSON.stringify({ phone: '9876543210' }),
      }),
    );
    expect(status).toMatchObject({ has_pass: true, edition_name: 'REPLAY 3' });
  });

  it('fills in defaults for fields REPLAY omits', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ has_pass: true }))));
    const status = await fetchReplayPassStatus(mockEnv(), '9876543210');
    expect(status).toEqual({ ...NO_REPLAY_PASS, has_pass: true });
  });

  it('treats a non-boolean has_pass as no pass', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ has_pass: 'yes' }))));
    expect(await fetchReplayPassStatus(mockEnv(), '9876543210')).toMatchObject({ has_pass: false });
  });

  it('returns no pass when REPLAY errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 500 })));
    expect(await fetchReplayPassStatus(mockEnv(), '9876543210')).toEqual(NO_REPLAY_PASS);
  });

  it('returns no pass when REPLAY is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));
    expect(await fetchReplayPassStatus(mockEnv(), '9876543210')).toEqual(NO_REPLAY_PASS);
  });

  it('skips the call entirely when it is not configured', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    expect(await fetchReplayPassStatus(mockEnv({ REPLAY_WORKER_URL: '' }), '9876543210')).toEqual(NO_REPLAY_PASS);
    expect(await fetchReplayPassStatus(mockEnv({ REPLAY_TO_BGC_SECRET: '' }), '9876543210')).toEqual(NO_REPLAY_PASS);
    expect(await fetchReplayPassStatus(mockEnv(), '')).toEqual(NO_REPLAY_PASS);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
