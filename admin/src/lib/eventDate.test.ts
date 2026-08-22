import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  bangaloreDayKey,
  eventEndsAt,
  formatEventDateLabel,
  formatEventTimeLabel,
  formatEventWhen,
  isHappeningNow,
  isMultiDay,
} from './eventDate';

const timed = { date: '2026-09-05T18:00:00+05:30', end_date: null, is_all_day: false };
const timedWithEnd = { date: '2026-09-05T18:00:00+05:30', end_date: '2026-09-05T22:00:00+05:30', is_all_day: false };
const allDay = { date: '2026-09-05T00:00:00+05:30', end_date: null, is_all_day: true };
const multiDay = { date: '2026-09-05T10:00:00+05:30', end_date: '2026-09-07T18:00:00+05:30', is_all_day: false };
const multiDayAllDay = { date: '2026-09-05T00:00:00+05:30', end_date: '2026-09-07T00:00:00+05:30', is_all_day: true };
const acrossMonths = { date: '2026-09-28T00:00:00+05:30', end_date: '2026-10-02T00:00:00+05:30', is_all_day: true };
const acrossYears = { date: '2026-12-30T00:00:00+05:30', end_date: '2027-01-02T00:00:00+05:30', is_all_day: true };

describe('bangaloreDayKey', () => {
  it('uses the Bangalore calendar day, not the viewer timezone', () => {
    // 20:00 UTC on 4 Sep is already 01:30 on 5 Sep in Bangalore.
    expect(bangaloreDayKey('2026-09-04T20:00:00Z')).toBe('2026-09-05');
  });
});

describe('isMultiDay', () => {
  it('is false without an end, and false for an end on the same day', () => {
    expect(isMultiDay(timed)).toBe(false);
    expect(isMultiDay(timedWithEnd)).toBe(false);
  });

  it('is true once the end lands on a later Bangalore day', () => {
    expect(isMultiDay(multiDay)).toBe(true);
  });
});

// Short month names come from ICU and differ between runtimes ("Sep" vs
// "Sept"), so tests assert structure against the runtime's own abbreviations.
const shortMonth = (iso: string) =>
  new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', month: 'short' }).format(new Date(iso));
const SEP = shortMonth('2026-09-05T12:00:00+05:30');
const OCT = shortMonth('2026-10-05T12:00:00+05:30');

describe('formatEventDateLabel', () => {
  it('keeps the weekday for a single day', () => {
    expect(formatEventDateLabel(timed)).toBe(`Sat, 5 ${SEP}`);
    expect(formatEventDateLabel(timed, 'long')).toBe('Saturday, 5 September');
  });

  it('collapses a same-month run to one month name', () => {
    expect(formatEventDateLabel(multiDay)).toBe(`5 – 7 ${SEP}`);
  });

  it('repeats the month across a month boundary', () => {
    expect(formatEventDateLabel(acrossMonths)).toBe(`28 ${SEP} – 2 ${OCT}`);
  });

  it('adds years across a year boundary', () => {
    expect(formatEventDateLabel(acrossYears)).toBe('30 Dec 2026 – 2 Jan 2027');
  });
});

describe('formatEventTimeLabel', () => {
  it('reports all-day events as such', () => {
    expect(formatEventTimeLabel(allDay)).toBe('All day');
    expect(formatEventTimeLabel(multiDayAllDay)).toBe('All day');
  });

  it('shows one time without an end and a range with one', () => {
    expect(formatEventTimeLabel(timed)).toBe('6:00 pm');
    expect(formatEventTimeLabel(timedWithEnd)).toBe('6:00 pm – 10:00 pm');
    expect(formatEventTimeLabel(multiDay)).toBe('10:00 am – 6:00 pm');
  });

  it('collapses an end that matches the start', () => {
    expect(formatEventTimeLabel({ date: timed.date, end_date: timed.date, is_all_day: false })).toBe('6:00 pm');
  });
});

describe('formatEventWhen', () => {
  it('reads naturally for each shape', () => {
    expect(formatEventWhen(timed, 'long')).toBe('Saturday, 5 September at 6:00 pm');
    expect(formatEventWhen(allDay, 'long')).toBe('Saturday, 5 September, all day');
    expect(formatEventWhen(multiDayAllDay, 'short')).toBe(`5 – 7 ${SEP}, all day`);
  });
});

describe('eventEndsAt', () => {
  it('is the start when there is no end', () => {
    expect(eventEndsAt(timed).toISOString()).toBe(new Date(timed.date).toISOString());
  });

  it('runs to the end of the last Bangalore day for all-day events', () => {
    expect(eventEndsAt(multiDayAllDay).toISOString()).toBe('2026-09-07T18:29:59.000Z');
  });
});

describe('isHappeningNow', () => {
  it('is true mid-run and false either side', () => {
    expect(isHappeningNow(multiDay, new Date('2026-09-06T12:00:00+05:30'))).toBe(true);
    expect(isHappeningNow(multiDay, new Date('2026-09-04T12:00:00+05:30'))).toBe(false);
    expect(isHappeningNow(multiDay, new Date('2026-09-08T12:00:00+05:30'))).toBe(false);
  });

  it('covers the whole last day of an all-day run', () => {
    expect(isHappeningNow(multiDayAllDay, new Date('2026-09-07T23:00:00+05:30'))).toBe(true);
  });
});

describe('public-site mirror', () => {
  it('stays byte-identical to src/lib/event-date.ts below the header comment', () => {
    // The public site is a separate package and can't import from admin/, so the
    // helper is duplicated. This guards the copies against silent drift.
    const body = (path: string) => {
      const src = readFileSync(new URL(path, import.meta.url), 'utf8');
      return src.slice(src.indexOf('const TZ ='));
    };
    expect(body('../../../src/lib/event-date.ts')).toBe(body('./eventDate.ts'));
  });
});
