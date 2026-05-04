import { describe, it, expect } from 'vitest';
import { classifyQuery } from './search';

describe('classifyQuery', () => {
  it('treats 4+ digit input as a phone query', () => {
    expect(classifyQuery('98765')).toEqual({ kind: 'phone', value: '98765' });
    expect(classifyQuery('+91 98765')).toEqual({ kind: 'phone', value: '9198765' });
  });

  it('treats short or text input as a name/email query', () => {
    expect(classifyQuery('amrit')).toEqual({ kind: 'text', value: 'amrit' });
    expect(classifyQuery('@gmail')).toEqual({ kind: 'text', value: '@gmail' });
    expect(classifyQuery('123')).toEqual({ kind: 'text', value: '123' });
  });

  it('rejects queries shorter than 2 chars', () => {
    expect(classifyQuery('a')).toBeNull();
    expect(classifyQuery('')).toBeNull();
    expect(classifyQuery('  ')).toBeNull();
  });
});
