import { describe, expect, it } from 'vitest';
import { infoTools } from './info-tools';

const env = { UPI_ID: 'bgc@upi', BGC_SITE_URL: 'https://boardgamecompany.in' } as any;
const ctx = { waitUntil: (p: Promise<unknown>) => p } as any;

function tool(name: string) {
  const t = infoTools.find((t) => t.name === name);
  if (!t) throw new Error(`missing tool ${name}`);
  return t;
}

describe('get_community_links', () => {
  it('returns all community links and the cancellation contact', async () => {
    const out = await tool('get_community_links').handler({}, env, ctx) as any;
    expect(out.whatsapp_group).toBe('https://chat.whatsapp.com/GL1h4jipksfCW4vm7OtZjp');
    expect(out.instagram).toBe('https://instagram.com/boardgamecompany');
    expect(out.discord).toBe('https://discord.gg/7ck6U59UuJ');
    expect(out.website).toBe('https://boardgamecompany.in');
    expect(out.admin_contact_whatsapp).toBe('https://wa.me/919982200768');
    expect(out.cancellations).toContain('wa.me/919982200768');
  });
});

describe('get_guild_info', () => {
  it('returns the three tiers with prices and purchase URL', async () => {
    const out = await tool('get_guild_info').handler({}, env, ctx) as any;
    expect(out.tiers).toHaveLength(3);
    const byKey = Object.fromEntries(out.tiers.map((t: any) => [t.key, t]));
    expect(byKey.initiate.price_inr).toBe(600);
    expect(byKey.adventurer.price_inr).toBe(2000);
    expect(byKey.guildmaster.price_inr).toBe(8000);
    expect(byKey.guildmaster.period).toBe('12 months');
    expect(byKey.initiate.benefits.length).toBeGreaterThan(0);
    expect(out.purchase_url).toBe('https://boardgamecompany.in/guild-path');
  });
});
