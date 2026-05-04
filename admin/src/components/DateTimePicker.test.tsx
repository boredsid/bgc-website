import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DateTimePicker } from './DateTimePicker';

describe('DateTimePicker', () => {
  it('renders the date and time portions of an ISO value (IST)', () => {
    render(<DateTimePicker value="2026-09-01T19:30:00+05:30" onChange={() => {}} />);
    expect((screen.getByLabelText(/date/i) as HTMLInputElement).value).toBe('2026-09-01');
    expect((screen.getByLabelText(/time/i) as HTMLSelectElement).value).toBe('19:30');
  });

  it('emits a new ISO string when the date changes', () => {
    const onChange = vi.fn();
    render(<DateTimePicker value="2026-09-01T19:30:00+05:30" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/date/i), { target: { value: '2026-09-02' } });
    expect(onChange).toHaveBeenCalled();
    const last = onChange.mock.calls.at(-1)?.[0] as string;
    expect(last.startsWith('2026-09-02T19:30')).toBe(true);
  });

  it('emits a new ISO string when the time changes', () => {
    const onChange = vi.fn();
    render(<DateTimePicker value="2026-09-01T19:30:00+05:30" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/time/i), { target: { value: '20:00' } });
    const last = onChange.mock.calls.at(-1)?.[0] as string;
    expect(last.startsWith('2026-09-01T20:00')).toBe(true);
  });

  it('renders empty selectors when value is empty', () => {
    render(<DateTimePicker value="" onChange={() => {}} />);
    expect((screen.getByLabelText(/date/i) as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText(/time/i) as HTMLSelectElement).value).toBe('');
  });

  it('offers 30-minute increments from 00:00 to 23:30', () => {
    render(<DateTimePicker value="" onChange={() => {}} />);
    const select = screen.getByLabelText(/time/i) as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => o.value);
    expect(options).toContain('00:00');
    expect(options).toContain('19:30');
    expect(options).toContain('23:30');
    expect(options).not.toContain('19:15');
    expect(options.length).toBe(49);
  });
});
