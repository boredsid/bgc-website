import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { reportError, __resetForTests } from './log';

describe('lib/log', () => {
  beforeEach(() => {
    __resetForTests();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it('debounces calls within 1 second', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    reportError(new Error('one'));
    reportError(new Error('two'));
    expect(fetchMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('truncates very long messages on the wire', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    reportError(new Error('x'.repeat(5000)));
    await vi.advanceTimersByTimeAsync(1000);
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.message.length).toBeLessThanOrEqual(2000);
  });
});
