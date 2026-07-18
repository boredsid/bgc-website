import { describe, expect, it, vi } from 'vitest';
import { handleMcp } from './protocol';
import { ToolError, type McpTool } from './types';

const env = {} as any;
const ctx = { waitUntil: (p: Promise<unknown>) => p } as any;

function post(body: unknown): Request {
  return new Request('https://api.boardgamecompany.in/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function rpc(method: string, params?: unknown, id: number | string | null = 1) {
  return { jsonrpc: '2.0', id, method, ...(params !== undefined ? { params } : {}) };
}

const echoTool: McpTool = {
  name: 'echo',
  description: 'Echoes arguments back',
  inputSchema: { type: 'object', properties: { msg: { type: 'string' } } },
  handler: async (args) => ({ echoed: args.msg }),
};

const failingTool: McpTool = {
  name: 'fail',
  description: 'Always fails',
  inputSchema: { type: 'object' },
  handler: async () => { throw new ToolError('This event is full'); },
};

const crashingTool: McpTool = {
  name: 'crash',
  description: 'Throws unexpectedly',
  inputSchema: { type: 'object' },
  handler: async () => { throw new Error('supabase exploded: secret detail'); },
};

const TOOLS = [echoTool, failingTool, crashingTool];

describe('handleMcp protocol', () => {
  it('rejects non-POST with 405', async () => {
    const res = await handleMcp(new Request('https://x/mcp', { method: 'GET' }), env, ctx, TOOLS);
    expect(res.status).toBe(405);
  });

  it('returns -32700 on malformed JSON', async () => {
    const res = await handleMcp(post('{nope'), env, ctx, TOOLS);
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error.code).toBe(-32700);
  });

  it('returns -32600 on a JSON-RPC batch (removed in 2025-06-18)', async () => {
    const res = await handleMcp(post([rpc('ping')]), env, ctx, TOOLS);
    const body = await res.json() as any;
    expect(body.error.code).toBe(-32600);
  });

  it('answers initialize with negotiated version, capabilities, serverInfo, instructions', async () => {
    const res = await handleMcp(post(rpc('initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'test', version: '0' },
    })), env, ctx, TOOLS);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.result.protocolVersion).toBe('2025-03-26'); // echoes supported client version
    expect(body.result.capabilities.tools).toEqual({});
    expect(body.result.serverInfo.name).toBe('bgc-mcp');
    expect(typeof body.result.instructions).toBe('string');
  });

  it('falls back to 2025-06-18 for unknown client versions', async () => {
    const res = await handleMcp(post(rpc('initialize', { protocolVersion: '1999-01-01' })), env, ctx, TOOLS);
    const body = await res.json() as any;
    expect(body.result.protocolVersion).toBe('2025-06-18');
  });

  it('accepts notifications with 202 and empty body', async () => {
    const res = await handleMcp(post({ jsonrpc: '2.0', method: 'notifications/initialized' }), env, ctx, TOOLS);
    expect(res.status).toBe(202);
  });

  it('answers ping with empty result', async () => {
    const res = await handleMcp(post(rpc('ping')), env, ctx, TOOLS);
    const body = await res.json() as any;
    expect(body.result).toEqual({});
    expect(body.id).toBe(1);
  });

  it('lists tools with name, description, inputSchema and nothing else', async () => {
    const res = await handleMcp(post(rpc('tools/list')), env, ctx, TOOLS);
    const body = await res.json() as any;
    expect(body.result.tools).toHaveLength(3);
    expect(body.result.tools[0]).toEqual({
      name: 'echo',
      description: 'Echoes arguments back',
      inputSchema: { type: 'object', properties: { msg: { type: 'string' } } },
    });
  });

  it('calls a tool and wraps the result as text content', async () => {
    const res = await handleMcp(post(rpc('tools/call', { name: 'echo', arguments: { msg: 'hi' } })), env, ctx, TOOLS);
    const body = await res.json() as any;
    expect(body.result.isError).toBe(false);
    expect(JSON.parse(body.result.content[0].text)).toEqual({ echoed: 'hi' });
    expect(body.result.content[0].type).toBe('text');
  });

  it('turns ToolError into isError result with the message verbatim', async () => {
    const res = await handleMcp(post(rpc('tools/call', { name: 'fail', arguments: {} })), env, ctx, TOOLS);
    const body = await res.json() as any;
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toBe('This event is full');
  });

  it('hides unexpected error details behind a generic message', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await handleMcp(post(rpc('tools/call', { name: 'crash', arguments: {} })), env, ctx, TOOLS);
    const body = await res.json() as any;
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).not.toContain('secret detail');
    spy.mockRestore();
  });

  it('returns -32602 for an unknown tool', async () => {
    const res = await handleMcp(post(rpc('tools/call', { name: 'nope', arguments: {} })), env, ctx, TOOLS);
    const body = await res.json() as any;
    expect(body.error.code).toBe(-32602);
  });

  it('returns -32601 for an unknown method', async () => {
    const res = await handleMcp(post(rpc('resources/list')), env, ctx, TOOLS);
    const body = await res.json() as any;
    expect(body.error.code).toBe(-32601);
  });
});
