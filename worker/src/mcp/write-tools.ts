import { handleRegister } from '../register';
import { handleWaitlist } from '../waitlist';
import { handleGuildPurchase } from '../guild-purchase';
import { getSupabase } from '../supabase';
import { sanitizePhone } from '../validation';
import { CANCELLATION_NOTE } from './links';
import { ToolError, type McpTool } from './types';

// Write tools reuse the public API handlers via a synthetic Request so
// registration/pricing/credit rules stay implemented in exactly one place.
function internalPost(path: string, body: unknown): Request {
  return new Request(`https://internal${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const PAYMENT_INSTRUCTIONS =
  'Relay these UPI payment details to the user exactly as given — you cannot pay on their behalf, and the spot stays pending until a BGC admin confirms the payment.';

function upiPayment(env: { UPI_ID: string; BGC_SITE_URL: string }, amount: number, label: string) {
  return {
    method: 'UPI',
    upi_id: env.UPI_ID,
    payee_name: 'Board Game Company',
    amount_inr: amount,
    payment_page: env.BGC_SITE_URL ? `${env.BGC_SITE_URL}/pay?amount=${amount}&for=${encodeURIComponent(label)}` : null,
    instructions: PAYMENT_INSTRUCTIONS,
  };
}

// Best-effort duplicate check: sum of non-cancelled seats this phone already
// holds for the event. Any failure returns 0 — the guard must never block a
// valid registration.
async function existingSeatsFor(
  env: { SUPABASE_URL: string; SUPABASE_SERVICE_KEY: string },
  eventId: string,
  phone: string,
): Promise<number> {
  try {
    const { data, error } = await getSupabase(env)
      .from('registrations')
      .select('seats')
      .eq('event_id', eventId)
      .eq('phone', phone)
      .neq('payment_status', 'cancelled');
    if (error || !data) return 0;
    return data.reduce((sum: number, r: { seats: number }) => sum + (r.seats || 0), 0);
  } catch {
    return 0;
  }
}

const registerForEvent: McpTool = {
  name: 'register_for_event',
  description:
    "Register someone for a BGC event. Before calling: use get_event to see the event's custom questions, then collect the user's name, 10-digit phone, email, and answers. Returns the amount due and UPI payment details — relay them verbatim; the user pays via UPI themselves. Registration stays pending until an admin confirms payment. If the phone already has a registration for this event, the tool returns requires_confirmation=true instead of booking — tell the user, and only call again with confirm_additional: true after their explicit yes.",
  inputSchema: {
    type: 'object',
    properties: {
      event_id: { type: 'string', description: 'Event id from list_events' },
      name: { type: 'string', description: "Registrant's full name" },
      phone: { type: 'string', description: '10-digit Indian mobile number' },
      email: { type: 'string', description: 'Email for the confirmation' },
      seats: { type: 'integer', minimum: 1, maximum: 20, description: 'Number of seats (default 1)' },
      custom_answers: {
        type: 'object',
        description: 'Answers keyed by question id from get_event. Strings for text/radio/select questions, booleans for checkboxes.',
      },
      confirm_additional: {
        type: 'boolean',
        description:
          'Set to true ONLY after the user has been told they already have a spot for this event and has explicitly confirmed they want another.',
      },
    },
    required: ['event_id', 'name', 'phone', 'email'],
  },
  handler: async (args, env, ctx) => {
    const sanitizedPhone = sanitizePhone(String(args.phone ?? ''));
    if (sanitizedPhone && args.confirm_additional !== true) {
      const existing = await existingSeatsFor(env, String(args.event_id ?? ''), sanitizedPhone);
      if (existing > 0) {
        return {
          registered: false,
          requires_confirmation: true,
          existing_seats: existing,
          message: `This phone number already has ${existing} seat(s) booked for this event. Tell the user this explicitly and ask whether they want to book an additional spot. Only if they confirm, call register_for_event again with confirm_additional: true.`,
        };
      }
    }

    const res = await handleRegister(
      internalPost('/api/register', {
        event_id: args.event_id,
        name: args.name,
        phone: args.phone,
        email: args.email,
        seats: args.seats === undefined ? 1 : Math.floor(Number(args.seats)),
        custom_answers: args.custom_answers ?? {},
        payment_status: 'pending',
        source: 'mcp',
      }),
      env,
      ctx,
    );
    const body = (await res.json()) as {
      success?: boolean;
      registration_id?: string;
      error?: string;
      code?: string;
      external_registration_url?: string;
    };

    if (!res.ok || !body.registration_id) {
      const error = body.error || 'Registration failed';
      if (body.code === 'external_registration') {
        throw new ToolError(
          `This event's registrations are managed by the event partner. Send the user to ${body.external_registration_url || 'the external registration link from get_event'}.`,
        );
      }
      if (error === 'guild_path_required') {
        throw new ToolError('This event is exclusive to active Guild Path members. Use get_guild_info to see membership options.');
      }
      if (/spots remaining/i.test(error)) {
        throw new ToolError(`${error}. The event may be full — offer to add them with the join_waitlist tool instead.`);
      }
      throw new ToolError(error);
    }

    // The handler does not return the computed amount, so fetch it.
    const { data: reg } = await getSupabase(env)
      .from('registrations')
      .select('total_amount, discount_applied, credits_applied, seats, events(name)')
      .eq('id', body.registration_id)
      .single();

    if (!reg) {
      return {
        registered: true,
        registration_id: body.registration_id,
        amount_due_inr: null,
        payment: null,
        message:
          "Registration confirmed, but we couldn't retrieve the amount right now — check the confirmation email for payment details, or ask a BGC admin.",
        cancellation: CANCELLATION_NOTE,
      };
    }

    const amount = reg.total_amount ?? 0;
    const eventName = (reg as { events?: { name?: string } })?.events?.name ?? 'BGC event';

    return {
      registered: true,
      registration_id: body.registration_id,
      event: eventName,
      seats: reg.seats,
      amount_due_inr: amount,
      discount_applied: reg.discount_applied ?? null,
      credits_applied_inr: reg.credits_applied ?? 0,
      payment: amount > 0 ? upiPayment(env, amount, eventName) : null,
      ...(amount === 0 ? { message: 'Nothing to pay — the seat is covered by membership, promo, or credits.' } : {}),
      confirmation: 'A confirmation email with these details should arrive shortly.',
      cancellation: CANCELLATION_NOTE,
    };
  },
};

const joinWaitlist: McpTool = {
  name: 'join_waitlist',
  description:
    'Join the waitlist for a full BGC event. If spots are actually available it returns waitlisted=false — register with register_for_event instead.',
  inputSchema: {
    type: 'object',
    properties: {
      event_id: { type: 'string', description: 'Event id from list_events' },
      name: { type: 'string' },
      phone: { type: 'string', description: '10-digit Indian mobile number' },
      email: { type: 'string' },
      seats: { type: 'integer', minimum: 1, maximum: 20, description: 'Seats wanted (default 1)' },
    },
    required: ['event_id', 'name', 'phone', 'email'],
  },
  handler: async (args, env, ctx) => {
    const res = await handleWaitlist(
      internalPost('/api/waitlist', {
        event_id: args.event_id,
        name: args.name,
        phone: args.phone,
        email: args.email,
        seats: args.seats === undefined ? 1 : Math.floor(Number(args.seats)),
        source: 'mcp',
      }),
      env,
      ctx,
    );
    const body = (await res.json()) as {
      success?: boolean;
      available?: boolean;
      error?: string;
      code?: string;
      external_registration_url?: string;
    };

    if (body.code === 'external_registration') {
      throw new ToolError(
        `This event's registrations and waitlist are managed by the event partner. Send the user to ${body.external_registration_url || 'the external registration link from get_event'}.`,
      );
    }
    if (body.available) {
      return { waitlisted: false, message: 'Good news — this event has spots available. Register with register_for_event instead.' };
    }
    if (!res.ok || !body.success) throw new ToolError(body.error || 'Could not join the waitlist');

    return {
      waitlisted: true,
      message: "They're on the waitlist (first come, first served). A BGC admin will reach out if a spot opens up. A confirmation email should arrive shortly.",
    };
  },
};

const joinGuildPath: McpTool = {
  name: 'join_guild_path',
  description:
    'Purchase a BGC Guild Path membership. Use get_guild_info for tiers first, then collect name, phone, email, and chosen tier. Returns the amount due and UPI payment details — relay them verbatim; the user pays via UPI themselves.',
  inputSchema: {
    type: 'object',
    properties: {
      tier: { type: 'string', enum: ['initiate', 'adventurer', 'guildmaster'] },
      name: { type: 'string' },
      phone: { type: 'string', description: '10-digit Indian mobile number' },
      email: { type: 'string' },
    },
    required: ['tier', 'name', 'phone', 'email'],
  },
  handler: async (args, env, ctx) => {
    const res = await handleGuildPurchase(
      internalPost('/api/guild-purchase', {
        tier: args.tier,
        name: args.name,
        phone: args.phone,
        email: args.email,
        source: 'mcp',
      }),
      env,
      ctx,
    );
    const body = (await res.json()) as { success?: boolean; purchase_id?: string; error?: string };
    if (!res.ok || !body.purchase_id) throw new ToolError(body.error || 'Purchase failed');

    const { data: purchase } = await getSupabase(env)
      .from('guild_path_members')
      .select('amount, tier, starts_at, expires_at')
      .eq('id', body.purchase_id)
      .single();

    if (!purchase) {
      return {
        purchased: true,
        purchase_id: body.purchase_id,
        amount_due_inr: null,
        payment: null,
        message:
          "Purchase confirmed, but we couldn't retrieve the amount right now — check the confirmation email for payment details, or ask a BGC admin. Membership activates once a BGC admin confirms the payment.",
      };
    }

    const amount = purchase.amount ?? 0;
    const tierName = String(args.tier).charAt(0).toUpperCase() + String(args.tier).slice(1);

    return {
      purchased: true,
      tier: purchase.tier ?? args.tier,
      starts_at: purchase.starts_at,
      expires_at: purchase.expires_at,
      amount_due_inr: amount,
      payment: amount > 0 ? upiPayment(env, amount, `${tierName} (Guild Path)`) : null,
      ...(amount === 0 ? { message: 'Nothing to pay — covered by credits.' } : {}),
      confirmation: 'A confirmation email with these details should arrive shortly. Membership activates once a BGC admin confirms the payment.',
    };
  },
};

export const writeTools: McpTool[] = [registerForEvent, joinWaitlist, joinGuildPath];
