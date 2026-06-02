import type { Env } from '../index';
import { getSupabase } from '../supabase';
import { jsonResponse } from '../validation';
import { handleListRegistrations, handleGetRegistration, handleUpdateRegistration } from '../admin/registrations';
import { handleManualRegister } from '../admin/register-manual';
import { handleCancelRegistration } from '../cancel';
import { handleGetEvent } from '../admin/events';
import { handleLog } from '../admin/log';
import { handleListLeads, handleUpdateLead } from '../admin/leads';
import { handleGuestSummary } from './summary';
import { handleGuestLookupPhone } from './lookup-phone';

export interface GuestCtx {
  email: string;
  eventIds: string[];
}

async function registrationEventId(id: string, env: Env): Promise<string | null> {
  const supabase = getSupabase(env);
  const { data } = await supabase.from('registrations').select('event_id').eq('id', id).maybeSingle();
  return (data as { event_id: string } | null)?.event_id ?? null;
}

async function leadEventId(id: string, env: Env): Promise<string | null> {
  const supabase = getSupabase(env);
  const { data } = await supabase.from('leads').select('event_id').eq('id', id).maybeSingle();
  return (data as { event_id: string } | null)?.event_id ?? null;
}

async function guestWhoami(env: Env, guest: GuestCtx): Promise<Response> {
  const supabase = getSupabase(env);
  const { data } = await supabase.from('events').select('id, name, date').in('id', guest.eventIds);
  return jsonResponse({ email: guest.email, role: 'guest', events: data || [] });
}

export async function handleGuestRequest(
  url: URL,
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  guest: GuestCtx,
): Promise<Response> {
  const p = url.pathname;
  const allowed = new Set(guest.eventIds);

  if (p === '/api/admin/whoami' && request.method === 'GET') {
    return guestWhoami(env, guest);
  }

  if (p === '/api/admin/log' && request.method === 'POST') {
    return handleLog(request, env, guest.email);
  }

  if (p === '/api/admin/lookup-phone' && request.method === 'POST') {
    return handleGuestLookupPhone(request, env, allowed);
  }

  if (p === '/api/admin/summary' && request.method === 'GET') {
    return handleGuestSummary(env, guest.eventIds);
  }

  if (p === '/api/admin/leads' && request.method === 'GET') {
    const ev = url.searchParams.get('event_id');
    if (ev && !allowed.has(ev)) return jsonResponse({ error: 'Forbidden' }, 403);
    // Scope to the guest's events even when no event_id is supplied.
    return handleListLeads(request, env, guest.eventIds);
  }

  const leadMatch = p.match(/^\/api\/admin\/leads\/([^/]+)$/);
  if (leadMatch && leadMatch[1] !== 'export') {
    const id = leadMatch[1];
    const evId = await leadEventId(id, env);
    if (!evId || !allowed.has(evId)) return jsonResponse({ error: 'Forbidden' }, 403);
    if (request.method === 'PATCH') return handleUpdateLead(id, request, env);
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  if (p === '/api/admin/registrations' && request.method === 'GET') {
    const ev = url.searchParams.get('event_id');
    if (ev) {
      if (!allowed.has(ev)) return jsonResponse({ error: 'Forbidden' }, 403);
    } else if (guest.eventIds.length === 1) {
      url.searchParams.set('event_id', guest.eventIds[0]);
    } else {
      return jsonResponse({ error: 'event_id required' }, 400);
    }
    return handleListRegistrations(url, env);
  }

  if (p === '/api/admin/registrations/manual' && request.method === 'POST') {
    const body = (await request.clone().json().catch(() => null)) as { event_id?: string } | null;
    if (!body?.event_id || !allowed.has(body.event_id)) return jsonResponse({ error: 'Forbidden' }, 403);
    return handleManualRegister(request, env, ctx);
  }

  if (p === '/api/admin/cancel-registration' && request.method === 'POST') {
    const body = (await request.clone().json().catch(() => null)) as { registration_id?: string } | null;
    if (!body?.registration_id) return jsonResponse({ error: 'registration_id required' }, 400);
    const evId = await registrationEventId(body.registration_id, env);
    if (!evId || !allowed.has(evId)) return jsonResponse({ error: 'Forbidden' }, 403);
    return handleCancelRegistration(request, env);
  }

  const regMatch = p.match(/^\/api\/admin\/registrations\/([^/]+)$/);
  if (regMatch && regMatch[1] !== 'manual' && regMatch[1] !== 'export') {
    const id = regMatch[1];
    const evId = await registrationEventId(id, env);
    if (!evId || !allowed.has(evId)) return jsonResponse({ error: 'Forbidden' }, 403);
    if (request.method === 'GET') return handleGetRegistration(id, env);
    if (request.method === 'PATCH') return handleUpdateRegistration(id, request, env);
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const evMatch = p.match(/^\/api\/admin\/events\/([^/]+)$/);
  if (evMatch && request.method === 'GET') {
    if (!allowed.has(evMatch[1])) return jsonResponse({ error: 'Forbidden' }, 403);
    return handleGetEvent(evMatch[1], env, false);
  }

  return jsonResponse({ error: 'Forbidden' }, 403);
}
