import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import OwnersSummary from './OwnersSummary';

function GamesPage() {
  const { search } = useLocation();
  return <div data-testid="games-page">games:{search}</div>;
}

vi.mock('@/lib/api', () => ({
  fetchAdmin: vi.fn(async () => ({
    owners: [
      {
        owner: 'Alice',
        total: 4,
        with_owner: 2,
        with_others: 2,
        top_holders: [{ name: 'Bob', count: 2 }],
        more_holders: 0,
      },
      {
        owner: null,
        total: 1,
        with_owner: 1,
        with_others: 0,
        top_holders: [],
        more_holders: 0,
      },
    ],
  })),
  showApiError: vi.fn(),
}));
vi.mock('@/lib/revalidate', () => ({ useRevalidate: () => {} }));

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/games" element={<GamesPage />} />
        <Route path="/owners" element={<OwnersSummary />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('OwnersSummary', () => {
  it('renders owner rows with totals', async () => {
    renderAt('/owners');
    await waitFor(() => expect(screen.getAllByText('Alice').length).toBeGreaterThan(0));
    expect(screen.getAllByText(/Unowned/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText('4').length).toBeGreaterThan(0);
  });

  it('clicking a real-owner row navigates to /games?owned_by=<owner>', async () => {
    renderAt('/owners');
    await waitFor(() => expect(screen.getAllByText('Alice').length).toBeGreaterThan(0));
    const aliceCells = screen.getAllByText('Alice');
    fireEvent.click(aliceCells[0]);
    await waitFor(() => expect(screen.getByTestId('games-page')).toBeInTheDocument());
    expect(screen.getByTestId('games-page').textContent).toContain('owned_by=Alice');
  });

  it('clicking the Unowned row navigates with the __unowned__ sentinel', async () => {
    renderAt('/owners');
    await waitFor(() => expect(screen.getAllByText(/Unowned/i).length).toBeGreaterThan(0));
    const unownedCell = screen.getAllByText(/Unowned/i)[0];
    fireEvent.click(unownedCell);
    await waitFor(() => expect(screen.getByTestId('games-page')).toBeInTheDocument());
    expect(screen.getByTestId('games-page').textContent).toContain('owned_by=__unowned__');
  });
});
