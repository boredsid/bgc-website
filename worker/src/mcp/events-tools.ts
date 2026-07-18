import { getSupabase } from '../supabase';
import { handleEventSpots } from '../event-spots';
import { COMMUNITY } from './links';
import { ToolError, type McpTool } from './types';

interface EventOption { value: string; price?: number; capacity?: number }
interface EventQuestion { id: string; label: string; type: string; required: boolean; options?: EventOption[] }

const listEvents: McpTool = {
  name: 'list_events',
  description:
    "List upcoming published BGC events in Bangalore with date, venue, price, and spots remaining. Use this first when the user asks what's happening or wants to register.",
  inputSchema: { type: 'object', properties: {} },
  handler: async (_args, env) => {
    const supabase = getSupabase(env);
    const today = new Date().toISOString().split('T')[0];

    const { data: events, error } = await supabase
      .from('events')
      .select('id, name, description, date, venue_name, venue_area, price, price_includes, capacity, guild_path_exclusive')
      .eq('is_published', true)
      .gte('date', today)
      .order('date', { ascending: true });

    if (error) throw new Error(error.message);
    if (!events || events.length === 0) {
      return { events: [], note: `No upcoming events right now — check ${COMMUNITY.website} or the WhatsApp group for announcements.` };
    }

    const { data: regs } = await supabase
      .from('registrations')
      .select('event_id, seats')
      .in('event_id', events.map((e) => e.id))
      .neq('payment_status', 'cancelled');

    const taken: Record<string, number> = {};
    for (const r of regs || []) taken[r.event_id] = (taken[r.event_id] || 0) + r.seats;

    return {
      events: events.map((e) => ({
        id: e.id,
        name: e.name,
        description: e.description,
        date: e.date,
        venue: [e.venue_name, e.venue_area].filter(Boolean).join(', '),
        price_inr: e.price,
        price_includes: e.price_includes,
        spots_remaining: Math.max(0, e.capacity - (taken[e.id] || 0)),
        guild_path_exclusive: e.guild_path_exclusive,
        register_url: `${COMMUNITY.website}/register?event=${e.id}`,
      })),
    };
  },
};

const getEvent: McpTool = {
  name: 'get_event',
  description:
    'Full details of one event: description, pricing (including per-option prices), remaining capacity, and the registration questions that must be answered. Call this before register_for_event to learn which custom_answers are required.',
  inputSchema: {
    type: 'object',
    properties: { event_id: { type: 'string', description: 'Event id from list_events' } },
    required: ['event_id'],
  },
  handler: async (args, env) => {
    const eventId = String(args.event_id ?? '');
    const supabase = getSupabase(env);

    const { data: event, error } = await supabase
      .from('events')
      .select('id, name, description, date, venue_name, venue_area, price, price_includes, capacity, guild_path_exclusive, custom_questions, llm_notes')
      .eq('id', eventId)
      .eq('is_published', true)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!event) throw new ToolError('Could not find that event. Use list_events to see current events.');

    // Reuse the existing spots handler for capacity + per-option counts.
    const spotsRes = await handleEventSpots(eventId, env);
    const spots = (await spotsRes.json()) as {
      remaining?: number;
      option_counts?: Record<string, Record<string, number>>;
    };
    const optionCounts = spots.option_counts ?? {};

    const questions = ((event.custom_questions || []) as EventQuestion[]).map((q) => ({
      id: q.id,
      label: q.label,
      type: q.type,
      required: q.required,
      ...(q.options
        ? {
            options: q.options.map((o) => ({
              value: o.value,
              ...(o.price !== undefined ? { price_inr: o.price } : {}),
              ...(o.capacity !== undefined
                ? { spots_left: Math.max(0, o.capacity - (optionCounts[q.id]?.[o.value] || 0)) }
                : {}),
            })),
          }
        : {}),
    }));

    return {
      id: event.id,
      name: event.name,
      description: event.description,
      date: event.date,
      venue: [event.venue_name, event.venue_area].filter(Boolean).join(', '),
      price_inr: event.price,
      price_includes: event.price_includes,
      pricing_note:
        'If any selected option has price_inr, the per-seat price is the sum of selected option prices instead of the base price.',
      spots_remaining: spots.remaining ?? 0,
      guild_path_exclusive: event.guild_path_exclusive,
      custom_questions: questions,
      notes: event.llm_notes,
      register_url: `${COMMUNITY.website}/register?event=${event.id}`,
    };
  },
};

export const eventsTools: McpTool[] = [listEvents, getEvent];
