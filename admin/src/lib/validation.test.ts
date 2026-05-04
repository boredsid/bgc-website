import { describe, it, expect } from 'vitest';
import {
  validateEvent, validateGame, validateGuildMember,
  validateRegistration, validateUser, validateManualRegistration,
  parseRupees, parsePhone, type ValidationErrors,
} from './validation';

describe('parsePhone', () => {
  it('strips non-digits and a leading 91', () => {
    expect(parsePhone('+91 98765 43210')).toBe('9876543210');
    expect(parsePhone('919876543210')).toBe('9876543210');
    expect(parsePhone('98765-43210')).toBe('9876543210');
  });
  it('returns the digits as-is when no leading 91 and not 12 digits', () => {
    expect(parsePhone('9876543210')).toBe('9876543210');
    expect(parsePhone('123')).toBe('123');
  });
});

describe('parseRupees', () => {
  it('strips ₹ and whitespace', () => {
    expect(parseRupees('₹100')).toBe(100);
    expect(parseRupees('  ₹ 1,500 ')).toBe(1500);
    expect(parseRupees('250')).toBe(250);
  });
  it('returns null for empty / invalid input', () => {
    expect(parseRupees('')).toBeNull();
    expect(parseRupees('abc')).toBeNull();
  });
});

describe('validateEvent', () => {
  const valid = {
    name: 'Game night', date: '2026-09-01T19:00:00.000Z',
    capacity: 30, price: 200, venue_name: 'BGC HQ',
  };
  it('returns no errors for a valid event', () => {
    expect(Object.keys(validateEvent(valid))).toHaveLength(0);
  });
  it('requires a name', () => {
    expect(validateEvent({ ...valid, name: '   ' }).name).toBe('Please enter a name.');
  });
  it('requires capacity ≥ 1', () => {
    expect(validateEvent({ ...valid, capacity: 0 }).capacity).toBe('Capacity must be at least 1.');
  });
  it('rejects negative price', () => {
    expect(validateEvent({ ...valid, price: -1 }).price).toBe('Price cannot be negative.');
  });
  it('requires a date', () => {
    expect(validateEvent({ ...valid, date: '' }).date).toBe('Please pick a date and time.');
  });
});

describe('validateGame', () => {
  it('requires a title', () => {
    expect(validateGame({ title: '' }).title).toBe('Please enter a title.');
    expect(validateGame({ title: 'Catan' }).title).toBeUndefined();
  });
});

describe('validateGuildMember', () => {
  const valid = { tier: 'initiate', amount: 500, status: 'paid', starts_at: '2026-05-01', expires_at: '2026-08-01', plus_ones_used: 0 };
  it('returns no errors for valid input', () => {
    expect(Object.keys(validateGuildMember(valid))).toHaveLength(0);
  });
  it('flags expires_at before starts_at', () => {
    const errs = validateGuildMember({ ...valid, expires_at: '2026-04-01' });
    expect(errs.expires_at).toBe('Expiry must be after the start date.');
  });
  it('rejects negative plus_ones_used', () => {
    expect(validateGuildMember({ ...valid, plus_ones_used: -1 }).plus_ones_used).toBe('Plus-ones used cannot be negative.');
  });
});

describe('validateRegistration', () => {
  const valid = { name: 'A', phone: '9876543210', email: '', seats: 1, total_amount: 100, payment_status: 'pending' as const };
  it('valid for minimal input', () => {
    expect(Object.keys(validateRegistration(valid))).toHaveLength(0);
  });
  it('requires a name', () => {
    expect(validateRegistration({ ...valid, name: '' }).name).toBe('Please enter a name.');
  });
  it('requires a 10-digit phone', () => {
    expect(validateRegistration({ ...valid, phone: '1234' }).phone).toBe('Phone must be 10 digits.');
  });
  it('requires seats ≥ 1', () => {
    expect(validateRegistration({ ...valid, seats: 0 }).seats).toBe('Seats must be at least 1.');
  });
  it('rejects malformed email when provided', () => {
    expect(validateRegistration({ ...valid, email: 'not-an-email' }).email).toBe('Please enter a valid email.');
  });
});

describe('validateManualRegistration', () => {
  it('requires an event_id', () => {
    const errs = validateManualRegistration({ event_id: '', name: 'A', phone: '9876543210', email: '', seats: 1 });
    expect(errs.event_id).toBe('Please pick an event.');
  });
});

describe('validateUser', () => {
  it('requires a 10-digit phone', () => {
    expect(validateUser({ name: 'A', phone: '1', email: null }).phone).toBe('Phone must be 10 digits.');
  });
  it('rejects malformed email', () => {
    expect(validateUser({ name: 'A', phone: '9876543210', email: 'x' }).email).toBe('Please enter a valid email.');
  });
});

describe('ValidationErrors type compiles', () => {
  it('keys to optional strings', () => {
    const errs: ValidationErrors = { name: 'Bad' };
    expect(errs.name).toBe('Bad');
  });
});
