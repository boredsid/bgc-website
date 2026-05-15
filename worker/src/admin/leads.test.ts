// worker/src/admin/leads.test.ts
import { describe, expect, it, vi } from 'vitest';

function mockEnv() {
  return {
    SUPABASE_URL: 'x', SUPABASE_SERVICE_KEY: 'x',
    UPI_ID: 'x', APPS_SCRIPT_URL: '', APPS_SCRIPT_SECRET: '', BGC_SITE_URL: '',
    CF_ACCESS_TEAM_DOMAIN: 'x', CF_ACCESS_AUD: 'x', ADMIN_EMAILS: '', ENVIRONMENT: 'production',
  } as any;
}

vi.mock('../supabase', () => ({ getSupabase: vi.fn() }));

import { getSupabase } from '../supabase';
import { handleListLeads, handleUpdateLead, handleExportLeads } from './leads';

interface QueryCapture {
  filters: Array<{ op: string; col: string; val: any }>;
}

function buildListMock(rows: any[], capture: QueryCapture) {
  const builder: any = {
    select: () => builder,
    is: (col: string, val: any) => { capture.filters.push({ op: 'is', col, val }); return builder; },
    eq: (col: string, val: any) => { capture.filters.push({ op: 'eq', col, val }); return builder; },
    not: (col: string, op: string, val: any) => { capture.filters.push({ op: `not.${op}`, col, val }); return builder; },
    gte: (col: string, val: any) => { capture.filters.push({ op: 'gte', col, val }); return builder; },
    order: () => builder,
    limit: async () => ({ data: rows, error: null }),
  };
  return { from: (t: string) => { if (t !== 'leads') throw new Error('bad table ' + t); return builder; } };
}

describe('handleListLeads', () => {
  it('default filters: open + non-junk + last 30 days', async () => {
    const capture: QueryCapture = { filters: [] };
    (getSupabase as any).mockReturnValue(buildListMock([], capture));
    const req = new Request('http://localhost/api/admin/leads');
    const res = await handleListLeads(req, mockEnv());
    expect(res.status).toBe(200);
    expect(capture.filters).toContainEqual({ op: 'is', col: 'converted_at', val: null });
    expect(capture.filters).toContainEqual({ op: 'is', col: 'junk_at', val: null });
    expect(capture.filters.some((f) => f.op === 'gte' && f.col === 'created_at')).toBe(true);
  });

  it('include_converted=1 drops the converted_at filter', async () => {
    const capture: QueryCapture = { filters: [] };
    (getSupabase as any).mockReturnValue(buildListMock([], capture));
    const req = new Request('http://localhost/api/admin/leads?include_converted=1');
    await handleListLeads(req, mockEnv());
    expect(capture.filters.find((f) => f.col === 'converted_at')).toBeUndefined();
  });

  it('event_id filter is applied', async () => {
    const capture: QueryCapture = { filters: [] };
    (getSupabase as any).mockReturnValue(buildListMock([], capture));
    const req = new Request('http://localhost/api/admin/leads?event_id=E1');
    await handleListLeads(req, mockEnv());
    expect(capture.filters).toContainEqual({ op: 'eq', col: 'event_id', val: 'E1' });
  });

  it('has_name=yes uses not.is.null', async () => {
    const capture: QueryCapture = { filters: [] };
    (getSupabase as any).mockReturnValue(buildListMock([], capture));
    const req = new Request('http://localhost/api/admin/leads?has_name=yes');
    await handleListLeads(req, mockEnv());
    expect(capture.filters).toContainEqual({ op: 'not.is', col: 'name', val: null });
  });
});

describe('handleUpdateLead', () => {
  it('PATCH { junk: true } sets junk_at', async () => {
    const captured: { update: any; eq: { col: string; val: any } | null } = { update: null, eq: null };
    (getSupabase as any).mockReturnValue({
      from: () => ({
        update: (arg: any) => { captured.update = arg; return {
          eq: async (col: string, val: any) => { captured.eq = { col, val }; return { error: null }; },
        }; },
      }),
    });
    const req = new Request('http://localhost/api/admin/leads/L1', {
      method: 'PATCH',
      body: JSON.stringify({ junk: true }),
    });
    const res = await handleUpdateLead('L1', req, mockEnv());
    expect(res.status).toBe(200);
    expect(captured.update.junk_at).toBeTruthy();
    expect(captured.eq).toEqual({ col: 'id', val: 'L1' });
  });

  it('PATCH with no recognised fields returns 400', async () => {
    (getSupabase as any).mockReturnValue({ from: () => ({}) });
    const req = new Request('http://localhost/api/admin/leads/L1', {
      method: 'PATCH',
      body: JSON.stringify({ foo: 'bar' }),
    });
    const res = await handleUpdateLead('L1', req, mockEnv());
    expect(res.status).toBe(400);
  });
});

describe('handleExportLeads', () => {
  it('returns CSV with header + one data row', async () => {
    const capture: QueryCapture = { filters: [] };
    (getSupabase as any).mockReturnValue(buildListMock([
      {
        id: 'L1', phone: '9876543210', name: 'Asha', event_id: 'E1',
        last_step: 'name_entered', source: { utm_source: 'ig' },
        converted_at: null, junk_at: null, created_at: '2026-05-15T00:00:00Z',
        events: { name: 'Game Night' },
      },
    ], capture));
    const req = new Request('http://localhost/api/admin/leads/export');
    const res = await handleExportLeads(req, mockEnv());
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/csv');
    const body = await res.text();
    const lines = body.trim().split('\n');
    expect(lines[0]).toContain('phone');
    expect(lines.length).toBe(2);
    expect(lines[1]).toContain('9876543210');
  });

  it('escapes formula-injection in name cells', async () => {
    const capture: QueryCapture = { filters: [] };
    (getSupabase as any).mockReturnValue(buildListMock([
      {
        id: 'L1', phone: '9876543210', name: '=cmd|attack', event_id: 'E1',
        last_step: 'name_entered', source: null,
        converted_at: null, junk_at: null, created_at: '2026-05-15T00:00:00Z',
        events: { name: 'Game Night' },
      },
    ], capture));
    const req = new Request('http://localhost/api/admin/leads/export');
    const res = await handleExportLeads(req, mockEnv());
    const body = await res.text();
    expect(body).toContain("'=cmd|attack");
  });
});
