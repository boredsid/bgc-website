import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RelativeDate } from './RelativeDate';

describe('RelativeDate', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-02T10:00:00+05:30'));
  });
  afterEach(() => vi.useRealTimers());

  it('formats future dates as "in N days"', () => {
    render(<RelativeDate iso="2026-05-05T19:30:00+05:30" />);
    expect(screen.getByText(/in 3 days/i)).toBeInTheDocument();
  });

  it('formats past dates as "N days ago"', () => {
    render(<RelativeDate iso="2026-04-29T19:30:00+05:30" />);
    expect(screen.getByText(/3 days ago/i)).toBeInTheDocument();
  });

  it('formats dates further out absolutely (e.g. "Sat 8 Aug, 7:30 pm")', () => {
    render(<RelativeDate iso="2026-08-08T19:30:00+05:30" />);
    expect(screen.getByText(/8 Aug.*7:30/i)).toBeInTheDocument();
  });

  it('exposes ISO timestamp as title attribute', () => {
    render(<RelativeDate iso="2026-05-05T19:30:00+05:30" />);
    const el = screen.getByText(/in 3 days/i);
    expect(el.tagName.toLowerCase()).toBe('time');
    expect(el.getAttribute('title')).toBe('2026-05-05T19:30:00+05:30');
    expect(el.getAttribute('datetime')).toBe('2026-05-05T19:30:00+05:30');
  });
});
