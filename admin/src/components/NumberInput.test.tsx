import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NumberInput } from './NumberInput';

describe('NumberInput', () => {
  it('renders empty when value is null', () => {
    render(<NumberInput value={null} onChange={() => {}} aria-label="amount" />);
    expect((screen.getByLabelText('amount') as HTMLInputElement).value).toBe('');
  });

  it('renders 0 only when value is the number 0', () => {
    render(<NumberInput value={0} onChange={() => {}} aria-label="amount" />);
    expect((screen.getByLabelText('amount') as HTMLInputElement).value).toBe('0');
  });

  it('emits null when user clears the field', () => {
    const onChange = vi.fn();
    render(<NumberInput value={10} onChange={onChange} aria-label="amount" />);
    fireEvent.change(screen.getByLabelText('amount'), { target: { value: '' } });
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it('emits a number when user types digits', () => {
    const onChange = vi.fn();
    render(<NumberInput value={null} onChange={onChange} aria-label="amount" />);
    fireEvent.change(screen.getByLabelText('amount'), { target: { value: '42' } });
    expect(onChange).toHaveBeenLastCalledWith(42);
  });

  it('strips ₹ and commas via the rupees parser when allowRupees is true', () => {
    const onChange = vi.fn();
    render(<NumberInput value={null} onChange={onChange} allowRupees aria-label="amount" />);
    fireEvent.change(screen.getByLabelText('amount'), { target: { value: '₹1,500' } });
    expect(onChange).toHaveBeenLastCalledWith(1500);
  });
});
