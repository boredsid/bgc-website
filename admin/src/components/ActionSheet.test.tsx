import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ActionSheet } from './ActionSheet';

describe('ActionSheet', () => {
  it('renders title and actions when open', () => {
    render(
      <ActionSheet
        open
        title="Change status"
        actions={[
          { label: 'Mark confirmed', onClick: () => {} },
          { label: 'Mark cancelled', onClick: () => {}, destructive: true },
        ]}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText('Change status')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mark confirmed' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mark cancelled' })).toBeInTheDocument();
  });

  it('invokes the action callback when a button is clicked', () => {
    const onClick = vi.fn();
    const onClose = vi.fn();
    render(
      <ActionSheet
        open title="x"
        actions={[{ label: 'Do thing', onClick }]}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Do thing' }));
    expect(onClick).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('renders nothing when not open', () => {
    render(<ActionSheet open={false} title="x" actions={[]} onClose={() => {}} />);
    expect(screen.queryByText('x')).toBeNull();
  });
});
