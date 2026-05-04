import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BulkActionBar, type BulkAction } from './BulkActionBar';

describe('BulkActionBar', () => {
  it('renders nothing when count is 0', () => {
    const { container } = render(<BulkActionBar count={0} actions={[]} onClear={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders selection count and actions when count > 0', () => {
    const onClick = vi.fn();
    const actions: BulkAction[] = [{ label: 'Mark confirmed', onClick }];
    render(<BulkActionBar count={3} actions={actions} onClear={() => {}} />);
    expect(screen.getByText(/3 selected/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Mark confirmed' }));
    expect(onClick).toHaveBeenCalled();
  });

  it('renders Clear button calling onClear', () => {
    const onClear = vi.fn();
    render(<BulkActionBar count={1} actions={[]} onClear={onClear} />);
    fireEvent.click(screen.getByRole('button', { name: /clear/i }));
    expect(onClear).toHaveBeenCalled();
  });
});
