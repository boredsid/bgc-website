import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import GuildList from './GuildList';

const MEMBERS = [
  {
    id: 'active', user_id: 'u1', tier: 'adventurer', amount: 2_000, status: 'paid',
    starts_at: '2026-01-01', expires_at: '2099-12-31', plus_ones_used: 0, source: null,
    user_name: 'Active Alice', user_phone: '+919999999991', user_email: null,
  },
  {
    id: 'expired', user_id: 'u2', tier: 'initiate', amount: 600, status: 'paid',
    starts_at: '2020-01-01', expires_at: '2020-04-01', plus_ones_used: 0, source: null,
    user_name: 'Expired Evan', user_phone: '+919999999992', user_email: null,
  },
  {
    id: 'pending', user_id: 'u3', tier: 'guildmaster', amount: 8_000, status: 'pending',
    starts_at: '2026-01-01', expires_at: '2099-12-31', plus_ones_used: 0, source: null,
    user_name: 'Pending Priya', user_phone: '+919999999993', user_email: null,
  },
];

vi.mock('@/lib/api', () => ({
  fetchAdmin: vi.fn(async () => ({ members: MEMBERS })),
  showApiError: vi.fn(),
}));
vi.mock('@/lib/revalidate', () => ({ useRevalidate: () => {} }));

describe('GuildList', () => {
  it('shows only active members by default', async () => {
    render(<MemoryRouter initialEntries={['/guild']}><GuildList /></MemoryRouter>);

    await waitFor(() => expect(screen.getAllByText('Active Alice').length).toBeGreaterThan(0));
    expect(screen.getByRole('switch', { name: 'Active only' })).toBeChecked();
    expect(screen.queryByText('Expired Evan')).toBeNull();
    expect(screen.queryByText('Pending Priya')).toBeNull();
  });

  it('shows all members when Active only is disabled', async () => {
    render(<MemoryRouter initialEntries={['/guild']}><GuildList /></MemoryRouter>);

    const toggle = await screen.findByRole('switch', { name: 'Active only' });
    fireEvent.click(toggle);

    await waitFor(() => expect(screen.getAllByText('Expired Evan').length).toBeGreaterThan(0));
    expect(screen.getAllByText('Pending Priya').length).toBeGreaterThan(0);
    expect(toggle).not.toBeChecked();
  });
});
