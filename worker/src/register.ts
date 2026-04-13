import type { Env } from './index';
export async function handleRegister(request: Request, env: Env): Promise<Response> {
  return new Response(JSON.stringify({ error: 'Not implemented' }), { status: 501 });
}
