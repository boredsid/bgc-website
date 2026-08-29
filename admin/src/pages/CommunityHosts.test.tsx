import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import CommunityHosts from './CommunityHosts';

const HOSTS = [
  {
    id: 'u1', name: 'Riya', phone: '+919999999991', email: null,
    community_host_since: '2026-01-15', community_host_notes: null,
    sessions_hosted: 4, membership_tier: 'initiate', membership_never_expires: true,
  },
  {
    id: 'u2', name: 'Arjun', phone: '+919999999992', email: null,
    community_host_since: '2026-02-20', community_host_notes: null,
    sessions_hosted: 1, membership_tier: 'guildmaster', membership_never_expires: false,
  },
];

vi.mock('@/lib/api', () => ({
  fetchAdmin: vi.fn(async () => ({ hosts: HOSTS })),
  showApiError: vi.fn(),
}));
vi.mock('@/lib/revalidate', () => ({ useRevalidate: () => {} }));

describe('CommunityHosts', () => {
  it('lists hosts with how much they have hosted', async () => {
    render(<MemoryRouter><CommunityHosts /></MemoryRouter>);

    await waitFor(() => expect(screen.getAllByText('Riya').length).toBeGreaterThan(0));
    expect(screen.getAllByText('Arjun').length).toBeGreaterThan(0);
    expect(screen.getAllByText('4').length).toBeGreaterThan(0);
  });

  it('describes a never-expiring membership without showing the sentinel date', async () => {
    render(<MemoryRouter><CommunityHosts /></MemoryRouter>);

    await waitFor(() => expect(screen.getAllByText(/Initiate · never expires/i).length).toBeGreaterThan(0));
    expect(screen.queryByText(/2999/)).toBeNull();
  });

  it('shows a paid upgrade as the membership in force', async () => {
    render(<MemoryRouter><CommunityHosts /></MemoryRouter>);

    await waitFor(() => expect(screen.getAllByText(/Guildmaster/).length).toBeGreaterThan(0));
  });
});
