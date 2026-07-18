import type { McpTool } from './types';
import { COMMUNITY, CANCELLATION_NOTE } from './links';

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

export const infoTools: McpTool[] = [getCommunityLinks, getGuildInfo];
