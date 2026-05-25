import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

vi.mock('./api', () => ({ fetchAdmin: vi.fn() }));
import { fetchAdmin } from './api';
import { WhoAmIProvider, useWhoAmI } from './whoami';

function Probe() {
  const who = useWhoAmI();
  return <div>role:{who?.role}</div>;
}

describe('WhoAmIProvider', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows the fallback until whoami resolves, then renders children with the role', async () => {
    (fetchAdmin as any).mockResolvedValue({ email: 'g@x.com', role: 'guest', events: [] });
    render(
      <WhoAmIProvider fallback={<div>loading</div>}>
        {() => <Probe />}
      </WhoAmIProvider>,
    );
    expect(screen.getByText('loading')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('role:guest')).toBeInTheDocument());
  });
});
