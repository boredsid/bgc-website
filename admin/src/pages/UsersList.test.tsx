import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import UsersList from './UsersList';

vi.mock('@/lib/api', () => ({
  fetchAdmin: vi.fn(async () => ({
    users: [
      {
        id: 'u1', phone: '+919999999999', name: 'Alice', email: 'a@x',
        source: null,
        first_registered_at: '2026-01-01T00:00:00Z',
        last_registered_at: '2026-04-01T00:00:00Z',
        credit_balance: 500,
      },
    ],
  })),
  showApiError: vi.fn(),
}));
vi.mock('@/lib/revalidate', () => ({ useRevalidate: () => {} }));

describe('UsersList', () => {
  it('renders users with credit balance', async () => {
    render(<MemoryRouter><UsersList /></MemoryRouter>);
    await waitFor(() => expect(screen.getAllByText('Alice').length).toBeGreaterThan(0));
    expect(screen.getAllByText(/₹500/).length).toBeGreaterThan(0);
  });
});
