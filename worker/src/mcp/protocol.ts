import type { Env } from '../index';
import { ToolError, type McpTool } from './types';

const LATEST_VERSION = '2025-06-18';
const SUPPORTED_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

const SERVER_INFO = { name: 'bgc-mcp', version: '1.0.0' };

const INSTRUCTIONS = `Board Game Company (BGC) is Bangalore's tabletop board-gaming community. These tools browse upcoming events, the game library, and event photos, check a person's registrations and membership, register for events, join waitlists, and purchase Guild Path memberships.

Payments: BGC uses UPI. No tool takes payment — when a registration or purchase is created, relay the returned UPI details and payment link to the user exactly as given; the user completes payment themselves. Never state or imply that payment has been made.

Personal data: only pass a phone number when the user has explicitly asked you to act on their behalf.

Duplicate bookings: if register_for_event returns requires_confirmation, the person already has a spot for that event — tell them so explicitly, and only retry with confirm_additional: true after they clearly say they want an additional spot.

Cancellations cannot be done through these tools — the user must message a BGC admin on WhatsApp (see get_community_links).`;

interface RpcMessage {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: Record<string, unknown>;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function rpcResult(id: number | string, result: unknown) {
  return { jsonrpc: '2.0', id, result };
}

function rpcError(id: number | string | null, code: number, message: string) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

export async function handleMcp(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  tools: McpTool[],
): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed. POST JSON-RPC 2.0 messages to this endpoint.' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Allow: 'POST' },
    });
  }

  let msg: RpcMessage;
  try {
    msg = (await request.json()) as RpcMessage;
  } catch {
    return json(rpcError(null, -32700, 'Parse error'), 400);
  }

  // JSON-RPC batching was removed in protocol 2025-06-18; single messages only.
  if (msg === null || typeof msg !== 'object' || Array.isArray(msg) || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    return json(rpcError(null, -32600, 'Invalid request'), 400);
  }

  // Notifications carry no id and expect no response body.
  if (msg.id === undefined || msg.id === null) {
    return new Response(null, { status: 202 });
  }

  const id = msg.id;

  switch (msg.method) {
    case 'initialize': {
      const requested = String(msg.params?.protocolVersion ?? '');
      const protocolVersion = SUPPORTED_VERSIONS.includes(requested) ? requested : LATEST_VERSION;
      return json(rpcResult(id, {
        protocolVersion,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      }));
    }

    case 'ping':
      return json(rpcResult(id, {}));

    case 'tools/list':
      return json(rpcResult(id, {
        tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
      }));

    case 'tools/call': {
      const name = String(msg.params?.name ?? '');
      const tool = tools.find((t) => t.name === name);
      if (!tool) return json(rpcError(id, -32602, `Unknown tool: ${name}`));

      const args = (msg.params?.arguments ?? {}) as Record<string, unknown>;
      try {
        const data = await tool.handler(args, env, ctx);
        return json(rpcResult(id, {
          content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
          isError: false,
        }));
      } catch (err) {
        const text = err instanceof ToolError
          ? err.message
          : 'Something went wrong on our side. Please try again in a moment.';
        if (!(err instanceof ToolError)) console.error('[mcp] tool error', name, err);
        return json(rpcResult(id, { content: [{ type: 'text', text }], isError: true }));
      }
    }

    default:
      return json(rpcError(id, -32601, `Method not found: ${msg.method}`));
  }
}
