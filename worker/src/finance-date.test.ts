import { describe, expect, it } from 'vitest';
import { currentBangaloreDate } from './finance-date';

describe('currentBangaloreDate', () => {
  it('uses the Bangalore date across the UTC midnight boundary', () => {
    expect(currentBangaloreDate(new Date('2026-07-28T20:00:00Z'))).toBe('2026-07-29');
  });
});
