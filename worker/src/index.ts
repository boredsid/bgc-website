import { handleLookupPhone } from './lookup-phone';
import { handleRegister } from './register';
import { handleEventSpots } from './event-spots';
import { handleGuildPurchase } from './guild-purchase';
import { handleCancelRegistration, handleCancelGuildMembership } from './cancel';
import { verifyAccessJwt } from './access-auth';
import { handleListEvents, handleGetEvent, handleCreateEvent, handleUpdateEvent } from './admin/events';

export interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
  UPI_ID: string;
  APPS_SCRIPT_URL: string;
  APPS_SCRIPT_SECRET: string;
  BGC_SITE_URL: string;
  CF_ACCESS_TEAM_DOMAIN: string;
  CF_ACCESS_AUD: string;
  ADMIN_EMAILS: string;
  ENVIRONMENT: string;
}

export interface AdminContext {
  email: string;
}

function corsHeaders(origin: string | null): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Cf-Access-Jwt-Assertion',
    'Access-Control-Allow-Credentials': 'true',
  };
}

async function gateAdmin(request: Request, env: Env): Promise<{ ok: true; admin: AdminContext } | { ok: false; response: Response }> {
  // Local dev escape hatch: when ENVIRONMENT=development, accept the
  // first email from ADMIN_EMAILS as the acting admin without verifying a JWT.
  // This branch is unreachable in production because wrangler.toml hard-codes
  // ENVIRONMENT="production".
  if (env.ENVIRONMENT === 'development') {
    const fallback = env.ADMIN_EMAILS.split(',')[0]?.trim();
    if (fallback) return { ok: true, admin: { email: fallback } };
  }

  const token = request.headers.get('Cf-Access-Jwt-Assertion') || '';
  const result = await verifyAccessJwt(token, env);
  if (!result.ok) {
    return {
      ok: false,
      response: new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    };
  }
  return { ok: true, admin: { email: result.email } };
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    const headers = corsHeaders(origin);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers });
    }

    try {
      let response: Response;

      if (url.pathname === '/api/lookup-phone' && request.method === 'POST') {
        response = await handleLookupPhone(request, env);
      } else if (url.pathname === '/api/register' && request.method === 'POST') {
        response = await handleRegister(request, env, ctx);
      } else if (url.pathname.startsWith('/api/event-spots/') && request.method === 'GET') {
        const eventId = url.pathname.split('/api/event-spots/')[1];
        response = await handleEventSpots(eventId, env);
      } else if (url.pathname === '/api/guild-purchase' && request.method === 'POST') {
        response = await handleGuildPurchase(request, env, ctx);
      } else if (url.pathname.startsWith('/api/admin/')) {
        const gate = await gateAdmin(request, env);
        if (!gate.ok) {
          response = gate.response;
        } else {
          let adminResponse: Response | null = null;
          if (url.pathname === '/api/admin/cancel-registration' && request.method === 'POST') {
            adminResponse = await handleCancelRegistration(request, env);
          } else if (url.pathname === '/api/admin/cancel-guild-membership' && request.method === 'POST') {
            adminResponse = await handleCancelGuildMembership(request, env);
          }

          if (!adminResponse) {
            const eventsMatch = url.pathname.match(/^\/api\/admin\/events(?:\/([^/]+))?$/);
            if (eventsMatch) {
              const eventId = eventsMatch[1];
              if (!eventId && request.method === 'GET') adminResponse = await handleListEvents(env);
              else if (!eventId && request.method === 'POST') adminResponse = await handleCreateEvent(request, env);
              else if (eventId && request.method === 'GET') adminResponse = await handleGetEvent(eventId, env);
              else if (eventId && request.method === 'PATCH') adminResponse = await handleUpdateEvent(eventId, request, env);
              else adminResponse = new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
            }
          }

          response = adminResponse ?? new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
        }
      } else {
        response = new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
      }

      const newHeaders = new Headers(response.headers);
      for (const [key, value] of Object.entries(headers)) {
        newHeaders.set(key, value);
      }
      return new Response(response.body, { status: response.status, headers: newHeaders });
    } catch (err) {
      console.error('[worker] error', err);
      return new Response(
        JSON.stringify({ error: 'Internal server error' }),
        { status: 500, headers: { ...headers, 'Content-Type': 'application/json' } }
      );
    }
  },
};
