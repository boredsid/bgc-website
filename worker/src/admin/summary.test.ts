import { describe, it, expect } from 'vitest';
import { aggregateRegistrations, type RegRow, type EventRow } from './summary';

const event: EventRow = {
  id: 'e1', name: 'X', date: '2026-06-01T00:00:00Z',
  capacity: 30, custom_questions: [
    { id: 'meal', label: 'Meal', type: 'select', required: true, options: [{ value: 'Veg' }, { value: 'NonVeg' }] },
    { id: 'note', label: 'Note', type: 'text', required: false },
  ],
} as any;

const regs: RegRow[] = [
  { id: 'r1', user_id: 'u1', seats: 2, payment_status: 'confirmed', custom_answers: { meal: 'Veg', note: 'allergy: nuts' } },
  { id: 'r2', user_id: 'u2', seats: 1, payment_status: 'confirmed', custom_answers: { meal: 'NonVeg' } },
  { id: 'r3', user_id: 'u3', seats: 3, payment_status: 'pending', custom_answers: { meal: 'Veg' } },
  { id: 'r4', user_id: 'u4', seats: 1, payment_status: 'cancelled', custom_answers: { meal: 'Veg' } },
];

const guildUserIds = new Set(['u1']);

describe('aggregateRegistrations', () => {
  it('counts statuses correctly', () => {
    const summary = aggregateRegistrations(event, regs, guildUserIds);
    expect(summary.totals.confirmed).toBe(2);
    expect(summary.totals.pending).toBe(1);
    expect(summary.totals.cancelled).toBe(1);
  });

  it('sums confirmed seats for capacity_used', () => {
    const summary = aggregateRegistrations(event, regs, guildUserIds);
    expect(summary.capacity_used).toBe(3);
  });

  it('counts confirmed regs whose user_id is in guild set', () => {
    const summary = aggregateRegistrations(event, regs, guildUserIds);
    expect(summary.guild_member_count).toBe(1);
  });

  it('aggregates select answers from confirmed only', () => {
    const summary = aggregateRegistrations(event, regs, guildUserIds);
    const meal = summary.custom_question_summary.meal;
    expect(meal).toEqual({ type: 'select', counts: { Veg: 1, NonVeg: 1 } });
  });

  it('collects text answers from confirmed only', () => {
    const summary = aggregateRegistrations(event, regs, guildUserIds);
    const note = summary.custom_question_summary.note;
    expect(note).toEqual({ type: 'text', count: 1, answers: ['allergy: nuts'] });
  });
});
