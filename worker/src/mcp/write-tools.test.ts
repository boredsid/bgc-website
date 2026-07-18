import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../register', () => ({ handleRegister: vi.fn() }));
vi.mock('../waitlist', () => ({ handleWaitlist: vi.fn() }));
vi.mock('../guild-purchase', () => ({ handleGuildPurchase: vi.fn() }));
vi.mock('../supabase', () => ({ getSupabase: vi.fn() }));

import { handleRegister } from '../register';
import { handleWaitlist } from '../waitlist';
import { handleGuildPurchase } from '../guild-purchase';
import { getSupabase } from '../supabase';
import { writeTools } from './write-tools';

const env = { UPI_ID: 'bgc@okaxis', BGC_SITE_URL: 'https://boardgamecompany.in' } as any;
const ctx = { waitUntil: (p: Promise<unknown>) => p } as any;

function tool(name: string) {
  const t = writeTools.find((t) => t.name === name);
  if (!t) throw new Error(`missing tool ${name}`);
  return t;
}

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

beforeEach(() => vi.clearAllMocks());

describe('register_for_event', () => {
  const args = {
    event_id: 'E1', name: 'Asha', phone: '9876543210', email: 'a@b.com',
    seats: 2, custom_answers: { q1: 'Veg' },
  };

  it('registers via the existing handler with source=mcp and returns UPI payment details', async () => {
    (handleRegister as any).mockResolvedValue(jsonRes({ success: true, registration_id: 'R1' }));
    (getSupabase as any).mockReturnValue({
      from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: {
        total_amount: 900, discount_applied: null, credits_applied: 100, seats: 2,
        events: { name: 'Catan Night' },
      } }) }) }) }),
    });

    const out = await tool('register_for_event').handler(args, env, ctx) as any;

    // The synthetic request forwarded the right body to the real handler.
    const forwarded = await ((handleRegister as any).mock.calls[0][0] as Request).json();
    expect(forwarded).toMatchObject({
      event_id: 'E1', name: 'Asha', phone: '9876543210', email: 'a@b.com',
      seats: 2, custom_answers: { q1: 'Veg' }, payment_status: 'pending', source: 'mcp',
    });

    expect(out.registered).toBe(true);
    expect(out.registration_id).toBe('R1');
    expect(out.amount_due_inr).toBe(900);
    expect(out.credits_applied_inr).toBe(100);
    expect(out.payment.upi_id).toBe('bgc@okaxis');
    expect(out.payment.payee_name).toBe('Board Game Company');
    expect(out.payment.payment_page).toBe('https://boardgamecompany.in/pay?amount=900&for=Catan%20Night');
    expect(out.payment.instructions).toMatch(/relay/i);
    expect(out.cancellation).toContain('wa.me/919982200768');
  });

  it('defaults seats to 1 when omitted', async () => {
    (handleRegister as any).mockResolvedValue(jsonRes({ success: true, registration_id: 'R1' }));
    (getSupabase as any).mockReturnValue({
      from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: {
        total_amount: 500, discount_applied: null, credits_applied: 0, seats: 1, events: { name: 'X' },
      } }) }) }) }),
    });
    const { seats: _omit, ...rest } = args;
    await tool('register_for_event').handler(rest, env, ctx);
    const forwarded = await ((handleRegister as any).mock.calls[0][0] as Request).json();
    expect(forwarded.seats).toBe(1);
  });

  it('reports zero-amount registrations without payment details', async () => {
    (handleRegister as any).mockResolvedValue(jsonRes({ success: true, registration_id: 'R1' }));
    (getSupabase as any).mockReturnValue({
      from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: {
        total_amount: 0, discount_applied: 'adventurer', credits_applied: 0, seats: 1, events: { name: 'X' },
      } }) }) }) }),
    });
    const out = await tool('register_for_event').handler(args, env, ctx) as any;
    expect(out.amount_due_inr).toBe(0);
    expect(out.payment).toBeNull();
    expect(out.message).toMatch(/nothing to pay/i);
  });

  it('reports success without a false "nothing to pay" claim when the post-success amount fetch fails', async () => {
    (handleRegister as any).mockResolvedValue(jsonRes({ success: true, registration_id: 'R1' }));
    (getSupabase as any).mockReturnValue({
      from: () => ({ select: () => ({ eq: () => ({ single: async () => ({
        data: null, error: { message: 'boom' },
      }) }) }) }),
    });
    const out = await tool('register_for_event').handler(args, env, ctx) as any;
    expect(out.registered).toBe(true);
    expect(out.amount_due_inr).toBeNull();
    expect(out.payment).toBeNull();
    expect(JSON.stringify(out)).not.toMatch(/nothing to pay/i);
  });

  it('suggests the waitlist when the event is full', async () => {
    (handleRegister as any).mockResolvedValue(jsonRes({ error: 'Only 0 spots remaining' }, 400));
    await expect(tool('register_for_event').handler(args, env, ctx))
      .rejects.toThrow(/join_waitlist/);
  });

  it('explains guild-exclusive rejections', async () => {
    (handleRegister as any).mockResolvedValue(jsonRes({ success: false, error: 'guild_path_required' }, 403));
    await expect(tool('register_for_event').handler(args, env, ctx))
      .rejects.toThrow(/Guild Path members/i);
  });

  it('relays plain validation errors', async () => {
    (handleRegister as any).mockResolvedValue(jsonRes({ error: 'Invalid phone number' }, 400));
    await expect(tool('register_for_event').handler(args, env, ctx))
      .rejects.toThrow('Invalid phone number');
  });
});

describe('join_waitlist', () => {
  const args = { event_id: 'E1', name: 'Asha', phone: '9876543210', email: 'a@b.com', seats: 1 };

  it('joins the waitlist through the existing handler', async () => {
    (handleWaitlist as any).mockResolvedValue(jsonRes({ success: true }));
    const out = await tool('join_waitlist').handler(args, env, ctx) as any;
    expect(out.waitlisted).toBe(true);
    const forwarded = await ((handleWaitlist as any).mock.calls[0][0] as Request).json();
    expect(forwarded.source).toBe('mcp');
  });

  it('tells the agent to register normally when spots are actually available', async () => {
    (handleWaitlist as any).mockResolvedValue(jsonRes({ available: true }));
    const out = await tool('join_waitlist').handler(args, env, ctx) as any;
    expect(out.waitlisted).toBe(false);
    expect(out.message).toMatch(/register_for_event/);
  });
});

describe('join_guild_path', () => {
  const args = { tier: 'adventurer', name: 'Asha', phone: '9876543210', email: 'a@b.com' };

  it('purchases through the existing handler and returns UPI details', async () => {
    (handleGuildPurchase as any).mockResolvedValue(jsonRes({ success: true, purchase_id: 'P1' }));
    (getSupabase as any).mockReturnValue({
      from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: {
        amount: 2000, tier: 'adventurer', starts_at: '2026-07-18', expires_at: '2026-10-18',
      } }) }) }) }),
    });

    const out = await tool('join_guild_path').handler(args, env, ctx) as any;
    const forwarded = await ((handleGuildPurchase as any).mock.calls[0][0] as Request).json();
    expect(forwarded).toMatchObject({ tier: 'adventurer', source: 'mcp' });
    expect(out.purchased).toBe(true);
    expect(out.amount_due_inr).toBe(2000);
    expect(out.expires_at).toBe('2026-10-18');
    expect(out.payment.upi_id).toBe('bgc@okaxis');
    expect(out.payment.payment_page).toBe('https://boardgamecompany.in/pay?amount=2000&for=Adventurer%20(Guild%20Path)');
  });

  it('relays tier validation errors', async () => {
    (handleGuildPurchase as any).mockResolvedValue(jsonRes({ error: 'Invalid tier' }, 400));
    await expect(tool('join_guild_path').handler(args, env, ctx)).rejects.toThrow('Invalid tier');
  });

  it('reports success without a false "nothing to pay" claim when the post-success amount fetch fails', async () => {
    (handleGuildPurchase as any).mockResolvedValue(jsonRes({ success: true, purchase_id: 'P1' }));
    (getSupabase as any).mockReturnValue({
      from: () => ({ select: () => ({ eq: () => ({ single: async () => ({
        data: null, error: { message: 'boom' },
      }) }) }) }),
    });
    const out = await tool('join_guild_path').handler(args, env, ctx) as any;
    expect(out.purchased).toBe(true);
    expect(out.amount_due_inr).toBeNull();
    expect(out.payment).toBeNull();
    expect(JSON.stringify(out)).not.toMatch(/nothing to pay/i);
  });
});
