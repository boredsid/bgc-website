import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DiscardGuardModal } from './DiscardGuardModal';

describe('DiscardGuardModal', () => {
  it('renders nothing when not open', () => {
    render(<DiscardGuardModal open={false} onCancel={() => {}} onDiscard={() => {}} />);
    expect(screen.queryByText(/discard/i)).toBeNull();
  });

  it('shows the prompt when open', () => {
    render(<DiscardGuardModal open onCancel={() => {}} onDiscard={() => {}} />);
    expect(screen.getByText(/discard your changes/i)).toBeInTheDocument();
  });

  it('calls onCancel when the cancel button is clicked', () => {
    const onCancel = vi.fn();
    render(<DiscardGuardModal open onCancel={onCancel} onDiscard={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /keep editing/i }));
    expect(onCancel).toHaveBeenCalled();
  });

  it('calls onDiscard when the discard button is clicked', () => {
    const onDiscard = vi.fn();
    render(<DiscardGuardModal open onCancel={() => {}} onDiscard={onDiscard} />);
    fireEvent.click(screen.getByRole('button', { name: /discard/i }));
    expect(onDiscard).toHaveBeenCalled();
  });
});
