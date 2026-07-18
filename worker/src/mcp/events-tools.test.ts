import { describe, expect, it, vi } from 'vitest';

vi.mock('../supabase', () => ({ getSupabase: vi.fn() }));
vi.mock('../event-spots', () => ({ handleEventSpots: vi.fn() }));

import { getSupabase } from '../supabase';
import { handleEventSpots } from '../event-spots';
import { eventsTools } from './events-tools';

const env = {} as any;
const ctx = { waitUntil: (p: Promise<unknown>) => p } as any;

function tool(name: string) {
  const t = eventsTools.find((t) => t.name === name);
  if (!t) throw new Error(`missing tool ${name}`);
  return t;
}

const EVENT = {
  id: 'E1', name: 'Catan Night', description: 'Trade and build', date: '2099-01-15',
  venue_name: 'Dice District', venue_area: 'Indiranagar', price: 500,
  price_includes: 'Entry + snacks', capacity: 20, guild_path_exclusive: false,
  custom_questions: [
    { id: 'q1', label: 'Meal', type: 'radio', required: true,
      options: [{ value: 'Veg', price: 450 }, { value: 'Non-veg', price: 550, capacity: 5 }] },
  ],
  llm_notes: 'Beginner friendly',
};

describe('list_events', () => {
  it('lists published upcoming events with spots remaining and register URL', async () => {
    (getSupabase as any).mockReturnValue({
      from: (table: string) => {
        if (table === 'events') {
          return { select: () => ({ eq: () => ({ gte: () => ({ order: async () => ({
            data: [EVENT], error: null }) }) }) }) };
        }
        if (table === 'registrations') {
          return { select: () => ({ in: () => ({ neq: async () => ({
            data: [{ event_id: 'E1', seats: 3 }, { event_id: 'E1', seats: 2 }], error: null }) }) }) };
        }
        return null;
      },
    });

    const out = await tool('list_events').handler({}, env, ctx) as any;
    expect(out.events).toHaveLength(1);
    const e = out.events[0];
    expect(e.id).toBe('E1');
    expect(e.spots_remaining).toBe(15); // 20 capacity - 5 seats
    expect(e.register_url).toBe('https://boardgamecompany.in/register?event=E1');
    expect(e.guild_path_exclusive).toBe(false);
  });
});

describe('get_event', () => {
  it('returns full event details with per-option prices and option spots left', async () => {
    (getSupabase as any).mockReturnValue({
      from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({
        data: EVENT, error: null }) }) }) }) }),
    });
    (handleEventSpots as any).mockResolvedValue(new Response(JSON.stringify({
      capacity: 20, registered: 5, remaining: 15,
      option_counts: { q1: { 'Non-veg': 4 } },
    }), { status: 200 }));

    const out = await tool('get_event').handler({ event_id: 'E1' }, env, ctx) as any;
    expect(out.name).toBe('Catan Night');
    expect(out.spots_remaining).toBe(15);
    expect(out.notes).toBe('Beginner friendly');
    const q = out.custom_questions[0];
    expect(q.options[0]).toEqual({ value: 'Veg', price_inr: 450 });
    expect(q.options[1]).toEqual({ value: 'Non-veg', price_inr: 550, spots_left: 1 }); // 5 cap - 4 taken
  });

  it('raises a friendly error for an unknown event', async () => {
    (getSupabase as any).mockReturnValue({
      from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({
        data: null, error: null }) }) }) }) }),
    });
    await expect(tool('get_event').handler({ event_id: 'nope' }, env, ctx))
      .rejects.toThrow(/not find that event/i);
  });
});
