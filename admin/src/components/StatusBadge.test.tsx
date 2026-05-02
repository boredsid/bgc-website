import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusBadge } from './StatusBadge';

describe('StatusBadge', () => {
  it('renders the status as visible text (not color-only)', () => {
    render(<StatusBadge status="confirmed" />);
    expect(screen.getByText('Confirmed')).toBeInTheDocument();
  });

  it('applies a status-specific class for each variant', () => {
    const { container } = render(<StatusBadge status="pending" />);
    const span = container.querySelector('span');
    expect(span?.className).toMatch(/status-pending/);
  });

  it('handles all known variants without throwing', () => {
    const variants = ['confirmed', 'pending', 'cancelled', 'paid', 'draft', 'published'] as const;
    for (const v of variants) {
      render(<StatusBadge status={v} />);
    }
    expect(screen.getAllByText(/confirmed|pending|cancelled|paid|draft|published/i).length).toBe(6);
  });
});
