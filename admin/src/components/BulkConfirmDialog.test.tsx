import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BulkConfirmDialog } from './BulkConfirmDialog';

describe('BulkConfirmDialog', () => {
  it('lists sample names with overflow text when count > sample length', () => {
    render(
      <BulkConfirmDialog
        open
        title="Cancel registrations?"
        count={5}
        sampleNames={['Amrit', 'Suranjana']}
        confirmLabel="Cancel 5"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByText(/Amrit, Suranjana, \+3 more/i)).toBeInTheDocument();
  });

  it('calls onConfirm', () => {
    const onConfirm = vi.fn();
    render(
      <BulkConfirmDialog
        open title="x" count={1} sampleNames={['A']} confirmLabel="Go"
        onConfirm={onConfirm} onCancel={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Go' }));
    expect(onConfirm).toHaveBeenCalled();
  });
});
