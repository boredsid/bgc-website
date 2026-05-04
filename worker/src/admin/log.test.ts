import { describe, it, expect } from 'vitest';
import { validateLogPayload } from './log';

describe('validateLogPayload', () => {
  it('accepts a minimal payload', () => {
    expect(validateLogPayload({ message: 'boom' }).ok).toBe(true);
  });
  it('rejects a missing message', () => {
    expect(validateLogPayload({} as any).ok).toBe(false);
  });
  it('rejects a non-string message', () => {
    expect(validateLogPayload({ message: 123 } as any).ok).toBe(false);
  });
  it('clamps overlong message + stack', () => {
    const big = 'x'.repeat(5000);
    const r = validateLogPayload({ message: big, stack: big });
    expect(r.ok).toBe(true);
    expect(r.value!.message.length).toBeLessThanOrEqual(2000);
    expect(r.value!.stack!.length).toBeLessThanOrEqual(4000);
  });
});
