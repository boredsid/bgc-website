import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import GamesList from './GamesList';

const SAMPLE_GAMES = [
  {
    id: 'g1', title: 'Catan', player_count: '3-4', max_players: 4,
    avg_rating: null, weight: null, complexity: null,
    play_time: null, max_play_time: null, length: null,
    owned_by: 'Alice', currently_with: 'Alice',
  },
  {
    id: 'g2', title: 'Wingspan', player_count: '1-5', max_players: 5,
    avg_rating: null, weight: null, complexity: null,
    play_time: null, max_play_time: null, length: null,
    owned_by: 'Bob', currently_with: null,
  },
  {
    id: 'g3', title: 'Mystery Game', player_count: '2', max_players: 2,
    avg_rating: null, weight: null, complexity: null,
    play_time: null, max_play_time: null, length: null,
    owned_by: null, currently_with: null,
  },
];

vi.mock('@/lib/api', () => ({
  fetchAdmin: vi.fn(async (path: string) => {
    if (path === '/api/admin/games') return { games: SAMPLE_GAMES };
    if (path === '/api/admin/games/owners-summary') {
      return {
        owners: [
          { owner: 'Alice', total: 1, with_owner: 1, with_others: 0, top_holders: [], more_holders: 0 },
          { owner: 'Bob', total: 1, with_owner: 1, with_others: 0, top_holders: [], more_holders: 0 },
          { owner: null, total: 1, with_owner: 1, with_others: 0, top_holders: [], more_holders: 0 },
        ],
      };
    }
    return {};
  }),
  showApiError: vi.fn(),
}));
vi.mock('@/lib/revalidate', () => ({ useRevalidate: () => {} }));

describe('GamesList', () => {
  it('renders all games by default', async () => {
    render(<MemoryRouter initialEntries={['/games']}><GamesList /></MemoryRouter>);
    await waitFor(() => expect(screen.getAllByText('Catan').length).toBeGreaterThan(0));
    expect(screen.getAllByText('Wingspan').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Mystery Game').length).toBeGreaterThan(0);
  });

  it('?owned_by=Alice filters rows and shows a clearable chip', async () => {
    render(<MemoryRouter initialEntries={['/games?owned_by=Alice']}><GamesList /></MemoryRouter>);
    await waitFor(() => expect(screen.getAllByText('Catan').length).toBeGreaterThan(0));
    expect(screen.queryByText('Wingspan')).toBeNull();
    expect(screen.queryByText('Mystery Game')).toBeNull();
    const chip = screen.getByTestId('owned-by-chip');
    expect(chip.textContent).toMatch(/Alice/);

    fireEvent.click(screen.getByTestId('owned-by-chip-clear'));
    await waitFor(() => expect(screen.getAllByText('Wingspan').length).toBeGreaterThan(0));
    expect(screen.queryByTestId('owned-by-chip')).toBeNull();
  });

  it('?owned_by=__unowned__ filters to games with null/empty owned_by', async () => {
    render(<MemoryRouter initialEntries={['/games?owned_by=__unowned__']}><GamesList /></MemoryRouter>);
    await waitFor(() => expect(screen.getAllByText('Mystery Game').length).toBeGreaterThan(0));
    expect(screen.queryByText('Catan')).toBeNull();
    expect(screen.queryByText('Wingspan')).toBeNull();
    expect(screen.getByTestId('owned-by-chip').textContent).toMatch(/Unowned/i);
  });

  it('?tab=owners renders the OwnersSummary view instead of the games list', async () => {
    render(<MemoryRouter initialEntries={['/games?tab=owners']}><GamesList /></MemoryRouter>);
    await waitFor(() => expect(screen.getAllByText('Alice').length).toBeGreaterThan(0));
    expect(screen.queryByText('Catan')).toBeNull();
    expect(screen.queryByText('Wingspan')).toBeNull();
  });

  it('switching tabs updates the URL', async () => {
    render(<MemoryRouter initialEntries={['/games']}><GamesList /></MemoryRouter>);
    await waitFor(() => expect(screen.getAllByText('Catan').length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole('tab', { name: /owners/i }));
    await waitFor(() => expect(screen.getAllByText('Bob').length).toBeGreaterThan(0));
    expect(screen.queryByText('Catan')).toBeNull();
  });
});
