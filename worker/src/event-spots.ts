import type { Env } from './index';
export async function handleEventSpots(eventId: string, env: Env): Promise<Response> {
  return new Response(JSON.stringify({ error: 'Not implemented' }), { status: 501 });
}
