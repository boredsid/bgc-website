import type { McpTool } from './types';
import { COMMUNITY, CANCELLATION_NOTE } from './links';
import { getSupabase } from '../supabase';
import { sanitizePhone } from '../validation';
import { getUserBalance } from '../credits';
import { ToolError } from './types';

// Tier facts mirror src/lib/guild-tiers.ts and the prices in
// worker/src/guild-purchase.ts — keep all three in sync.
const GUILD_TIERS = [
  {
    key: 'initiate',
    name: 'Initiate',
    price_inr: 600,
    period: '3 months',
    benefits: [
      'Flat 20% off every event',
      'Flat 10% off for one tag along',
      'Early access to all events',
      'Exclusive Guild Path only events',
      'Valid for 3 months',
    ],
    note: "Free if you've attended 10+ events in the last year",
  },
  {
    key: 'adventurer',
    name: 'Adventurer',
    price_inr: 2000,
    period: '3 months',
    benefits: [
      'Everything under Initiate',
      'Flat 100% off every event',
      'Flat 100% off for one tag along for 1 event',
      'Valid for 3 months',
    ],
    note: null,
  },
  {
    key: 'guildmaster',
    name: 'Guildmaster',
    price_inr: 8000,
    period: '12 months',
    benefits: [
      'Everything under Adventurer',
      'Flat 100% off every event',
      'Flat 100% off for one tag along across 5 events',
      'Free 2 day passes for REPLAY conventions',
      'Valid for 12 months',
    ],
    note: null,
  },
];

const getCommunityLinks: McpTool = {
  name: 'get_community_links',
  description:
    "BGC's community links: WhatsApp group, Instagram, Discord, website, and the admin contact (also the route for cancellations).",
  inputSchema: { type: 'object', properties: {} },
  handler: async () => ({
    ...COMMUNITY,
    cancellations: CANCELLATION_NOTE,
  }),
};

const getGuildInfo: McpTool = {
  name: 'get_guild_info',
  description:
    'Guild Path membership tiers (Initiate / Adventurer / Guildmaster) with prices, duration, and benefits. Use join_guild_path to purchase.',
  inputSchema: { type: 'object', properties: {} },
  handler: async () => ({
    tiers: GUILD_TIERS,
    purchase_url: `${COMMUNITY.website}/guild-path`,
  }),
};

const myStatus: McpTool = {
  name: 'my_status',
  description:
    "Look up a person's BGC status by phone number: upcoming registrations, waitlist entries, Guild Path membership, and credit balance. Only call this when the user asks about their own status and has given you their phone number.",
  inputSchema: {
    type: 'object',
    properties: { phone: { type: 'string', description: '10-digit Indian mobile number' } },
    required: ['phone'],
  },
  handler: async (args, env) => {
    const phone = sanitizePhone(String(args.phone ?? ''));
    if (!phone) throw new ToolError("That doesn't look like a valid Indian phone number (10 digits, optionally with +91).");

    const supabase = getSupabase(env);
    const { data: user } = await supabase
      .from('users')
      .select('id, name, email')
      .eq('phone', phone)
      .maybeSingle();

    if (!user) {
      return { found: false, message: 'No BGC records for this phone number yet — registering for an event will create one.' };
    }

    const today = new Date().toISOString().split('T')[0];

    const { data: regs } = await supabase
      .from('registrations')
      .select('seats, total_amount, payment_status, events(name, date, venue_name)')
      .eq('user_id', user.id)
      .neq('payment_status', 'cancelled');

    const upcoming = (regs || [])
      .filter((r: any) => r.events?.date >= today)
      .map((r: any) => ({
        event: r.events.name,
        date: r.events.date,
        venue: r.events.venue_name,
        seats: r.seats,
        amount_inr: r.total_amount,
        payment_status: r.payment_status,
      }));

    const { data: member } = await supabase
      .from('guild_path_members')
      .select('tier, expires_at, plus_ones_used')
      .eq('user_id', user.id)
      .eq('status', 'paid')
      .gte('expires_at', today)
      .order('expires_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: waitlistRows } = await supabase
      .from('leads')
      .select('seats, waitlist_at, events(name, date)')
      .eq('phone', phone)
      .not('waitlist_at', 'is', null)
      .is('converted_at', null);

    const waitlist = (waitlistRows || [])
      .filter((w: any) => w.events?.date >= today)
      .map((w: any) => ({ event: w.events.name, date: w.events.date, seats: w.seats }));

    const creditBalance = await getUserBalance(supabase, user.id);

    return {
      found: true,
      name: user.name,
      upcoming_registrations: upcoming,
      guild_membership: member
        ? { tier: member.tier, expires_at: member.expires_at }
        : null,
      waitlist,
      credit_balance_inr: creditBalance,
    };
  },
};

export const infoTools: McpTool[] = [getCommunityLinks, getGuildInfo, myStatus];
