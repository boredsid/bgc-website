import { describe, it, expect } from 'vitest';
import { flattenRegistrations, type RegRow, type EventRow } from './export-registrations';

describe('flattenRegistrations', () => {
  const events: EventRow[] = [
    { id: 'e1', name: 'Game night', custom_questions: [{ id: 'meal', label: 'Meal', type: 'select', required: true, options: [{ value: 'Veg' }] }] },
  ];
  const regs: RegRow[] = [
    { id: 'r1', name: 'A', phone: '9876500001', email: 'a@x.com', event_id: 'e1', seats: 2, total_amount: 400, payment_status: 'confirmed', source: null, created_at: '2026-04-30T10:00:00Z', custom_answers: { meal: 'Veg' } },
  ];

  it('returns headers including dynamic custom question labels', () => {
    const { headers } = flattenRegistrations(regs, events);
    expect(headers).toEqual([
      'name', 'phone', 'email', 'event', 'seats', 'total_amount', 'payment_status', 'source', 'created_at', 'Meal',
    ]);
  });

  it('flattens custom answers into matching columns', () => {
    const { rows } = flattenRegistrations(regs, events);
    expect(rows[0]).toEqual({
      name: 'A', phone: '9876500001', email: 'a@x.com',
      event: 'Game night', seats: 2, total_amount: 400,
      payment_status: 'confirmed', source: null, created_at: '2026-04-30T10:00:00Z',
      Meal: 'Veg',
    });
  });

  it('handles empty custom_answers without crashing', () => {
    const empty: RegRow[] = [{ ...regs[0], custom_answers: null }];
    const { rows } = flattenRegistrations(empty, events);
    expect(rows[0].Meal).toBe('');
  });
});
