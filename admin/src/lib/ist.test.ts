import { describe, expect, it } from 'vitest';
import { addIstDays, addIstHours, istIso, istMidnight, istWallClock } from './ist';
import { bangaloreDayKey } from './eventDate';

describe('istWallClock', () => {
  it('reads Bangalore wall time regardless of the input offset', () => {
    expect(istWallClock('2026-09-05T18:00:00+05:30')).toEqual({ date: '2026-09-05', time: '18:00' });
    // Same instant, expressed in UTC.
    expect(istWallClock('2026-09-05T12:30:00Z')).toEqual({ date: '2026-09-05', time: '18:00' });
    // Late UTC evening is already the next Bangalore day.
    expect(istWallClock('2026-09-04T20:00:00Z')).toEqual({ date: '2026-09-05', time: '01:30' });
  });

  it('returns null for an unparseable value', () => {
    expect(istWallClock('not a date')).toBeNull();
  });
});

describe('istIso', () => {
  it('stamps wall-clock parts with the Bangalore offset', () => {
    expect(istIso('2026-09-05', '18:00')).toBe('2026-09-05T18:00:00+05:30');
    expect(istIso('2026-09-05', '')).toBe('2026-09-05T00:00:00+05:30');
    expect(istIso('', '18:00')).toBe('');
  });

  it('round-trips with istWallClock', () => {
    const iso = istIso('2026-09-05', '18:00');
    expect(istWallClock(iso)).toEqual({ date: '2026-09-05', time: '18:00' });
  });
});

describe('istMidnight', () => {
  it('snaps to the start of the Bangalore day, not the viewer day', () => {
    expect(istMidnight('2026-09-05T18:00:00+05:30')).toBe('2026-09-05T00:00:00+05:30');
    // 20:00 UTC on the 4th is already the 5th in Bangalore.
    expect(istMidnight('2026-09-04T20:00:00Z')).toBe('2026-09-05T00:00:00+05:30');
  });
});

describe('addIstDays', () => {
  it('keeps the wall time and crosses month and year boundaries', () => {
    expect(addIstDays('2026-09-05T18:00:00+05:30', 1)).toBe('2026-09-06T18:00:00+05:30');
    expect(addIstDays('2026-09-30T10:00:00+05:30', 1)).toBe('2026-10-01T10:00:00+05:30');
    expect(addIstDays('2026-12-31T23:30:00+05:30', 1)).toBe('2027-01-01T23:30:00+05:30');
  });
});

describe('addIstHours', () => {
  it('advances the instant and re-expresses it in Bangalore time', () => {
    expect(addIstHours('2026-09-05T18:00:00+05:30', 3)).toBe('2026-09-05T21:00:00+05:30');
    // Rolls past Bangalore midnight onto the next day.
    expect(addIstHours('2026-09-05T23:00:00+05:30', 3)).toBe('2026-09-06T02:00:00+05:30');
  });
});

describe('agreement with the shared event formatter', () => {
  it('istWallClock().date matches bangaloreDayKey for the same instant', () => {
    // ist.ts uses fixed-offset arithmetic; eventDate.ts uses Intl with a
    // timeZone. They must never disagree about which Bangalore day it is.
    const samples = [
      '2026-09-05T18:00:00+05:30',
      '2026-09-04T20:00:00Z',
      '2026-09-04T18:29:59Z',
      '2026-09-04T18:30:00Z',
      '2026-12-31T18:31:00Z',
      '2026-01-01T00:00:00Z',
    ];
    for (const iso of samples) {
      expect(istWallClock(iso)!.date).toBe(bangaloreDayKey(iso));
    }
  });
});
