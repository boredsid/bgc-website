import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import BottomTabBar from './BottomTabBar';

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <BottomTabBar />
    </MemoryRouter>,
  );
}

describe('BottomTabBar', () => {
  it('renders four primary tabs plus a More button', () => {
    renderAt('/');
    expect(screen.getByRole('link', { name: /dashboard/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /registrations/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /guild/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /events/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /more/i })).toBeInTheDocument();
  });

  it('marks the active tab with aria-current', () => {
    renderAt('/registrations');
    const link = screen.getByRole('link', { name: /registrations/i });
    expect(link.getAttribute('aria-current')).toBe('page');
  });

  it('shows pending counts when provided', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <BottomTabBar counts={{ pending_guild_count: 3 }} />
      </MemoryRouter>,
    );
    expect(screen.getByText('3')).toBeInTheDocument();
  });
});
