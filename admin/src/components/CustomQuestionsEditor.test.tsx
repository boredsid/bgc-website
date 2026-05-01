import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CustomQuestionsEditor from './CustomQuestionsEditor';
import type { CustomQuestion } from '@/lib/types';

describe('CustomQuestionsEditor', () => {
  it('renders existing questions', () => {
    const value: CustomQuestion[] = [
      { id: 'pizza', label: 'Pizza?', type: 'checkbox', required: false },
    ];
    render(<CustomQuestionsEditor value={value} onChange={() => {}} />);
    expect(screen.getByDisplayValue('Pizza?')).toBeInTheDocument();
  });

  it('adds a question with auto-generated id', () => {
    const calls: CustomQuestion[][] = [];
    render(<CustomQuestionsEditor value={[]} onChange={(v) => calls.push(v)} />);
    fireEvent.click(screen.getByRole('button', { name: /add question/i }));
    expect(calls.length).toBe(1);
    expect(calls[0].length).toBe(1);
    expect(calls[0][0].id).toMatch(/^question-/);
    expect(calls[0][0].type).toBe('text');
  });

  it('preserves id when label is renamed', () => {
    const initial: CustomQuestion[] = [
      { id: 'pizza', label: 'Pizza?', type: 'checkbox', required: false },
    ];
    let last: CustomQuestion[] = initial;
    const { rerender } = render(<CustomQuestionsEditor value={initial} onChange={(v) => { last = v; }} />);
    fireEvent.change(screen.getByDisplayValue('Pizza?'), { target: { value: 'Pizza preference?' } });
    rerender(<CustomQuestionsEditor value={last} onChange={(v) => { last = v; }} />);
    expect(last[0].id).toBe('pizza');
    expect(last[0].label).toBe('Pizza preference?');
  });

  it('shows option editor for select type', () => {
    const value: CustomQuestion[] = [
      { id: 'meal', label: 'Meal', type: 'select', required: false, options: [{ value: 'Veg' }] },
    ];
    render(<CustomQuestionsEditor value={value} onChange={() => {}} />);
    expect(screen.getByDisplayValue('Veg')).toBeInTheDocument();
  });
});
