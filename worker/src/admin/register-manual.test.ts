import { describe, it, expect, vi } from 'vitest';

function mockEnv() {
  return {
    SUPABASE_URL: 'x', SUPABASE_SERVICE_KEY: 'x',
    UPI_ID: 'x', APPS_SCRIPT_URL: '', APPS_SCRIPT_SECRET: '', BGC_SITE_URL: '',
    CF_ACCESS_TEAM_DOMAIN: 'x', CF_ACCESS_AUD: 'x', ADMIN_EMAILS: '', ENVIRONMENT: 'production',
  } as any;
}

vi.mock('../supabase', () => ({
  getSupabase: vi.fn(),
}));

vi.mock('../email', () => ({
  sendEventRegistrationEmail: vi.fn(async () => undefined),
}));

vi.mock('../promos', () => ({
  getApplicablePromo: vi.fn(async () => null),
  consumePromoUses: vi.fn(async () => true),
  restorePromoUses: vi.fn(async () => undefined),
}));

import { getSupabase } from '../supabase';
import { handleManualRegister } from './register-manual';

function noMember() {
  return {
    select: () => ({
      eq: () => ({
        eq: () => ({
          gte: () => ({
            order: () => ({
              limit: () => ({
                maybeSingle: async () => ({ data: null, error: null }),
              }),
            }),
          }),
        }),
      }),
    }),
  };
}

function buildSupabaseMock(eventRow: any, regs: any[]) {
  return {
    from: (table: string) => {
      if (table === 'events') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: eventRow, error: null }) }) }),
        };
      }
      if (table === 'registrations') {
        return {
          select: () => ({ eq: () => ({ neq: async () => ({ data: regs, error: null }) }) }),
          insert: () => ({ select: () => ({ single: async () => ({ data: { id: 'new-reg' }, error: null }) }) }),
        };
      }
      if (table === 'users') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'user-1' }, error: null }) }) }),
          update: () => ({ eq: async () => ({ error: null }) }),
        };
      }
      if (table === 'guild_path_members') {
        return noMember();
      }
      if (table === 'user_credits') {
        return {
          select: () => ({ eq: async () => ({ data: [], error: null }) }),
          insert: async () => ({ error: null }),
        };
      }
      return null;
    },
  };
}

describe('handleManualRegister', () => {
  it('rejects manual registrations for externally managed events', async () => {
    (getSupabase as any).mockReturnValue(buildSupabaseMock(
      {
        id: 'e1',
        name: 'TTRPGcon',
        externally_managed: true,
        external_registration_url: 'https://ttrpgcon.example/register',
      },
      [],
    ));
    const req = new Request('http://localhost/api/admin/registrations/manual', {
      method: 'POST',
      body: JSON.stringify({
        event_id: 'e1',
        name: 'A',
        phone: '9999999999',
        email: 'a@x.com',
        seats: 1,
        payment_status: 'confirmed',
      }),
    });
    const res = await handleManualRegister(req, mockEnv(), { waitUntil: () => {} } as any);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      code: 'external_registration',
      external_registration_url: 'https://ttrpgcon.example/register',
    });
  });

  it('warns (409) when seats exceed remaining capacity and overbook not confirmed', async () => {
    (getSupabase as any).mockReturnValue(buildSupabaseMock(
      { id: 'e1', name: 'Test', date: '2026-06-01T00:00:00Z', price: 500, capacity: 10, custom_questions: null, is_published: true, venue_name: 'X', venue_area: null, price_includes: null },
      [{ seats: 9, payment_status: 'confirmed' }],
    ));
    const req = new Request('http://localhost/api/admin/registrations/manual', {
      method: 'POST',
      body: JSON.stringify({ event_id: 'e1', name: 'A', phone: '9999999999', email: 'a@x.com', seats: 5, payment_status: 'confirmed', custom_answers: {} }),
    });
    const ctx = { waitUntil: () => {} } as any;
    const res = await handleManualRegister(req, mockEnv(), ctx);
    expect(res.status).toBe(409);
    const body = await res.json<any>();
    expect(body.capacity_exceeded).toBe(true);
    expect(body).toMatchObject({ capacity: 10, taken: 9, requested: 5 });
  });

  it('allows overbooking when allow_overbook is true', async () => {
    (getSupabase as any).mockReturnValue(buildSupabaseMock(
      { id: 'e1', name: 'Test', date: '2026-06-01T00:00:00Z', price: 500, capacity: 10, custom_questions: null, is_published: true, venue_name: 'X', venue_area: null, price_includes: null },
      [{ seats: 9, payment_status: 'confirmed' }],
    ));
    const req = new Request('http://localhost/api/admin/registrations/manual', {
      method: 'POST',
      body: JSON.stringify({ event_id: 'e1', name: 'A', phone: '9999999999', email: 'a@x.com', seats: 5, payment_status: 'confirmed', custom_answers: {}, allow_overbook: true }),
    });
    const ctx = { waitUntil: () => {} } as any;
    const res = await handleManualRegister(req, mockEnv(), ctx);
    expect(res.status).toBe(200);
  });

  it('applies user credits against the total and records a registration_use ledger row', async () => {
    let registrationInsert: any = null;
    let creditInsert: any = null;
    (getSupabase as any).mockReturnValue({
      from: (table: string) => {
        if (table === 'events') {
          return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'e1', name: 'T', date: '2026-06-01T00:00:00Z', price: 800, capacity: 10, custom_questions: null, is_published: true, venue_name: 'X', venue_area: null, price_includes: null }, error: null }) }) }) };
        }
        if (table === 'registrations') {
          return {
            select: () => ({ eq: () => ({ neq: async () => ({ data: [], error: null }) }) }),
            insert: (row: any) => { registrationInsert = row; return { select: () => ({ single: async () => ({ data: { id: 'r-credits' }, error: null }) }) }; },
          };
        }
        if (table === 'users') {
          return {
            select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'u-credit' }, error: null }) }) }),
            update: () => ({ eq: async () => ({ error: null }) }),
          };
        }
        if (table === 'guild_path_members') {
          return noMember();
        }
        if (table === 'user_credits') {
          return {
            select: () => ({ eq: async () => ({ data: [{ amount: 500 }], error: null }) }),
            insert: async (row: any) => { creditInsert = row; return { error: null }; },
          };
        }
        return null;
      },
    });
    const req = new Request('http://localhost/api/admin/registrations/manual', {
      method: 'POST',
      body: JSON.stringify({ event_id: 'e1', name: 'A', phone: '9999999999', email: 'a@x.com', seats: 1, payment_status: 'confirmed', custom_answers: {} }),
    });
    const ctx = { waitUntil: () => {} } as any;
    const res = await handleManualRegister(req, mockEnv(), ctx);
    expect(res.status).toBe(200);
    expect(registrationInsert.total_amount).toBe(300);
    expect(registrationInsert.credits_applied).toBe(500);
    expect(creditInsert).toMatchObject({
      user_id: 'u-credit',
      amount: -500,
      reason: 'registration_use',
      registration_id: 'r-credits',
    });
  });

  it('sets source to "admin" on success', async () => {
    let inserted: any = null;
    (getSupabase as any).mockReturnValue({
      from: (table: string) => {
        if (table === 'events') {
          return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'e1', name: 'T', date: '2026-06-01T00:00:00Z', price: 0, capacity: 10, custom_questions: null, is_published: true, venue_name: 'X', venue_area: null, price_includes: null }, error: null }) }) }) };
        }
        if (table === 'registrations') {
          return {
            select: () => ({ eq: () => ({ neq: async () => ({ data: [], error: null }) }) }),
            insert: (row: any) => { inserted = row; return { select: () => ({ single: async () => ({ data: { id: 'r1' }, error: null }) }) }; },
          };
        }
        if (table === 'users') {
          return {
            select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'u1' }, error: null }) }) }),
            update: () => ({ eq: async () => ({ error: null }) }),
          };
        }
        if (table === 'guild_path_members') {
          return noMember();
        }
        return null;
      },
    });
    const req = new Request('http://localhost/api/admin/registrations/manual', {
      method: 'POST',
      body: JSON.stringify({ event_id: 'e1', name: 'A', phone: '9999999999', email: 'a@x.com', seats: 1, payment_status: 'confirmed', custom_answers: {} }),
    });
    const ctx = { waitUntil: () => {} } as any;
    const res = await handleManualRegister(req, mockEnv(), ctx);
    expect(res.status).toBe(200);
    expect(inserted.source).toBe('admin');
    expect(inserted.payment_status).toBe('confirmed');
  });

  it('marks a matching open lead converted after a manual registration', async () => {
    let leadUpdate: any = null;
    const leadFilters: Record<string, unknown> = {};
    (getSupabase as any).mockReturnValue({
      from: (table: string) => {
        if (table === 'events') {
          return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'e1', name: 'T', date: '2026-06-01T00:00:00Z', price: 0, capacity: 10, custom_questions: null, is_published: true, venue_name: 'X', venue_area: null, price_includes: null }, error: null }) }) }) };
        }
        if (table === 'registrations') {
          return {
            select: () => ({ eq: () => ({ neq: async () => ({ data: [], error: null }) }) }),
            insert: () => ({ select: () => ({ single: async () => ({ data: { id: 'reg-99' }, error: null }) }) }),
          };
        }
        if (table === 'users') {
          return {
            select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'u1' }, error: null }) }) }),
            update: () => ({ eq: async () => ({ error: null }) }),
          };
        }
        if (table === 'guild_path_members') {
          return noMember();
        }
        if (table === 'leads') {
          return {
            update: (row: any) => {
              leadUpdate = row;
              return {
                eq: (col: string, val: unknown) => { leadFilters[col] = val; return {
                  eq: (col2: string, val2: unknown) => { leadFilters[col2] = val2; return {
                    is: (col3: string, val3: unknown) => { leadFilters[col3] = val3; return {
                      is: async (col4: string, val4: unknown) => { leadFilters[col4] = val4; return { error: null }; },
                    }; },
                  }; },
                }; },
              };
            },
          };
        }
        return null;
      },
    });
    const req = new Request('http://localhost/api/admin/registrations/manual', {
      method: 'POST',
      body: JSON.stringify({ event_id: 'e1', name: 'A', phone: '9999999999', email: 'a@x.com', seats: 1, payment_status: 'pending', custom_answers: {} }),
    });
    const ctx = { waitUntil: () => {} } as any;
    const res = await handleManualRegister(req, mockEnv(), ctx);
    expect(res.status).toBe(200);
    expect(leadUpdate).toMatchObject({ registration_id: 'reg-99' });
    expect(leadUpdate.converted_at).toBeTruthy();
    expect(leadFilters).toMatchObject({
      phone: '9999999999',
      event_id: 'e1',
      converted_at: null,
      junk_at: null,
    });
  });
});

describe('handleManualRegister differential pricing', () => {
  const pricedEvent = {
    id: 'e1', name: 'Test', date: '2026-06-01T00:00:00Z',
    price: 500, capacity: 20, is_published: true,
    venue_name: 'X', venue_area: null, price_includes: null,
    custom_questions: [
      { id: 'table', label: 'Table', type: 'radio', required: true,
        options: [{ value: 'Standard' }, { value: 'VIP', price: 800 }] },
    ],
  };

  function buildPricingMock(capture: { insert: any }) {
    return {
      from: (table: string) => {
        if (table === 'events') {
          return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: pricedEvent, error: null }) }) }) };
        }
        if (table === 'registrations') {
          return {
            select: () => ({ eq: () => ({ neq: async () => ({ data: [], error: null }) }) }),
            insert: (row: any) => { capture.insert = row; return { select: () => ({ single: async () => ({ data: { id: 'reg-dp' }, error: null }) }) }; },
          };
        }
        if (table === 'users') {
          return {
            select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'u1' }, error: null }) }) }),
            update: () => ({ eq: async () => ({ error: null }) }),
          };
        }
        if (table === 'guild_path_members') {
          return noMember();
        }
        if (table === 'user_credits') {
          return {
            select: () => ({ eq: async () => ({ data: [], error: null }) }),
            insert: async () => ({ error: null }),
          };
        }
        return null;
      },
    };
  }

  it('charges the option price × seats when a priced option is selected', async () => {
    const capture = { insert: null as any };
    (getSupabase as any).mockReturnValue(buildPricingMock(capture));
    const req = new Request('http://localhost/api/admin/registrations/manual', {
      method: 'POST',
      body: JSON.stringify({
        event_id: 'e1', name: 'A', phone: '9999999999', email: 'a@x.com',
        seats: 2, payment_status: 'confirmed', custom_answers: { table: 'VIP' },
      }),
    });
    const ctx = { waitUntil: () => {} } as any;
    const res = await handleManualRegister(req, mockEnv(), ctx);
    expect(res.status).toBe(200);
    expect(capture.insert.total_amount).toBe(1600); // 800 * 2 seats
  });

  it('falls back to base price when the unpriced option is chosen', async () => {
    const capture = { insert: null as any };
    (getSupabase as any).mockReturnValue(buildPricingMock(capture));
    const req = new Request('http://localhost/api/admin/registrations/manual', {
      method: 'POST',
      body: JSON.stringify({
        event_id: 'e1', name: 'A', phone: '9999999999', email: 'a@x.com',
        seats: 1, payment_status: 'confirmed', custom_answers: { table: 'Standard' },
      }),
    });
    const ctx = { waitUntil: () => {} } as any;
    await handleManualRegister(req, mockEnv(), ctx);
    expect(capture.insert.total_amount).toBe(500);
  });
});
