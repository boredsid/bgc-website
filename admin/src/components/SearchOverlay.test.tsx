import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SearchOverlay } from './SearchOverlay';

function renderIt(open = true) {
  return render(
    <MemoryRouter>
      <SearchOverlay open={open} onClose={() => {}} />
    </MemoryRouter>,
  );
}

describe('SearchOverlay', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      registrations: [{ id: 'r1', name: 'Amrit', phone: '9876500001', event_id: 'e1', event_name: 'Game night', payment_status: 'confirmed' }],
      guild_members: [],
      users: [],
    }), { status: 200 })));
    localStorage.clear();
  });

  it('renders an input when open', () => {
    renderIt();
    expect(screen.getByPlaceholderText(/find someone/i)).toBeInTheDocument();
  });

  it('queries the search endpoint after typing', async () => {
    vi.useFakeTimers();
    renderIt();
    fireEvent.change(screen.getByPlaceholderText(/find someone/i), { target: { value: 'amrit' } });
    await vi.advanceTimersByTimeAsync(250);
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/api/admin/search?q=amrit'), expect.any(Object)));
    vi.useRealTimers();
  });

  it('renders a recent searches section when input is empty', () => {
    localStorage.setItem('admin.searchRecents', JSON.stringify(['amrit', '98765']));
    renderIt();
    expect(screen.getByText('amrit')).toBeInTheDocument();
    expect(screen.getByText('98765')).toBeInTheDocument();
  });
});
