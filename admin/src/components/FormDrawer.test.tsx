import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FormDrawer } from './FormDrawer';

describe('FormDrawer', () => {
  it('renders title, body, and footer Cancel/Save', () => {
    render(
      <FormDrawer
        open
        title="New thing"
        dirty={false}
        onCancel={() => {}}
        onSave={() => {}}
        saving={false}
      >
        <div data-testid="body">body</div>
      </FormDrawer>,
    );
    expect(screen.getByText('New thing')).toBeInTheDocument();
    expect(screen.getByTestId('body')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
  });

  it('shows the issue count on Save when errors present', () => {
    render(
      <FormDrawer
        open title="x" dirty onCancel={() => {}} onSave={() => {}} saving={false}
        errorCount={2}
      >
        <div />
      </FormDrawer>,
    );
    expect(screen.getByRole('button', { name: /save \(2 issues\)/i })).toBeInTheDocument();
  });

  it('shows top-of-sheet error banner when errorMessage is provided', () => {
    render(
      <FormDrawer
        open title="x" dirty={false} onCancel={() => {}} onSave={() => {}} saving={false}
        errorMessage="Server said no"
      >
        <div />
      </FormDrawer>,
    );
    expect(screen.getByText('Server said no')).toBeInTheDocument();
  });

  it('asks before discarding when dirty', () => {
    const onCancel = vi.fn();
    render(
      <FormDrawer
        open title="x" dirty onCancel={onCancel} onSave={() => {}} saving={false}
      >
        <div />
      </FormDrawer>,
    );
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(screen.getByText(/discard your changes/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^discard$/i }));
    expect(onCancel).toHaveBeenCalled();
  });

  it('skips the discard guard when not dirty', () => {
    const onCancel = vi.fn();
    render(
      <FormDrawer
        open title="x" dirty={false} onCancel={onCancel} onSave={() => {}} saving={false}
      >
        <div />
      </FormDrawer>,
    );
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalled();
  });
});
