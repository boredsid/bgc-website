import { describe, it, expect } from 'vitest';
import { flattenGuildMembers, type GuildRow } from './export-guild';

describe('flattenGuildMembers', () => {
  const rows: GuildRow[] = [
    {
      id: 'g1', user_id: 'u1', tier: 'adventurer', status: 'paid',
      starts_at: '2026-01-01', expires_at: '2027-01-01',
      plus_ones_used: 2, source: 'web',
      users: { name: 'Alice', phone: '9876500001', email: 'a@x.com' },
    },
    {
      id: 'g2', user_id: 'u2', tier: 'initiate', status: 'pending',
      starts_at: null, expires_at: null,
      plus_ones_used: 0, source: null,
      users: { name: 'Bob', phone: '9876500002', email: null },
    },
  ];

  it('returns the documented header order', () => {
    const { headers } = flattenGuildMembers(rows);
    expect(headers).toEqual(['name', 'phone', 'email', 'tier', 'status', 'starts_at', 'expires_at', 'plus_ones_used', 'source']);
  });

  it('flattens joined user fields and member fields', () => {
    const { rows: out } = flattenGuildMembers(rows);
    expect(out[0]).toEqual({
      name: 'Alice', phone: '9876500001', email: 'a@x.com',
      tier: 'adventurer', status: 'paid',
      starts_at: '2026-01-01', expires_at: '2027-01-01',
      plus_ones_used: 2, source: 'web',
    });
  });

  it('handles missing user joins gracefully (null name/email, empty phone)', () => {
    const orphan: GuildRow[] = [{ ...rows[1], users: null }];
    const out = flattenGuildMembers(orphan).rows[0];
    expect(out.name).toBe('');
    expect(out.email).toBe('');
    expect(out.phone).toBe('');
  });
});
