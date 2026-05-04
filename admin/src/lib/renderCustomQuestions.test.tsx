import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { renderCustomQuestion } from './renderCustomQuestions';
import type { CustomQuestion } from './types';

describe('renderCustomQuestion', () => {
  it('renders a text question with required marker', () => {
    const q: CustomQuestion = { id: 'note', label: 'Note', type: 'text', required: true };
    render(<>{renderCustomQuestion({ question: q, value: '', onChange: () => {} })}</>);
    expect(screen.getByText('Note')).toBeInTheDocument();
    expect(screen.getByText('*')).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('emits a string value on text change', () => {
    const q: CustomQuestion = { id: 'note', label: 'Note', type: 'text', required: false };
    const onChange = vi.fn();
    render(<>{renderCustomQuestion({ question: q, value: '', onChange })}</>);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'hello' } });
    expect(onChange).toHaveBeenCalledWith('hello');
  });

  it('renders select with placeholder + options', () => {
    const q: CustomQuestion = {
      id: 'meal', label: 'Meal', type: 'select', required: false,
      options: [{ value: 'Veg' }, { value: 'NonVeg' }],
    };
    render(<>{renderCustomQuestion({ question: q, value: '', onChange: () => {} })}</>);
    expect(screen.getByText('Veg')).toBeInTheDocument();
    expect(screen.getByText('NonVeg')).toBeInTheDocument();
  });

  it('renders radio options as clickable buttons', () => {
    const q: CustomQuestion = {
      id: 'meal', label: 'Meal', type: 'radio', required: false,
      options: [{ value: 'Veg' }, { value: 'NonVeg' }],
    };
    const onChange = vi.fn();
    render(<>{renderCustomQuestion({ question: q, value: '', onChange })}</>);
    fireEvent.click(screen.getByRole('button', { name: /^Veg$/i }));
    expect(onChange).toHaveBeenCalledWith('Veg');
  });

  it('renders checkbox toggle', () => {
    const q: CustomQuestion = { id: 'pizza', label: 'Pizza?', type: 'checkbox', required: false };
    const onChange = vi.fn();
    render(<>{renderCustomQuestion({ question: q, value: false, onChange })}</>);
    fireEvent.click(screen.getByRole('button'));
    expect(onChange).toHaveBeenCalledWith(true);
  });
});
