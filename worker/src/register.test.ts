import { describe, expect, it, vi } from 'vitest';

function mockEnv() {
  return {
    SUPABASE_URL: 'x', SUPABASE_SERVICE_KEY: 'x',
    UPI_ID: 'x', APPS_SCRIPT_URL: '', APPS_SCRIPT_SECRET: '', BGC_SITE_URL: '',
    CF_ACCESS_TEAM_DOMAIN: 'x', CF_ACCESS_AUD: 'x', ADMIN_EMAILS: '', ENVIRONMENT: 'production',
  } as any;
}

vi.mock('./supabase', () => ({ getSupabase: vi.fn() }));
vi.mock('./email', () => ({ sendEventRegistrationEmail: vi.fn(async () => undefined) }));
vi.mock('./credits', () => ({
  applyCreditsToTotal: vi.fn(async (_s: any, _u: string, total: number) => ({ creditsApplied: 0, finalAmount: total })),
  recordCreditEvent: vi.fn(async () => undefined),
}));

import { getSupabase } from './supabase';
import { handleRegister } from './register';

function buildSupabaseMock(capture: { leadUpdate: any }) {
  return {
    from: (table: string) => {
      if (table === 'events') {
        return {
          select: () => ({ eq: () => ({ eq: () => ({ single: async () => ({ data: {
            id: 'E1', name: 'Test', date: '2026-06-01', venue_name: 'V', venue_area: null,
            price: 500, capacity: 10, custom_questions: [], price_includes: null, is_published: true,
          }, error: null }) }) }) }),
        };
      }
      if (table === 'registrations') {
        return {
          select: () => ({ eq: () => ({ neq: async () => ({ data: [], error: null }) }) }),
          insert: () => ({ select: () => ({ single: async () => ({ data: { id: 'R1' }, error: null }) }) }),
        };
      }
      if (table === 'users') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
          insert: () => ({ select: () => ({ single: async () => ({ data: { id: 'U1' }, error: null }) }) }),
        };
      }
      if (table === 'guild_path_members') {
        return {
          select: () => ({ eq: () => ({ eq: () => ({ gte: () => ({ order: () => ({ limit: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) }) }) }),
        };
      }
      if (table === 'leads') {
        return {
          update: (arg: any) => {
            capture.leadUpdate = { ...capture.leadUpdate, set: arg };
            return {
              eq: (c1: string, v1: string) => {
                capture.leadUpdate = { ...capture.leadUpdate, [c1]: v1 };
                return {
                  eq: (c2: string, v2: string) => {
                    capture.leadUpdate = { ...capture.leadUpdate, [c2]: v2 };
                    return {
                      is: (c3: string, v3: any) => {
                        capture.leadUpdate = { ...capture.leadUpdate, [`${c3}_is`]: v3 };
                        return {
                          is: async (c4: string, v4: any) => {
                            capture.leadUpdate = { ...capture.leadUpdate, [`${c4}_is`]: v4 };
                            return { error: null };
                          },
                        };
                      },
                    };
                  },
                };
              },
            };
          },
        };
      }
      return null;
    },
  };
}

describe('handleRegister lead conversion', () => {
  it('marks matching open lead as converted after successful registration', async () => {
    const capture = { leadUpdate: null as any };
    (getSupabase as any).mockReturnValue(buildSupabaseMock(capture));

    const req = new Request('http://localhost/api/register', {
      method: 'POST',
      body: JSON.stringify({
        event_id: 'E1',
        name: 'Asha',
        phone: '9876543210',
        email: 'a@b.com',
        seats: 1,
        custom_answers: {},
        payment_status: 'pending',
      }),
    });
    const ctx = { waitUntil: (p: Promise<unknown>) => p } as any;

    const res = await handleRegister(req, mockEnv(), ctx);
    expect(res.status).toBe(200);

    expect(capture.leadUpdate).not.toBeNull();
    expect(capture.leadUpdate.set.converted_at).toBeTruthy();
    expect(capture.leadUpdate.set.registration_id).toBe('R1');
    expect(capture.leadUpdate.phone).toBe('9876543210');
    expect(capture.leadUpdate.event_id).toBe('E1');
    expect(capture.leadUpdate.converted_at_is).toBeNull();
    expect(capture.leadUpdate.junk_at_is).toBeNull();
  });
});
