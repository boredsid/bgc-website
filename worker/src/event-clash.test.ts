import { describe, expect, it } from 'vitest';
import { clashMessage, findEventClash } from './event-clash';

const OTHER_EVENT = {
  id: 'E2',
  name: 'Werewolf Night',
  date: '2026-06-01T13:30:00+00:00',
  end_date: null,
  is_all_day: false,
  venue_name: 'Indiranagar',
};

/**
 * Stands in for the PostgREST builder, recording the filters each query applied
 * so the test can assert on them, and answering from canned rows.
 */
function mockSupabase(opts: { siblings?: unknown[]; registrations?: unknown[] }) {
  const calls: Record<string, Record<string, unknown>> = {};

  function builder(table: string) {
    const filters: Record<string, unknown> = {};
    calls[table] = filters;
    const rows = table === 'events' ? (opts.siblings ?? []) : (opts.registrations ?? []);
    const chain: any = {
      select: (cols: string) => { filters.select = cols; return chain; },
      eq: (c: string, v: unknown) => { filters[`eq:${c}`] = v; return chain; },
      neq: (c: string, v: unknown) => { filters[`neq:${c}`] = v; return chain; },
      in: (c: string, v: unknown) => { filters[`in:${c}`] = v; return chain; },
      limit: (n: number) => { filters.limit = n; return chain; },
      then: (resolve: (r: unknown) => unknown) => resolve({ data: rows, error: null }),
    };
    return chain;
  }

  return { client: { from: builder } as any, calls };
}

describe('findEventClash', () => {
  it('returns nothing when no other event starts at the same moment', async () => {
    const { client, calls } = mockSupabase({ siblings: [] });

    expect(await findEventClash(client, 'E1', '2026-06-01T13:30:00+00:00', '9999900000')).toBeNull();
    // Cheap path: no point asking about registrations when nothing can clash.
    expect(calls.registrations).toBeUndefined();
    expect(calls.events['eq:date']).toBe('2026-06-01T13:30:00+00:00');
    expect(calls.events['neq:id']).toBe('E1');
  });

  it('returns nothing when the number holds no seat at the concurrent event', async () => {
    const { client } = mockSupabase({ siblings: [OTHER_EVENT], registrations: [] });

    expect(await findEventClash(client, 'E1', OTHER_EVENT.date, '9999900000')).toBeNull();
  });

  it('reports the concurrent event the number is already booked for', async () => {
    const { client, calls } = mockSupabase({
      siblings: [OTHER_EVENT],
      registrations: [{ event_id: 'E2', seats: 2 }],
    });

    const clash = await findEventClash(client, 'E1', OTHER_EVENT.date, '9999900000');

    expect(clash?.event.name).toBe('Werewolf Night');
    expect(clash?.seats).toBe(2);
    expect(calls.registrations['in:event_id']).toEqual(['E2']);
    expect(calls.registrations['eq:phone']).toBe('9999900000');
    // A cancelled booking frees the slot — it must not block a new one.
    expect(calls.registrations['neq:payment_status']).toBe('cancelled');
  });

  it('picks the matching event when several start at the same moment', async () => {
    const third = { ...OTHER_EVENT, id: 'E3', name: 'Catan Cup' };
    const { client } = mockSupabase({
      siblings: [OTHER_EVENT, third],
      registrations: [{ event_id: 'E3', seats: 1 }],
    });

    const clash = await findEventClash(client, 'E1', OTHER_EVENT.date, '9999900000');

    expect(clash?.event.id).toBe('E3');
  });

  it('names the clashing event in its message', () => {
    expect(clashMessage({ event: OTHER_EVENT, seats: 1 })).toContain('Werewolf Night');
  });
});
