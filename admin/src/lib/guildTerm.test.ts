import { describe, it, expect } from 'vitest';
import { membershipExpiry, tierDurationMonths } from './guildTerm';

describe('tierDurationMonths', () => {
  it('matches the terms the site sells', () => {
    expect(tierDurationMonths('initiate')).toBe(3);
    expect(tierDurationMonths('adventurer')).toBe(3);
    expect(tierDurationMonths('guildmaster')).toBe(12);
  });

  it('falls back to the shortest term for anything unrecognised', () => {
    expect(tierDurationMonths('wanderer')).toBe(3);
    expect(tierDurationMonths(null)).toBe(3);
    expect(tierDurationMonths(undefined)).toBe(3);
  });
});

describe('membershipExpiry', () => {
  it('gives Adventurer three months, not six', () => {
    // The row that surfaced the drift: this used to come out as 2027-02-07.
    expect(membershipExpiry('2026-08-11', 'adventurer')).toBe('2026-11-11');
  });

  it('dates the other tiers the same way the purchase flow does', () => {
    expect(membershipExpiry('2026-08-11', 'initiate')).toBe('2026-11-11');
    expect(membershipExpiry('2026-08-11', 'guildmaster')).toBe('2027-08-11');
  });

  it('lands on the same day of the month across a year boundary', () => {
    expect(membershipExpiry('2026-12-01', 'adventurer')).toBe('2027-03-01');
  });

  it('returns nothing for a start date that was left blank or malformed', () => {
    expect(membershipExpiry('', 'adventurer')).toBe('');
    expect(membershipExpiry('not-a-date', 'adventurer')).toBe('');
  });
});
