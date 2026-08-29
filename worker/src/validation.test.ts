import { describe, it, expect } from 'vitest';
import { missingRequiredAnswers } from './validation';

describe('missingRequiredAnswers', () => {
  const questions = [
    { id: 'game', label: 'Which game are you running?', required: true },
    { id: 'table', label: 'Table', required: true },
    { id: 'notes', label: 'Anything else?', required: false },
  ];

  it('returns nothing when every required question is answered', () => {
    expect(missingRequiredAnswers(questions, { game: 'Clocktower', table: 'Main' })).toEqual([]);
  });

  it('names the questions that were left blank', () => {
    expect(missingRequiredAnswers(questions, { game: 'Clocktower' })).toEqual(['Table']);
    expect(missingRequiredAnswers(questions, {})).toEqual(['Which game are you running?', 'Table']);
  });

  it('treats whitespace as unanswered', () => {
    expect(missingRequiredAnswers(questions, { game: '   ', table: 'Main' }))
      .toEqual(['Which game are you running?']);
  });

  it('ignores optional questions entirely', () => {
    expect(missingRequiredAnswers([{ id: 'notes', label: 'Anything else?', required: false }], {})).toEqual([]);
  });

  it('counts an unticked required checkbox as unanswered', () => {
    const consent = [{ id: 'ok', label: 'Confirm you can make it', required: true }];
    expect(missingRequiredAnswers(consent, { ok: false })).toEqual(['Confirm you can make it']);
    expect(missingRequiredAnswers(consent, { ok: true })).toEqual([]);
  });

  it('handles a missing answers object', () => {
    expect(missingRequiredAnswers(questions, null)).toEqual(['Which game are you running?', 'Table']);
    expect(missingRequiredAnswers(questions, undefined)).toEqual(['Which game are you running?', 'Table']);
  });

  it('returns nothing for an event with no questions', () => {
    expect(missingRequiredAnswers([], { anything: 'x' })).toEqual([]);
  });
});
