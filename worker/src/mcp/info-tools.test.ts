import { describe, expect, it, vi } from 'vitest';

vi.mock('../supabase', () => ({ getSupabase: vi.fn() }));
vi.mock('../credits', () => ({ getUserBalance: vi.fn(async () => 150) }));

import { getSupabase } from '../supabase';
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

describe('my_status', () => {
  it('rejects an invalid phone with a friendly message', async () => {
    await expect(tool('my_status').handler({ phone: '12345' }, env, ctx))
      .rejects.toThrow(/valid Indian phone/i);
  });

  it('reports found=false for an unknown phone', async () => {
    (getSupabase as any).mockReturnValue({
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }),
    });
    const out = await tool('my_status').handler({ phone: '9876543210' }, env, ctx) as any;
    expect(out.found).toBe(false);
  });

  it('returns registrations, membership, waitlist, and credit balance', async () => {
    (getSupabase as any).mockReturnValue({
      from: (table: string) => {
        if (table === 'users') {
          return { select: () => ({ eq: () => ({ maybeSingle: async () => ({
            data: { id: 'U1', name: 'Asha', email: 'a@b.com' } }) }) }) };
        }
        if (table === 'registrations') {
          return { select: () => ({ eq: () => ({ neq: async () => ({ data: [
            { seats: 2, total_amount: 900, payment_status: 'confirmed',
              events: { name: 'Catan Night', date: '2099-01-15', venue_name: 'Dice District' } },
            { seats: 1, total_amount: 500, payment_status: 'pending',
              events: { name: 'Old Event', date: '2001-01-01', venue_name: 'X' } },
          ] }) }) }) };
        }
        if (table === 'guild_path_members') {
          return { select: () => ({ eq: () => ({ eq: () => ({ gte: () => ({ order: () => ({ limit: () => ({
            maybeSingle: async () => ({ data: { tier: 'adventurer', expires_at: '2099-12-31', plus_ones_used: 0 } }) }) }) }) }) }) }) };
        }
        if (table === 'leads') {
          return { select: () => ({ eq: () => ({ not: () => ({ is: async () => ({ data: [
            { seats: 2, waitlist_at: '2026-07-01T00:00:00Z',
              events: { name: 'Full House Night', date: '2099-02-01' } },
          ] }) }) }) }) };
        }
        return null;
      },
    });

    const out = await tool('my_status').handler({ phone: '9876543210' }, env, ctx) as any;
    expect(out.found).toBe(true);
    expect(out.name).toBe('Asha');
    expect(out.upcoming_registrations).toHaveLength(1); // past event filtered out
    expect(out.upcoming_registrations[0].event).toBe('Catan Night');
    expect(out.upcoming_registrations[0].payment_status).toBe('confirmed');
    expect(out.guild_membership.tier).toBe('adventurer');
    expect(out.waitlist).toHaveLength(1);
    expect(out.credit_balance_inr).toBe(150);
  });
});
