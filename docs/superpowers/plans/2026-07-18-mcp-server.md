# BGC MCP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A public MCP server at `POST api.boardgamecompany.in/mcp` (10 tools: browse events/library/photos/guild, check status, register, waitlist, guild purchase) plus a setup docs page at `boardgamecompany.in/mcp`.

**Architecture:** Hand-rolled stateless MCP Streamable-HTTP layer inside the existing Cloudflare Worker (`worker/src/mcp/`). Tool handlers reuse existing business logic — read tools query Supabase with the same shapes existing handlers use; write tools call the existing `handleRegister`/`handleWaitlist`/`handleGuildPurchase` with a synthetic `Request` and adapt the `Response` (zero changes to production flows), then do one follow-up select to fetch the amount for UPI instructions.

**Tech Stack:** TypeScript, Cloudflare Workers, `@supabase/supabase-js`, Vitest. **No new dependencies.**

**Spec:** `docs/superpowers/specs/2026-07-18-mcp-server-design.md`

**Deviation from spec (deliberate):** the spec says "extract [each handler's] core into a callable function". Instead, write tools invoke the existing handlers with a synthetic `Request` and parse the JSON `Response`. This achieves the same single-implementation goal with zero refactor risk to tested production flows; the only extra work is one follow-up select for the amount (the handlers don't return it). Also, `join_waitlist` requires `email` and `seats` (the existing handler validates them) — the spec table omitted them. And since the worker and site are separate packages, community links live in `worker/src/mcp/links.ts` with a keep-in-sync comment (same hand-copied-mirror convention as the differential-pricing helper) rather than a literally shared module.

## Global Constraints

- No new runtime dependencies in `worker/package.json` (`@supabase/supabase-js` stays the only one).
- Never expose `games.owned_by` or `games.currently_with` — write tools must map rows to an explicit public shape.
- MCP protocol version: `2025-06-18` (also accept `2025-03-26`, `2024-11-05`).
- All MCP-created registrations/purchases carry `source: 'mcp'`.
- UPI payee name is exactly `Board Game Company`; UPI ID comes from `env.UPI_ID`; payment page is `${env.BGC_SITE_URL}/pay?amount=<n>&for=<urlencoded label>`.
- No cancellation tool. Cancellation guidance always points to the admin WhatsApp contact (`https://wa.me/919982200768`).
- Dates use `new Date().toISOString().split('T')[0]` for "today", matching every existing handler.
- Worker tests: `cd worker && npm test` must pass after every task.
- Commit after every task. Work on branch `feat/mcp-server`.

---

### Task 1: Protocol layer (JSON-RPC / MCP Streamable HTTP, stateless)

**Files:**
- Create: `worker/src/mcp/types.ts`
- Create: `worker/src/mcp/protocol.ts`
- Test: `worker/src/mcp/protocol.test.ts`

**Interfaces:**
- Consumes: `Env` from `worker/src/index.ts` (type-only import).
- Produces: `interface McpTool { name: string; description: string; inputSchema: Record<string, unknown>; handler: (args: Record<string, unknown>, env: Env, ctx: ExecutionContext) => Promise<unknown> }`, `class ToolError extends Error`, and `handleMcp(request: Request, env: Env, ctx: ExecutionContext, tools: McpTool[]): Promise<Response>`. Every later task builds `McpTool[]` arrays; Task 7 passes them to `handleMcp` from the router.

- [ ] **Step 1: Create branch**

```bash
git checkout -b feat/mcp-server
```

- [ ] **Step 2: Write the failing tests**

Create `worker/src/mcp/protocol.test.ts`:

```ts
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
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd worker && npx vitest run src/mcp/protocol.test.ts`
Expected: FAIL — cannot resolve `./protocol` / `./types`.

- [ ] **Step 4: Implement types.ts and protocol.ts**

Create `worker/src/mcp/types.ts`:

```ts
import type { Env } from '../index';

// A tool exposed by the /mcp endpoint. `handler` returns JSON-serializable
// data (the protocol layer wraps it as text content) and throws ToolError
// for failures whose message is safe to show the calling agent.
export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>, env: Env, ctx: ExecutionContext) => Promise<unknown>;
}

export class ToolError extends Error {}
```

Create `worker/src/mcp/protocol.ts`:

```ts
import type { Env } from '../index';
import { ToolError, type McpTool } from './types';

const LATEST_VERSION = '2025-06-18';
const SUPPORTED_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

const SERVER_INFO = { name: 'bgc-mcp', version: '1.0.0' };

const INSTRUCTIONS = `Board Game Company (BGC) is Bangalore's tabletop board-gaming community. These tools browse upcoming events, the game library, and event photos, check a person's registrations and membership, register for events, join waitlists, and purchase Guild Path memberships.

Payments: BGC uses UPI. No tool takes payment — when a registration or purchase is created, relay the returned UPI details and payment link to the user exactly as given; the user completes payment themselves. Never state or imply that payment has been made.

Personal data: only pass a phone number when the user has explicitly asked you to act on their behalf.

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
    return json({ error: 'Method not allowed. POST JSON-RPC 2.0 messages to this endpoint.' }, 405);
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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd worker && npx vitest run src/mcp/protocol.test.ts`
Expected: PASS (12 tests).

- [ ] **Step 6: Run the full worker suite**

Run: `cd worker && npm test`
Expected: all existing tests still PASS.

- [ ] **Step 7: Commit**

```bash
git add worker/src/mcp/types.ts worker/src/mcp/protocol.ts worker/src/mcp/protocol.test.ts
git commit -m "feat(worker): stateless MCP protocol layer at /mcp"
```

---

### Task 2: Community links + Guild info tools

**Files:**
- Create: `worker/src/mcp/links.ts`
- Create: `worker/src/mcp/info-tools.ts`
- Test: `worker/src/mcp/info-tools.test.ts`

**Interfaces:**
- Consumes: `McpTool` from `./types`.
- Produces: `COMMUNITY` const and `CANCELLATION_NOTE` string from `./links` (used by write tools in Task 6); `infoTools: McpTool[]` from `./info-tools` containing `get_community_links` and `get_guild_info` (Task 5 appends `my_status` to this same array).

- [ ] **Step 1: Write the failing tests**

Create `worker/src/mcp/info-tools.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { infoTools } from './info-tools';

const env = { UPI_ID: 'bgc@upi', BGC_SITE_URL: 'https://boardgamecompany.in' } as any;
const ctx = { waitUntil: (p: Promise<unknown>) => p } as any;

function tool(name: string) {
  const t = infoTools.find((t) => t.name === name);
  if (!t) throw new Error(`missing tool ${name}`);
  return t;
}

describe('get_community_links', () => {
  it('returns all community links and the cancellation contact', async () => {
    const out = await tool('get_community_links').handler({}, env, ctx) as any;
    expect(out.whatsapp_group).toBe('https://chat.whatsapp.com/GL1h4jipksfCW4vm7OtZjp');
    expect(out.instagram).toBe('https://instagram.com/boardgamecompany');
    expect(out.discord).toBe('https://discord.gg/7ck6U59UuJ');
    expect(out.website).toBe('https://boardgamecompany.in');
    expect(out.admin_contact_whatsapp).toBe('https://wa.me/919982200768');
    expect(out.cancellations).toContain('wa.me/919982200768');
  });
});

describe('get_guild_info', () => {
  it('returns the three tiers with prices and purchase URL', async () => {
    const out = await tool('get_guild_info').handler({}, env, ctx) as any;
    expect(out.tiers).toHaveLength(3);
    const byKey = Object.fromEntries(out.tiers.map((t: any) => [t.key, t]));
    expect(byKey.initiate.price_inr).toBe(600);
    expect(byKey.adventurer.price_inr).toBe(2000);
    expect(byKey.guildmaster.price_inr).toBe(8000);
    expect(byKey.guildmaster.period).toBe('12 months');
    expect(byKey.initiate.benefits.length).toBeGreaterThan(0);
    expect(out.purchase_url).toBe('https://boardgamecompany.in/guild-path');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd worker && npx vitest run src/mcp/info-tools.test.ts`
Expected: FAIL — cannot resolve `./info-tools`.

- [ ] **Step 3: Implement links.ts and info-tools.ts**

Create `worker/src/mcp/links.ts`:

```ts
// Community links + admin contact. Keep values in sync with the site
// (src/components/Footer.astro, src/pages/index.astro).
export const COMMUNITY = {
  website: 'https://boardgamecompany.in',
  whatsapp_group: 'https://chat.whatsapp.com/GL1h4jipksfCW4vm7OtZjp',
  instagram: 'https://instagram.com/boardgamecompany',
  discord: 'https://discord.gg/7ck6U59UuJ',
  admin_contact_whatsapp: 'https://wa.me/919982200768',
  admin_contact_phone: '+91 99822 00768',
};

export const CANCELLATION_NOTE =
  'Cancellations cannot be done through this connector. To cancel, message a BGC admin on WhatsApp: https://wa.me/919982200768';
```

Create `worker/src/mcp/info-tools.ts`:

```ts
import type { McpTool } from './types';
import { COMMUNITY, CANCELLATION_NOTE } from './links';

// Tier facts mirror src/lib/guild-tiers.ts and the prices in
// worker/src/guild-purchase.ts — keep all three in sync.
const GUILD_TIERS = [
  {
    key: 'initiate',
    name: 'Initiate',
    price_inr: 600,
    period: '3 months',
    benefits: [
      'Flat 20% off every event',
      'Flat 10% off for one tag along',
      'Early access to all events',
      'Exclusive Guild Path only events',
      'Valid for 3 months',
    ],
    note: "Free if you've attended 10+ events in the last year",
  },
  {
    key: 'adventurer',
    name: 'Adventurer',
    price_inr: 2000,
    period: '3 months',
    benefits: [
      'Everything under Initiate',
      'Flat 100% off every event',
      'Flat 100% off for one tag along for 1 event',
      'Valid for 3 months',
    ],
    note: null,
  },
  {
    key: 'guildmaster',
    name: 'Guildmaster',
    price_inr: 8000,
    period: '12 months',
    benefits: [
      'Everything under Adventurer',
      'Flat 100% off every event',
      'Flat 100% off for one tag along across 5 events',
      'Free 2 day passes for REPLAY conventions',
      'Valid for 12 months',
    ],
    note: null,
  },
];

const getCommunityLinks: McpTool = {
  name: 'get_community_links',
  description:
    "BGC's community links: WhatsApp group, Instagram, Discord, website, and the admin contact (also the route for cancellations).",
  inputSchema: { type: 'object', properties: {} },
  handler: async () => ({
    ...COMMUNITY,
    cancellations: CANCELLATION_NOTE,
  }),
};

const getGuildInfo: McpTool = {
  name: 'get_guild_info',
  description:
    'Guild Path membership tiers (Initiate / Adventurer / Guildmaster) with prices, duration, and benefits. Use join_guild_path to purchase.',
  inputSchema: { type: 'object', properties: {} },
  handler: async () => ({
    tiers: GUILD_TIERS,
    purchase_url: `${COMMUNITY.website}/guild-path`,
  }),
};

export const infoTools: McpTool[] = [getCommunityLinks, getGuildInfo];
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd worker && npx vitest run src/mcp/info-tools.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/src/mcp/links.ts worker/src/mcp/info-tools.ts worker/src/mcp/info-tools.test.ts
git commit -m "feat(worker): MCP community-links and guild-info tools"
```

---

### Task 3: Events read tools (`list_events`, `get_event`)

**Files:**
- Create: `worker/src/mcp/events-tools.ts`
- Test: `worker/src/mcp/events-tools.test.ts`

**Interfaces:**
- Consumes: `getSupabase(env)` from `../supabase`; `handleEventSpots(eventId, env)` from `../event-spots` (returns a `Response` whose JSON is `{ capacity, registered, remaining, option_counts }`); `COMMUNITY` from `./links`; `ToolError`, `McpTool` from `./types`.
- Produces: `eventsTools: McpTool[]` with `list_events` and `get_event`.

- [ ] **Step 1: Write the failing tests**

Create `worker/src/mcp/events-tools.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';

vi.mock('../supabase', () => ({ getSupabase: vi.fn() }));
vi.mock('../event-spots', () => ({ handleEventSpots: vi.fn() }));

import { getSupabase } from '../supabase';
import { handleEventSpots } from '../event-spots';
import { eventsTools } from './events-tools';

const env = {} as any;
const ctx = { waitUntil: (p: Promise<unknown>) => p } as any;

function tool(name: string) {
  const t = eventsTools.find((t) => t.name === name);
  if (!t) throw new Error(`missing tool ${name}`);
  return t;
}

const EVENT = {
  id: 'E1', name: 'Catan Night', description: 'Trade and build', date: '2099-01-15',
  venue_name: 'Dice District', venue_area: 'Indiranagar', price: 500,
  price_includes: 'Entry + snacks', capacity: 20, guild_path_exclusive: false,
  custom_questions: [
    { id: 'q1', label: 'Meal', type: 'radio', required: true,
      options: [{ value: 'Veg', price: 450 }, { value: 'Non-veg', price: 550, capacity: 5 }] },
  ],
  llm_notes: 'Beginner friendly',
};

describe('list_events', () => {
  it('lists published upcoming events with spots remaining and register URL', async () => {
    (getSupabase as any).mockReturnValue({
      from: (table: string) => {
        if (table === 'events') {
          return { select: () => ({ eq: () => ({ gte: () => ({ order: async () => ({
            data: [EVENT], error: null }) }) }) }) };
        }
        if (table === 'registrations') {
          return { select: () => ({ in: () => ({ neq: async () => ({
            data: [{ event_id: 'E1', seats: 3 }, { event_id: 'E1', seats: 2 }], error: null }) }) }) };
        }
        return null;
      },
    });

    const out = await tool('list_events').handler({}, env, ctx) as any;
    expect(out.events).toHaveLength(1);
    const e = out.events[0];
    expect(e.id).toBe('E1');
    expect(e.spots_remaining).toBe(15); // 20 capacity - 5 seats
    expect(e.register_url).toBe('https://boardgamecompany.in/register?event=E1');
    expect(e.guild_path_exclusive).toBe(false);
  });
});

describe('get_event', () => {
  it('returns full event details with per-option prices and option spots left', async () => {
    (getSupabase as any).mockReturnValue({
      from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({
        data: EVENT, error: null }) }) }) }) }),
    });
    (handleEventSpots as any).mockResolvedValue(new Response(JSON.stringify({
      capacity: 20, registered: 5, remaining: 15,
      option_counts: { q1: { 'Non-veg': 4 } },
    }), { status: 200 }));

    const out = await tool('get_event').handler({ event_id: 'E1' }, env, ctx) as any;
    expect(out.name).toBe('Catan Night');
    expect(out.spots_remaining).toBe(15);
    expect(out.notes).toBe('Beginner friendly');
    const q = out.custom_questions[0];
    expect(q.options[0]).toEqual({ value: 'Veg', price_inr: 450 });
    expect(q.options[1]).toEqual({ value: 'Non-veg', price_inr: 550, spots_left: 1 }); // 5 cap - 4 taken
  });

  it('raises a friendly error for an unknown event', async () => {
    (getSupabase as any).mockReturnValue({
      from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({
        data: null, error: null }) }) }) }) }),
    });
    await expect(tool('get_event').handler({ event_id: 'nope' }, env, ctx))
      .rejects.toThrow(/not find that event/i);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd worker && npx vitest run src/mcp/events-tools.test.ts`
Expected: FAIL — cannot resolve `./events-tools`.

- [ ] **Step 3: Implement events-tools.ts**

Create `worker/src/mcp/events-tools.ts`:

```ts
import { getSupabase } from '../supabase';
import { handleEventSpots } from '../event-spots';
import { COMMUNITY } from './links';
import { ToolError, type McpTool } from './types';

interface EventOption { value: string; price?: number; capacity?: number }
interface EventQuestion { id: string; label: string; type: string; required: boolean; options?: EventOption[] }

const listEvents: McpTool = {
  name: 'list_events',
  description:
    "List upcoming published BGC events in Bangalore with date, venue, price, and spots remaining. Use this first when the user asks what's happening or wants to register.",
  inputSchema: { type: 'object', properties: {} },
  handler: async (_args, env) => {
    const supabase = getSupabase(env);
    const today = new Date().toISOString().split('T')[0];

    const { data: events, error } = await supabase
      .from('events')
      .select('id, name, description, date, venue_name, venue_area, price, price_includes, capacity, guild_path_exclusive')
      .eq('is_published', true)
      .gte('date', today)
      .order('date', { ascending: true });

    if (error) throw new Error(error.message);
    if (!events || events.length === 0) {
      return { events: [], note: `No upcoming events right now — check ${COMMUNITY.website} or the WhatsApp group for announcements.` };
    }

    const { data: regs } = await supabase
      .from('registrations')
      .select('event_id, seats')
      .in('event_id', events.map((e) => e.id))
      .neq('payment_status', 'cancelled');

    const taken: Record<string, number> = {};
    for (const r of regs || []) taken[r.event_id] = (taken[r.event_id] || 0) + r.seats;

    return {
      events: events.map((e) => ({
        id: e.id,
        name: e.name,
        description: e.description,
        date: e.date,
        venue: [e.venue_name, e.venue_area].filter(Boolean).join(', '),
        price_inr: e.price,
        price_includes: e.price_includes,
        spots_remaining: Math.max(0, e.capacity - (taken[e.id] || 0)),
        guild_path_exclusive: e.guild_path_exclusive,
        register_url: `${COMMUNITY.website}/register?event=${e.id}`,
      })),
    };
  },
};

const getEvent: McpTool = {
  name: 'get_event',
  description:
    'Full details of one event: description, pricing (including per-option prices), remaining capacity, and the registration questions that must be answered. Call this before register_for_event to learn which custom_answers are required.',
  inputSchema: {
    type: 'object',
    properties: { event_id: { type: 'string', description: 'Event id from list_events' } },
    required: ['event_id'],
  },
  handler: async (args, env) => {
    const eventId = String(args.event_id ?? '');
    const supabase = getSupabase(env);

    const { data: event } = await supabase
      .from('events')
      .select('id, name, description, date, venue_name, venue_area, price, price_includes, capacity, guild_path_exclusive, custom_questions, llm_notes')
      .eq('id', eventId)
      .eq('is_published', true)
      .maybeSingle();

    if (!event) throw new ToolError('Could not find that event. Use list_events to see current events.');

    // Reuse the existing spots handler for capacity + per-option counts.
    const spotsRes = await handleEventSpots(eventId, env);
    const spots = (await spotsRes.json()) as {
      remaining?: number;
      option_counts?: Record<string, Record<string, number>>;
    };
    const optionCounts = spots.option_counts ?? {};

    const questions = ((event.custom_questions || []) as EventQuestion[]).map((q) => ({
      id: q.id,
      label: q.label,
      type: q.type,
      required: q.required,
      ...(q.options
        ? {
            options: q.options.map((o) => ({
              value: o.value,
              ...(o.price !== undefined ? { price_inr: o.price } : {}),
              ...(o.capacity !== undefined
                ? { spots_left: Math.max(0, o.capacity - (optionCounts[q.id]?.[o.value] || 0)) }
                : {}),
            })),
          }
        : {}),
    }));

    return {
      id: event.id,
      name: event.name,
      description: event.description,
      date: event.date,
      venue: [event.venue_name, event.venue_area].filter(Boolean).join(', '),
      price_inr: event.price,
      price_includes: event.price_includes,
      pricing_note:
        'If any selected option has price_inr, the per-seat price is the sum of selected option prices instead of the base price.',
      spots_remaining: spots.remaining ?? 0,
      guild_path_exclusive: event.guild_path_exclusive,
      custom_questions: questions,
      notes: event.llm_notes,
      register_url: `${COMMUNITY.website}/register?event=${event.id}`,
    };
  },
};

export const eventsTools: McpTool[] = [listEvents, getEvent];
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd worker && npx vitest run src/mcp/events-tools.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/src/mcp/events-tools.ts worker/src/mcp/events-tools.test.ts
git commit -m "feat(worker): MCP list_events and get_event tools"
```

---

### Task 4: Library + photos tools (`search_library`, `get_photos`)

**Files:**
- Create: `worker/src/mcp/library-tools.ts`
- Test: `worker/src/mcp/library-tools.test.ts`

**Interfaces:**
- Consumes: `getSupabase` from `../supabase`; `handleEventPhotos(request, env, ctx)` from `../event-photos` (returns `Response` with JSON `{ events: Array<{ folderId, title, date }> }`); `COMMUNITY` from `./links`.
- Produces: `libraryTools: McpTool[]` with `search_library` and `get_photos`.

- [ ] **Step 1: Write the failing tests**

Create `worker/src/mcp/library-tools.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';

vi.mock('../supabase', () => ({ getSupabase: vi.fn() }));
vi.mock('../event-photos', () => ({ handleEventPhotos: vi.fn() }));

import { getSupabase } from '../supabase';
import { handleEventPhotos } from '../event-photos';
import { libraryTools } from './library-tools';

const env = {} as any;
const ctx = { waitUntil: (p: Promise<unknown>) => p } as any;

function tool(name: string) {
  const t = libraryTools.find((t) => t.name === name);
  if (!t) throw new Error(`missing tool ${name}`);
  return t;
}

// A chainable query mock: every filter method returns itself; awaiting
// resolves with the given rows. Records filter calls for assertions.
function queryMock(rows: any[]) {
  const calls: Array<[string, ...any[]]> = [];
  const q: any = {
    calls,
    then: (resolve: any) => resolve({ data: rows, error: null }),
  };
  for (const m of ['select', 'order', 'ilike', 'gte', 'lte', 'limit']) {
    q[m] = (...a: any[]) => { calls.push([m, ...a]); return q; };
  }
  return q;
}

describe('search_library', () => {
  it('returns games and never leaks internal ownership fields', async () => {
    const q = queryMock([
      { id: 'G1', title: 'Azul', player_count: '2-4', max_players: 4, avg_rating: 7.8,
        weight: 1.8, complexity: 'Light', play_time: '30-45 min', max_play_time: 45, length: 'Short',
        owned_by: 'SECRET PERSON', currently_with: 'SECRET HOLDER' },
    ]);
    (getSupabase as any).mockReturnValue({ from: () => q });

    const out = await tool('search_library').handler({ query: 'azul' }, env, ctx) as any;
    expect(out.games).toHaveLength(1);
    expect(out.games[0].title).toBe('Azul');
    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain('owned_by');
    expect(serialized).not.toContain('currently_with');
    expect(serialized).not.toContain('SECRET');
  });

  it('applies player and time filters', async () => {
    const q = queryMock([]);
    (getSupabase as any).mockReturnValue({ from: () => q });

    await tool('search_library').handler({ players: 5, max_time: 60 }, env, ctx);
    expect(q.calls).toContainEqual(['gte', 'max_players', 5]);
    expect(q.calls).toContainEqual(['lte', 'max_play_time', 60]);
  });
});

describe('get_photos', () => {
  it('lists albums with site links, optionally filtered by title', async () => {
    (handleEventPhotos as any).mockResolvedValue(new Response(JSON.stringify({
      events: [
        { folderId: 'F1', title: 'Catan Night', date: '2026-05-24' },
        { folderId: 'F2', title: 'Wingspan Evening', date: '2026-04-12' },
      ],
    }), { status: 200 }));

    const out = await tool('get_photos').handler({ query: 'catan' }, env, ctx) as any;
    expect(out.albums).toHaveLength(1);
    expect(out.albums[0]).toEqual({
      title: 'Catan Night',
      date: '2026-05-24',
      album_url: 'https://boardgamecompany.in/photos?event=F1',
    });
  });

  it('raises a friendly error when the photos backend is down', async () => {
    (handleEventPhotos as any).mockResolvedValue(new Response('nope', { status: 502 }));
    await expect(tool('get_photos').handler({}, env, ctx)).rejects.toThrow(/photos/i);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd worker && npx vitest run src/mcp/library-tools.test.ts`
Expected: FAIL — cannot resolve `./library-tools`.

- [ ] **Step 3: Implement library-tools.ts**

Create `worker/src/mcp/library-tools.ts`:

```ts
import { getSupabase } from '../supabase';
import { handleEventPhotos } from '../event-photos';
import { COMMUNITY } from './links';
import { ToolError, type McpTool } from './types';

const MAX_GAMES = 100;

const searchLibrary: McpTool = {
  name: 'search_library',
  description:
    "Search BGC's board game library (~130 games) by title, player count, or maximum play time. All filters optional; omit them to browse everything.",
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Match against game title' },
      players: { type: 'integer', description: 'Number of players the game must support' },
      max_time: { type: 'integer', description: 'Maximum play time in minutes' },
    },
  },
  handler: async (args, env) => {
    const supabase = getSupabase(env);
    let q = supabase
      .from('games')
      .select('id, title, player_count, max_players, avg_rating, weight, complexity, play_time, max_play_time, length')
      .order('title')
      .limit(MAX_GAMES + 1);

    if (typeof args.query === 'string' && args.query.trim()) q = q.ilike('title', `%${args.query.trim()}%`);
    if (Number.isFinite(Number(args.players)) && Number(args.players) > 0) q = q.gte('max_players', Number(args.players));
    if (Number.isFinite(Number(args.max_time)) && Number(args.max_time) > 0) q = q.lte('max_play_time', Number(args.max_time));

    const { data, error } = await q;
    if (error) throw new Error(error.message);

    const rows = data || [];
    const truncated = rows.length > MAX_GAMES;
    // Explicit public shape — internal columns (owned_by, currently_with)
    // must never reach the output even if the select above ever changes.
    const games = rows.slice(0, MAX_GAMES).map((g) => ({
      title: g.title,
      players: g.player_count,
      play_time: g.play_time,
      complexity: g.complexity,
      rating: g.avg_rating,
    }));

    return {
      count: games.length,
      ...(truncated ? { note: `Showing the first ${MAX_GAMES} matches — narrow the search or browse ${COMMUNITY.website}/library` } : {}),
      games,
      library_url: `${COMMUNITY.website}/library`,
    };
  },
};

const getPhotos: McpTool = {
  name: 'get_photos',
  description:
    'List photo albums from past BGC events with links to view them. Optionally filter by event name.',
  inputSchema: {
    type: 'object',
    properties: { query: { type: 'string', description: 'Match against album/event title' } },
  },
  handler: async (args, env, ctx) => {
    const res = await handleEventPhotos(
      new Request('https://api.boardgamecompany.in/api/event-photos'),
      env,
      ctx,
    );
    if (!res.ok) {
      throw new ToolError(`Photos are unavailable right now — browse them at ${COMMUNITY.website}/photos`);
    }
    const { events } = (await res.json()) as {
      events: Array<{ folderId: string; title: string; date: string | null }>;
    };

    const needle = typeof args.query === 'string' ? args.query.trim().toLowerCase() : '';
    const filtered = needle ? events.filter((e) => e.title.toLowerCase().includes(needle)) : events;

    return {
      albums: filtered.map((e) => ({
        title: e.title,
        date: e.date,
        album_url: `${COMMUNITY.website}/photos?event=${e.folderId}`,
      })),
      photos_url: `${COMMUNITY.website}/photos`,
    };
  },
};

export const libraryTools: McpTool[] = [searchLibrary, getPhotos];
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd worker && npx vitest run src/mcp/library-tools.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/src/mcp/library-tools.ts worker/src/mcp/library-tools.test.ts
git commit -m "feat(worker): MCP search_library and get_photos tools"
```

---

### Task 5: `my_status` tool

**Files:**
- Modify: `worker/src/mcp/info-tools.ts` (append the tool to `infoTools`)
- Test: `worker/src/mcp/info-tools.test.ts` (append describe block)

**Interfaces:**
- Consumes: `sanitizePhone` from `../validation`; `getUserBalance(supabase, userId)` from `../credits`; `getSupabase` from `../supabase`.
- Produces: `my_status` tool inside the existing `infoTools` array.

- [ ] **Step 1: Write the failing tests**

Append to `worker/src/mcp/info-tools.test.ts`. Add the mocks at the very top of the file (before other imports — `vi.mock` calls are hoisted, so placement inside the file is flexible, but keep them at the top for readability):

```ts
import { vi } from 'vitest';

vi.mock('../supabase', () => ({ getSupabase: vi.fn() }));
vi.mock('../credits', () => ({ getUserBalance: vi.fn(async () => 150) }));

import { getSupabase } from '../supabase';
```

Then append the describe block:

```ts
describe('my_status', () => {
  it('rejects an invalid phone with a friendly message', async () => {
    await expect(tool('my_status').handler({ phone: '12345' }, env, ctx))
      .rejects.toThrow(/valid Indian phone/i);
  });

  it('reports found=false for an unknown phone', async () => {
    (getSupabase as any).mockReturnValue({
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }),
    });
    const out = await tool('my_status').handler({ phone: '9876543210' }, env, ctx) as any;
    expect(out.found).toBe(false);
  });

  it('returns registrations, membership, waitlist, and credit balance', async () => {
    (getSupabase as any).mockReturnValue({
      from: (table: string) => {
        if (table === 'users') {
          return { select: () => ({ eq: () => ({ maybeSingle: async () => ({
            data: { id: 'U1', name: 'Asha', email: 'a@b.com' } }) }) }) };
        }
        if (table === 'registrations') {
          return { select: () => ({ eq: () => ({ neq: async () => ({ data: [
            { seats: 2, total_amount: 900, payment_status: 'confirmed',
              events: { name: 'Catan Night', date: '2099-01-15', venue_name: 'Dice District' } },
            { seats: 1, total_amount: 500, payment_status: 'pending',
              events: { name: 'Old Event', date: '2001-01-01', venue_name: 'X' } },
          ] }) }) }) };
        }
        if (table === 'guild_path_members') {
          return { select: () => ({ eq: () => ({ eq: () => ({ gte: () => ({ order: () => ({ limit: () => ({
            maybeSingle: async () => ({ data: { tier: 'adventurer', expires_at: '2099-12-31', plus_ones_used: 0 } }) }) }) }) }) }) }) };
        }
        if (table === 'leads') {
          return { select: () => ({ eq: () => ({ not: () => ({ is: async () => ({ data: [
            { seats: 2, waitlist_at: '2026-07-01T00:00:00Z',
              events: { name: 'Full House Night', date: '2099-02-01' } },
          ] }) }) }) }) };
        }
        return null;
      },
    });

    const out = await tool('my_status').handler({ phone: '9876543210' }, env, ctx) as any;
    expect(out.found).toBe(true);
    expect(out.name).toBe('Asha');
    expect(out.upcoming_registrations).toHaveLength(1); // past event filtered out
    expect(out.upcoming_registrations[0].event).toBe('Catan Night');
    expect(out.upcoming_registrations[0].payment_status).toBe('confirmed');
    expect(out.guild_membership.tier).toBe('adventurer');
    expect(out.waitlist).toHaveLength(1);
    expect(out.credit_balance_inr).toBe(150);
  });
});
```

- [ ] **Step 2: Run tests to verify the new block fails**

Run: `cd worker && npx vitest run src/mcp/info-tools.test.ts`
Expected: FAIL — `missing tool my_status`.

- [ ] **Step 3: Implement my_status in info-tools.ts**

Add imports at the top of `worker/src/mcp/info-tools.ts`:

```ts
import { getSupabase } from '../supabase';
import { sanitizePhone } from '../validation';
import { getUserBalance } from '../credits';
import { ToolError } from './types';
```

Add the tool and include it in the export:

```ts
const myStatus: McpTool = {
  name: 'my_status',
  description:
    "Look up a person's BGC status by phone number: upcoming registrations, waitlist entries, Guild Path membership, and credit balance. Only call this when the user asks about their own status and has given you their phone number.",
  inputSchema: {
    type: 'object',
    properties: { phone: { type: 'string', description: '10-digit Indian mobile number' } },
    required: ['phone'],
  },
  handler: async (args, env) => {
    const phone = sanitizePhone(String(args.phone ?? ''));
    if (!phone) throw new ToolError("That doesn't look like a valid Indian phone number (10 digits, optionally with +91).");

    const supabase = getSupabase(env);
    const { data: user } = await supabase
      .from('users')
      .select('id, name, email')
      .eq('phone', phone)
      .maybeSingle();

    if (!user) {
      return { found: false, message: 'No BGC records for this phone number yet — registering for an event will create one.' };
    }

    const today = new Date().toISOString().split('T')[0];

    const { data: regs } = await supabase
      .from('registrations')
      .select('seats, total_amount, payment_status, events(name, date, venue_name)')
      .eq('user_id', user.id)
      .neq('payment_status', 'cancelled');

    const upcoming = (regs || [])
      .filter((r: any) => r.events?.date >= today)
      .map((r: any) => ({
        event: r.events.name,
        date: r.events.date,
        venue: r.events.venue_name,
        seats: r.seats,
        amount_inr: r.total_amount,
        payment_status: r.payment_status,
      }));

    const { data: member } = await supabase
      .from('guild_path_members')
      .select('tier, expires_at, plus_ones_used')
      .eq('user_id', user.id)
      .eq('status', 'paid')
      .gte('expires_at', today)
      .order('expires_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: waitlistRows } = await supabase
      .from('leads')
      .select('seats, waitlist_at, events(name, date)')
      .eq('phone', phone)
      .not('waitlist_at', 'is', null)
      .is('converted_at', null);

    const waitlist = (waitlistRows || [])
      .filter((w: any) => w.events?.date >= today)
      .map((w: any) => ({ event: w.events.name, date: w.events.date, seats: w.seats }));

    const creditBalance = await getUserBalance(supabase, user.id);

    return {
      found: true,
      name: user.name,
      upcoming_registrations: upcoming,
      guild_membership: member
        ? { tier: member.tier, expires_at: member.expires_at }
        : null,
      waitlist,
      credit_balance_inr: creditBalance,
    };
  },
};

export const infoTools: McpTool[] = [getCommunityLinks, getGuildInfo, myStatus];
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd worker && npx vitest run src/mcp/info-tools.test.ts`
Expected: PASS.

Note for the implementer: the `events(name, date, venue_name)` embedded select relies on the `registrations.event_id` / `leads.event_id` foreign keys, which exist in the schema. If the live query ever returns `events: null`, the `.filter` guards already skip those rows.

- [ ] **Step 5: Commit**

```bash
git add worker/src/mcp/info-tools.ts worker/src/mcp/info-tools.test.ts
git commit -m "feat(worker): MCP my_status tool"
```

---

### Task 6: Write tools (`register_for_event`, `join_waitlist`, `join_guild_path`)

**Files:**
- Create: `worker/src/mcp/write-tools.ts`
- Test: `worker/src/mcp/write-tools.test.ts`

**Interfaces:**
- Consumes: `handleRegister(request, env, ctx)` from `../register` (JSON on success: `{ success: true, registration_id }`; on error: `{ error }` with 4xx, or `{ success: false, error: 'guild_path_required' }` with 403); `handleWaitlist(request, env, ctx)` from `../waitlist` (`{ success: true }` | `{ available: true }` | `{ error }`); `handleGuildPurchase(request, env, ctx)` from `../guild-purchase` (`{ success: true, purchase_id }` | `{ error }`); `getSupabase` from `../supabase`; `CANCELLATION_NOTE`, `COMMUNITY` from `./links`.
- Produces: `writeTools: McpTool[]` with the three tools.

- [ ] **Step 1: Write the failing tests**

Create `worker/src/mcp/write-tools.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../register', () => ({ handleRegister: vi.fn() }));
vi.mock('../waitlist', () => ({ handleWaitlist: vi.fn() }));
vi.mock('../guild-purchase', () => ({ handleGuildPurchase: vi.fn() }));
vi.mock('../supabase', () => ({ getSupabase: vi.fn() }));

import { handleRegister } from '../register';
import { handleWaitlist } from '../waitlist';
import { handleGuildPurchase } from '../guild-purchase';
import { getSupabase } from '../supabase';
import { writeTools } from './write-tools';

const env = { UPI_ID: 'bgc@okaxis', BGC_SITE_URL: 'https://boardgamecompany.in' } as any;
const ctx = { waitUntil: (p: Promise<unknown>) => p } as any;

function tool(name: string) {
  const t = writeTools.find((t) => t.name === name);
  if (!t) throw new Error(`missing tool ${name}`);
  return t;
}

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

beforeEach(() => vi.clearAllMocks());

describe('register_for_event', () => {
  const args = {
    event_id: 'E1', name: 'Asha', phone: '9876543210', email: 'a@b.com',
    seats: 2, custom_answers: { q1: 'Veg' },
  };

  it('registers via the existing handler with source=mcp and returns UPI payment details', async () => {
    (handleRegister as any).mockResolvedValue(jsonRes({ success: true, registration_id: 'R1' }));
    (getSupabase as any).mockReturnValue({
      from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: {
        total_amount: 900, discount_applied: null, credits_applied: 100, seats: 2,
        events: { name: 'Catan Night' },
      } }) }) }) }),
    });

    const out = await tool('register_for_event').handler(args, env, ctx) as any;

    // The synthetic request forwarded the right body to the real handler.
    const forwarded = await ((handleRegister as any).mock.calls[0][0] as Request).json();
    expect(forwarded).toMatchObject({
      event_id: 'E1', name: 'Asha', phone: '9876543210', email: 'a@b.com',
      seats: 2, custom_answers: { q1: 'Veg' }, payment_status: 'pending', source: 'mcp',
    });

    expect(out.registered).toBe(true);
    expect(out.registration_id).toBe('R1');
    expect(out.amount_due_inr).toBe(900);
    expect(out.credits_applied_inr).toBe(100);
    expect(out.payment.upi_id).toBe('bgc@okaxis');
    expect(out.payment.payee_name).toBe('Board Game Company');
    expect(out.payment.payment_page).toBe('https://boardgamecompany.in/pay?amount=900&for=Catan%20Night');
    expect(out.payment.instructions).toMatch(/relay/i);
    expect(out.cancellation).toContain('wa.me/919982200768');
  });

  it('defaults seats to 1 when omitted', async () => {
    (handleRegister as any).mockResolvedValue(jsonRes({ success: true, registration_id: 'R1' }));
    (getSupabase as any).mockReturnValue({
      from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: {
        total_amount: 500, discount_applied: null, credits_applied: 0, seats: 1, events: { name: 'X' },
      } }) }) }) }),
    });
    const { seats: _omit, ...rest } = args;
    await tool('register_for_event').handler(rest, env, ctx);
    const forwarded = await ((handleRegister as any).mock.calls[0][0] as Request).json();
    expect(forwarded.seats).toBe(1);
  });

  it('reports zero-amount registrations without payment details', async () => {
    (handleRegister as any).mockResolvedValue(jsonRes({ success: true, registration_id: 'R1' }));
    (getSupabase as any).mockReturnValue({
      from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: {
        total_amount: 0, discount_applied: 'adventurer', credits_applied: 0, seats: 1, events: { name: 'X' },
      } }) }) }) }),
    });
    const out = await tool('register_for_event').handler(args, env, ctx) as any;
    expect(out.amount_due_inr).toBe(0);
    expect(out.payment).toBeNull();
    expect(out.message).toMatch(/nothing to pay/i);
  });

  it('suggests the waitlist when the event is full', async () => {
    (handleRegister as any).mockResolvedValue(jsonRes({ error: 'Only 0 spots remaining' }, 400));
    await expect(tool('register_for_event').handler(args, env, ctx))
      .rejects.toThrow(/join_waitlist/);
  });

  it('explains guild-exclusive rejections', async () => {
    (handleRegister as any).mockResolvedValue(jsonRes({ success: false, error: 'guild_path_required' }, 403));
    await expect(tool('register_for_event').handler(args, env, ctx))
      .rejects.toThrow(/Guild Path members/i);
  });

  it('relays plain validation errors', async () => {
    (handleRegister as any).mockResolvedValue(jsonRes({ error: 'Invalid phone number' }, 400));
    await expect(tool('register_for_event').handler(args, env, ctx))
      .rejects.toThrow('Invalid phone number');
  });
});

describe('join_waitlist', () => {
  const args = { event_id: 'E1', name: 'Asha', phone: '9876543210', email: 'a@b.com', seats: 1 };

  it('joins the waitlist through the existing handler', async () => {
    (handleWaitlist as any).mockResolvedValue(jsonRes({ success: true }));
    const out = await tool('join_waitlist').handler(args, env, ctx) as any;
    expect(out.waitlisted).toBe(true);
    const forwarded = await ((handleWaitlist as any).mock.calls[0][0] as Request).json();
    expect(forwarded.source).toBe('mcp');
  });

  it('tells the agent to register normally when spots are actually available', async () => {
    (handleWaitlist as any).mockResolvedValue(jsonRes({ available: true }));
    const out = await tool('join_waitlist').handler(args, env, ctx) as any;
    expect(out.waitlisted).toBe(false);
    expect(out.message).toMatch(/register_for_event/);
  });
});

describe('join_guild_path', () => {
  const args = { tier: 'adventurer', name: 'Asha', phone: '9876543210', email: 'a@b.com' };

  it('purchases through the existing handler and returns UPI details', async () => {
    (handleGuildPurchase as any).mockResolvedValue(jsonRes({ success: true, purchase_id: 'P1' }));
    (getSupabase as any).mockReturnValue({
      from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: {
        amount: 2000, tier: 'adventurer', starts_at: '2026-07-18', expires_at: '2026-10-18',
      } }) }) }) }),
    });

    const out = await tool('join_guild_path').handler(args, env, ctx) as any;
    const forwarded = await ((handleGuildPurchase as any).mock.calls[0][0] as Request).json();
    expect(forwarded).toMatchObject({ tier: 'adventurer', source: 'mcp' });
    expect(out.purchased).toBe(true);
    expect(out.amount_due_inr).toBe(2000);
    expect(out.expires_at).toBe('2026-10-18');
    expect(out.payment.upi_id).toBe('bgc@okaxis');
    expect(out.payment.payment_page).toBe('https://boardgamecompany.in/pay?amount=2000&for=Adventurer%20(Guild%20Path)');
  });

  it('relays tier validation errors', async () => {
    (handleGuildPurchase as any).mockResolvedValue(jsonRes({ error: 'Invalid tier' }, 400));
    await expect(tool('join_guild_path').handler(args, env, ctx)).rejects.toThrow('Invalid tier');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd worker && npx vitest run src/mcp/write-tools.test.ts`
Expected: FAIL — cannot resolve `./write-tools`.

- [ ] **Step 3: Implement write-tools.ts**

Create `worker/src/mcp/write-tools.ts`:

```ts
import { handleRegister } from '../register';
import { handleWaitlist } from '../waitlist';
import { handleGuildPurchase } from '../guild-purchase';
import { getSupabase } from '../supabase';
import { CANCELLATION_NOTE } from './links';
import { ToolError, type McpTool } from './types';

// Write tools reuse the public API handlers via a synthetic Request so
// registration/pricing/credit rules stay implemented in exactly one place.
function internalPost(path: string, body: unknown): Request {
  return new Request(`https://internal${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const PAYMENT_INSTRUCTIONS =
  'Relay these UPI payment details to the user exactly as given — you cannot pay on their behalf, and the spot stays pending until a BGC admin confirms the payment.';

function upiPayment(env: { UPI_ID: string; BGC_SITE_URL: string }, amount: number, label: string) {
  return {
    method: 'UPI',
    upi_id: env.UPI_ID,
    payee_name: 'Board Game Company',
    amount_inr: amount,
    payment_page: env.BGC_SITE_URL ? `${env.BGC_SITE_URL}/pay?amount=${amount}&for=${encodeURIComponent(label)}` : null,
    instructions: PAYMENT_INSTRUCTIONS,
  };
}

const registerForEvent: McpTool = {
  name: 'register_for_event',
  description:
    "Register someone for a BGC event. Before calling: use get_event to see the event's custom questions, then collect the user's name, 10-digit phone, email, and answers. Returns the amount due and UPI payment details — relay them verbatim; the user pays via UPI themselves. Registration stays pending until an admin confirms payment.",
  inputSchema: {
    type: 'object',
    properties: {
      event_id: { type: 'string', description: 'Event id from list_events' },
      name: { type: 'string', description: "Registrant's full name" },
      phone: { type: 'string', description: '10-digit Indian mobile number' },
      email: { type: 'string', description: 'Email for the confirmation' },
      seats: { type: 'integer', minimum: 1, maximum: 20, description: 'Number of seats (default 1)' },
      custom_answers: {
        type: 'object',
        description: 'Answers keyed by question id from get_event. Strings for text/radio/select questions, booleans for checkboxes.',
      },
    },
    required: ['event_id', 'name', 'phone', 'email'],
  },
  handler: async (args, env, ctx) => {
    const res = await handleRegister(
      internalPost('/api/register', {
        event_id: args.event_id,
        name: args.name,
        phone: args.phone,
        email: args.email,
        seats: args.seats === undefined ? 1 : Math.floor(Number(args.seats)),
        custom_answers: args.custom_answers ?? {},
        payment_status: 'pending',
        source: 'mcp',
      }),
      env,
      ctx,
    );
    const body = (await res.json()) as { success?: boolean; registration_id?: string; error?: string };

    if (!res.ok || !body.registration_id) {
      const error = body.error || 'Registration failed';
      if (error === 'guild_path_required') {
        throw new ToolError('This event is exclusive to active Guild Path members. Use get_guild_info to see membership options.');
      }
      if (/spots remaining/i.test(error)) {
        throw new ToolError(`${error}. The event may be full — offer to add them with the join_waitlist tool instead.`);
      }
      throw new ToolError(error);
    }

    // The handler does not return the computed amount, so fetch it.
    const { data: reg } = await getSupabase(env)
      .from('registrations')
      .select('total_amount, discount_applied, credits_applied, seats, events(name)')
      .eq('id', body.registration_id)
      .single();

    const amount = reg?.total_amount ?? 0;
    const eventName = (reg as { events?: { name?: string } } | null)?.events?.name ?? 'BGC event';

    return {
      registered: true,
      registration_id: body.registration_id,
      event: eventName,
      seats: reg?.seats,
      amount_due_inr: amount,
      discount_applied: reg?.discount_applied ?? null,
      credits_applied_inr: reg?.credits_applied ?? 0,
      payment: amount > 0 ? upiPayment(env, amount, eventName) : null,
      ...(amount === 0 ? { message: 'Nothing to pay — the seat is covered by membership, promo, or credits.' } : {}),
      confirmation: 'A confirmation email with these details has been sent.',
      cancellation: CANCELLATION_NOTE,
    };
  },
};

const joinWaitlist: McpTool = {
  name: 'join_waitlist',
  description:
    'Join the waitlist for a full BGC event. If spots are actually available it returns waitlisted=false — register with register_for_event instead.',
  inputSchema: {
    type: 'object',
    properties: {
      event_id: { type: 'string', description: 'Event id from list_events' },
      name: { type: 'string' },
      phone: { type: 'string', description: '10-digit Indian mobile number' },
      email: { type: 'string' },
      seats: { type: 'integer', minimum: 1, maximum: 20, description: 'Seats wanted (default 1)' },
    },
    required: ['event_id', 'name', 'phone', 'email'],
  },
  handler: async (args, env, ctx) => {
    const res = await handleWaitlist(
      internalPost('/api/waitlist', {
        event_id: args.event_id,
        name: args.name,
        phone: args.phone,
        email: args.email,
        seats: args.seats === undefined ? 1 : Math.floor(Number(args.seats)),
        source: 'mcp',
      }),
      env,
      ctx,
    );
    const body = (await res.json()) as { success?: boolean; available?: boolean; error?: string };

    if (body.available) {
      return { waitlisted: false, message: 'Good news — this event has spots available. Register with register_for_event instead.' };
    }
    if (!res.ok || !body.success) throw new ToolError(body.error || 'Could not join the waitlist');

    return {
      waitlisted: true,
      message: "They're on the waitlist (first come, first served). A BGC admin will reach out if a spot opens up. A confirmation email has been sent.",
    };
  },
};

const joinGuildPath: McpTool = {
  name: 'join_guild_path',
  description:
    'Purchase a BGC Guild Path membership. Use get_guild_info for tiers first, then collect name, phone, email, and chosen tier. Returns the amount due and UPI payment details — relay them verbatim; the user pays via UPI themselves.',
  inputSchema: {
    type: 'object',
    properties: {
      tier: { type: 'string', enum: ['initiate', 'adventurer', 'guildmaster'] },
      name: { type: 'string' },
      phone: { type: 'string', description: '10-digit Indian mobile number' },
      email: { type: 'string' },
    },
    required: ['tier', 'name', 'phone', 'email'],
  },
  handler: async (args, env, ctx) => {
    const res = await handleGuildPurchase(
      internalPost('/api/guild-purchase', {
        tier: args.tier,
        name: args.name,
        phone: args.phone,
        email: args.email,
        source: 'mcp',
      }),
      env,
      ctx,
    );
    const body = (await res.json()) as { success?: boolean; purchase_id?: string; error?: string };
    if (!res.ok || !body.purchase_id) throw new ToolError(body.error || 'Purchase failed');

    const { data: purchase } = await getSupabase(env)
      .from('guild_path_members')
      .select('amount, tier, starts_at, expires_at')
      .eq('id', body.purchase_id)
      .single();

    const amount = purchase?.amount ?? 0;
    const tierName = String(args.tier).charAt(0).toUpperCase() + String(args.tier).slice(1);

    return {
      purchased: true,
      tier: purchase?.tier ?? args.tier,
      starts_at: purchase?.starts_at,
      expires_at: purchase?.expires_at,
      amount_due_inr: amount,
      payment: amount > 0 ? upiPayment(env, amount, `${tierName} (Guild Path)`) : null,
      ...(amount === 0 ? { message: 'Nothing to pay — covered by credits.' } : {}),
      confirmation: 'A confirmation email with these details has been sent. Membership activates once a BGC admin confirms the payment.',
    };
  },
};

export const writeTools: McpTool[] = [registerForEvent, joinWaitlist, joinGuildPath];
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd worker && npx vitest run src/mcp/write-tools.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full worker suite**

Run: `cd worker && npm test`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add worker/src/mcp/write-tools.ts worker/src/mcp/write-tools.test.ts
git commit -m "feat(worker): MCP register, waitlist, and guild-purchase tools"
```

---

### Task 7: Tool registry + router wiring

**Files:**
- Create: `worker/src/mcp/tools.ts`
- Modify: `worker/src/index.ts` (route + CORS allow-headers)
- Test: `worker/src/mcp/tools.test.ts`

**Interfaces:**
- Consumes: all four tool arrays + `handleMcp`.
- Produces: `ALL_TOOLS: McpTool[]` (exactly 10 tools); the live `POST /mcp` route.

- [ ] **Step 1: Write the failing test**

Create `worker/src/mcp/tools.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ALL_TOOLS } from './tools';

describe('MCP tool registry', () => {
  it('exposes exactly the 10 spec tools, no cancellation tools', () => {
    const names = ALL_TOOLS.map((t) => t.name).sort();
    expect(names).toEqual([
      'get_community_links',
      'get_event',
      'get_guild_info',
      'get_photos',
      'join_guild_path',
      'join_waitlist',
      'list_events',
      'my_status',
      'register_for_event',
      'search_library',
    ]);
    expect(names.some((n) => /cancel/.test(n))).toBe(false);
  });

  it('every tool has a description and an object inputSchema', () => {
    for (const t of ALL_TOOLS) {
      expect(t.description.length).toBeGreaterThan(20);
      expect((t.inputSchema as any).type).toBe('object');
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd worker && npx vitest run src/mcp/tools.test.ts`
Expected: FAIL — cannot resolve `./tools`.

- [ ] **Step 3: Implement tools.ts and wire the router**

Create `worker/src/mcp/tools.ts`:

```ts
import type { McpTool } from './types';
import { eventsTools } from './events-tools';
import { libraryTools } from './library-tools';
import { infoTools } from './info-tools';
import { writeTools } from './write-tools';

export const ALL_TOOLS: McpTool[] = [...eventsTools, ...libraryTools, ...infoTools, ...writeTools];
```

In `worker/src/index.ts`, add imports:

```ts
import { handleMcp } from './mcp/protocol';
import { ALL_TOOLS } from './mcp/tools';
```

Add the route immediately after the `/api/event-photos/image/` branch (before the `/api/admin/` branch):

```ts
      } else if (url.pathname === '/mcp') {
        response = await handleMcp(request, env, ctx, ALL_TOOLS);
```

(`handleMcp` itself answers non-POST methods with 405, so no method check here.)

Update `corsHeaders` so browser-based MCP clients pass preflight — change the `Access-Control-Allow-Headers` line to:

```ts
    'Access-Control-Allow-Headers': 'Content-Type, Cf-Access-Jwt-Assertion, Mcp-Session-Id, Mcp-Protocol-Version',
```

- [ ] **Step 4: Run the full worker suite**

Run: `cd worker && npm test`
Expected: all PASS, including the new registry test.

- [ ] **Step 5: Verify the endpoint end-to-end locally**

```bash
cd worker && npx wrangler dev --port 8787 &
sleep 6
curl -s http://localhost:8787/mcp -X POST -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
kill %1
```

Expected: JSON with 10 tools. (Skip if local Supabase env vars are missing — `tools/list` needs none, so it should work regardless.)

- [ ] **Step 6: Commit**

```bash
git add worker/src/mcp/tools.ts worker/src/mcp/tools.test.ts worker/src/index.ts
git commit -m "feat(worker): expose MCP endpoint at /mcp with 10-tool registry"
```

---

### Task 8: Docs page at boardgamecompany.in/mcp

**Files:**
- Create: `src/pages/mcp.astro`

**Interfaces:**
- Consumes: `src/layouts/Layout.astro` (same pattern as `src/pages/privacy.astro`); site CSS utilities `section-tag`, `prose-bgc`.
- Produces: public page at `/mcp` (auto-included in sitemap; `/pay` is the only excluded route).

- [ ] **Step 1: Create the page**

Create `src/pages/mcp.astro`:

```astro
---
import Layout from '../layouts/Layout.astro';
const MCP_URL = 'https://api.boardgamecompany.in/mcp';
---

<Layout
  title="Connect your AI assistant"
  description="Connect Claude, ChatGPT, or any MCP-enabled AI assistant to Board Game Company — browse events, check the library, and register from inside a conversation."
>
  <section class="py-14" style="background: #FFF8E7;">
    <div class="max-w-[800px] mx-auto px-6 text-center">
      <span class="section-tag">For AI assistants</span>
      <h1 class="font-heading font-bold" style="font-size: clamp(2.4rem, 5vw, 3.8rem); letter-spacing: -1px;">
        BGC on MCP
      </h1>
      <p class="text-lg text-[#1A1A1A]/70 mt-4 max-w-[560px] mx-auto">
        Plug Board Game Company into Claude, ChatGPT, or any AI assistant that speaks MCP —
        then browse events, search our game library, and register without leaving the chat.
      </p>
    </div>
  </section>

  <section class="py-12">
    <div class="max-w-[760px] mx-auto px-6 prose-bgc">
      <h2>The connection URL</h2>
      <pre><code>{MCP_URL}</code></pre>
      <p>
        That's it — no API key, no login. Add it to your assistant and ask away.
      </p>

      <h2>What it can do</h2>
      <ul>
        <li><strong>Browse events</strong> — upcoming events with dates, venues, prices, and live spots remaining.</li>
        <li><strong>Register</strong> — your assistant collects your details and books your spot. You pay via UPI as usual; nothing changes about payment.</li>
        <li><strong>Join a waitlist</strong> — when an event is full.</li>
        <li><strong>Search the library</strong> — 130+ games by player count, play time, or name.</li>
        <li><strong>Guild Path</strong> — see tiers and subscribe.</li>
        <li><strong>Check your status</strong> — your registrations, membership, and credit balance.</li>
        <li><strong>Photos &amp; community</strong> — event photo albums, WhatsApp group, Instagram, Discord.</li>
      </ul>

      <h2>Set it up</h2>

      <h3>Claude (claude.ai)</h3>
      <p>
        Settings → Connectors → <strong>Add custom connector</strong> → paste the URL above → Add.
        Works on web and desktop.
      </p>

      <h3>Claude Code</h3>
      <pre><code>claude mcp add --transport http bgc {MCP_URL}</code></pre>

      <h3>ChatGPT</h3>
      <p>
        Enable Developer Mode (Settings → Apps &amp; Connectors → Advanced), then
        <strong>Create connector</strong> with the URL above and "No authentication".
      </p>

      <h3>Cursor / other MCP clients</h3>
      <pre><code>{`{
  "mcpServers": {
    "bgc": { "url": "${MCP_URL}" }
  }
}`}</code></pre>

      <h2>Try asking</h2>
      <ul>
        <li>"What's happening at BGC this weekend?"</li>
        <li>"Register me for Saturday's event — I'm Asha, 98xxxxxx10, asha@example.com."</li>
        <li>"Find me a game for 6 players under an hour."</li>
        <li>"What Guild Path tiers are there?"</li>
        <li>"Am I registered for anything? My number is 98xxxxxx10."</li>
      </ul>

      <h2>Privacy &amp; payments</h2>
      <ul>
        <li>No login and no stored sessions — your phone number is only sent when you ask your assistant to act for you (registering, checking your status).</li>
        <li>Payments never go through the assistant. Registration returns our standard UPI details and you pay exactly as you would on the website.</li>
        <li>Cancellations aren't possible via the connector — message a BGC admin on
          <a href="https://wa.me/919982200768">WhatsApp</a> instead.</li>
      </ul>

      <p>
        Questions or something misbehaving? Ping us on
        <a href="https://wa.me/919982200768">WhatsApp</a> or
        <a href="https://instagram.com/boardgamecompany">Instagram</a>.
      </p>
    </div>
  </section>
</Layout>
```

Before writing, open `src/pages/privacy.astro` and confirm the `Layout` props and CSS classes used above match; adjust to whatever the layout actually accepts.

- [ ] **Step 2: Verify the site builds and the page renders**

```bash
npm run build
```

Expected: build succeeds; `dist/mcp/index.html` exists (`ls dist/mcp/`).

- [ ] **Step 3: Commit**

```bash
git add src/pages/mcp.astro
git commit -m "feat(site): /mcp docs page for the BGC MCP server"
```

---

### Task 9: Merge, deploy, and smoke-test production

- [ ] **Step 1: Final full check**

```bash
cd worker && npm test && cd .. && npm run build
```

Expected: all worker tests pass, site builds.

- [ ] **Step 2: Merge to main and push** (site + admin auto-deploy via Pages)

```bash
git checkout main && git merge feat/mcp-server && git push
```

- [ ] **Step 3: Deploy the worker** (manual — never auto-deploys)

```bash
cd worker && npx wrangler deploy
```

- [ ] **Step 4: Smoke-test production**

```bash
curl -s https://api.boardgamecompany.in/mcp -X POST -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}'
```

Expected: `result.serverInfo.name == "bgc-mcp"`.

```bash
curl -s https://api.boardgamecompany.in/mcp -X POST -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
```

Expected: 10 tools.

```bash
curl -s https://api.boardgamecompany.in/mcp -X POST -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"list_events","arguments":{}}}'
```

Expected: real upcoming events (or the friendly empty-state note). Also verify `https://boardgamecompany.in/mcp` renders once Pages finishes deploying.

- [ ] **Step 5: Real-client check (recommended)**

```bash
claude mcp add --transport http bgc https://api.boardgamecompany.in/mcp
```

Then in a Claude Code session: "What events are coming up at BGC?" — confirm the tools appear and answer.
