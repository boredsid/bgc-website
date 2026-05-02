import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { Loading } from './Loading';

describe('Loading', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('renders nothing for first 150ms', () => {
    render(<Loading><div data-testid="skel">x</div></Loading>);
    expect(screen.queryByTestId('skel')).toBeNull();
    act(() => { vi.advanceTimersByTime(149); });
    expect(screen.queryByTestId('skel')).toBeNull();
  });

  it('renders children after 150ms', () => {
    render(<Loading><div data-testid="skel">x</div></Loading>);
    act(() => { vi.advanceTimersByTime(150); });
    expect(screen.getByTestId('skel')).toBeInTheDocument();
  });
});
