import { describe, it, expect } from 'vitest';
import { toCsv } from './csv';

describe('toCsv', () => {
  it('emits header + rows for plain string values', () => {
    const csv = toCsv(['name', 'phone'], [{ name: 'Alice', phone: '9876543210' }]);
    expect(csv).toBe('name,phone\nAlice,9876543210\n');
  });

  it('quotes values containing commas', () => {
    const csv = toCsv(['note'], [{ note: 'hello, world' }]);
    expect(csv).toBe('note\n"hello, world"\n');
  });

  it('escapes inner double-quotes', () => {
    const csv = toCsv(['note'], [{ note: 'she said "hi"' }]);
    expect(csv).toBe('note\n"she said ""hi"""\n');
  });

  it('renders nullish as empty', () => {
    const csv = toCsv(['a', 'b'], [{ a: null, b: undefined }]);
    expect(csv).toBe('a,b\n,\n');
  });

  it('handles numbers and booleans', () => {
    const csv = toCsv(['n', 'b'], [{ n: 42, b: true }]);
    expect(csv).toBe('n,b\n42,true\n');
  });

  it('preserves header order across rows', () => {
    const csv = toCsv(['a', 'b'], [{ b: 1, a: 2 }, { a: 3, b: 4 }]);
    expect(csv).toBe('a,b\n2,1\n3,4\n');
  });
});
