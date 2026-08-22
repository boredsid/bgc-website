import { getSupabase } from '../supabase';
import { handleEventSpots } from '../event-spots';
import { COMMUNITY } from './links';
import { ToolError, type McpTool } from './types';

interface EventOption { value: string; price?: number; capacity?: number }
interface EventQuestion { id: string; label: string; type: string; required: boolean; options?: EventOption[] }

const listEvents: McpTool = {
  name: 'list_events',
  description:
    "List upcoming published BGC events in Bangalore with date, venue, and registration method. Events may be all day (all_day) or span several days (end_date). BGC-managed events include price and spots; partner-managed events include the external registration URL.",
  inputSchema: { type: 'object', properties: {} },
  handler: async (_args, env) => {
    const supabase = getSupabase(env);
    const today = new Date().toISOString().split('T')[0];

    const { data: events, error } = await supabase
      .from('events')
      .select('id, name, description, date, end_date, is_all_day, ends_at, venue_name, venue_area, price, price_includes, capacity, guild_path_exclusive, replay_pass_free, externally_managed, external_registration_url')
      .eq('is_published', true)
      // ends_at, not date: an event that is part-way through a multi-day run is
      // still upcoming.
      .gte('ends_at', today)
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
      events: events.map((e) => {
        const common = {
          id: e.id,
          name: e.name,
          description: e.description,
          date: e.date,
          end_date: e.end_date,
          all_day: e.is_all_day,
          venue: [e.venue_name, e.venue_area].filter(Boolean).join(', '),
        };
        if (e.externally_managed) {
          return {
            ...common,
            registration_management: 'external',
            external_registration_url: e.external_registration_url,
            register_url: e.external_registration_url,
          };
        }
        return {
          ...common,
          registration_management: 'bgc',
          price_inr: e.price,
          price_includes: e.price_includes,
          spots_remaining: Math.max(0, e.capacity - (taken[e.id] || 0)),
          guild_path_exclusive: e.guild_path_exclusive,
      replay_pass_free: e.replay_pass_free,
          register_url: `${COMMUNITY.website}/register?event=${e.id}`,
        };
      }),
    };
  },
};

const getEvent: McpTool = {
  name: 'get_event',
  description:
    'Full details and registration method for one event. `date` is the start; `end_date` is set only when the event runs past that day, and `all_day` means it has no meaningful clock time. BGC-managed events include pricing, capacity, and required questions. Partner-managed events include the external registration URL and cannot use BGC registration or waitlist tools.',
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
      .select('id, name, description, date, end_date, is_all_day, ends_at, venue_name, venue_area, price, price_includes, capacity, guild_path_exclusive, replay_pass_free, custom_questions, llm_notes, externally_managed, external_registration_url')
      .eq('id', eventId)
      .eq('is_published', true)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!event) throw new ToolError('Could not find that event. Use list_events to see current events.');

    if (event.externally_managed) {
      return {
        id: event.id,
        name: event.name,
        description: event.description,
        date: event.date,
        end_date: event.end_date,
        all_day: event.is_all_day,
        venue: [event.venue_name, event.venue_area].filter(Boolean).join(', '),
        registration_management: 'external',
        external_registration_url: event.external_registration_url,
        register_url: event.external_registration_url,
        notes: event.llm_notes,
        registration_note:
          'Registration, pricing, capacity, and questions are managed by the event partner. Do not call register_for_event or join_waitlist.',
      };
    }

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
      end_date: event.end_date,
      all_day: event.is_all_day,
      venue: [event.venue_name, event.venue_area].filter(Boolean).join(', '),
      registration_management: 'bgc',
      price_inr: event.price,
      price_includes: event.price_includes,
      pricing_note:
        'If any selected option has price_inr, the per-seat price is the sum of selected option prices instead of the base price.',
      spots_remaining: spots.remaining ?? 0,
      guild_path_exclusive: event.guild_path_exclusive,
      replay_pass_free: event.replay_pass_free,
      custom_questions: questions,
      notes: event.llm_notes,
      register_url: `${COMMUNITY.website}/register?event=${event.id}`,
    };
  },
};

export const eventsTools: McpTool[] = [listEvents, getEvent];
