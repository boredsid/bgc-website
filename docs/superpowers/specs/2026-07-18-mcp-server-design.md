# BGC MCP Server — Design

**Date:** 2026-07-18
**Status:** Approved

## Purpose

Let anyone connect their AI agent (Claude.ai, Claude Code, ChatGPT, Cursor, etc.) to BGC and, from inside a conversation: browse upcoming events, register for one, check the game library, see event photos, subscribe to Guild Path, and get community links (WhatsApp, Instagram, Discord). Public setup instructions live at `boardgamecompany.in/mcp`.

## Architecture

- **Endpoint:** `POST https://api.boardgamecompany.in/mcp` inside the existing worker (`worker/src/`). New branch in the flat router in `worker/src/index.ts`.
- **Transport:** MCP Streamable HTTP in **stateless mode**. Every request is a self-contained JSON-RPC message; no sessions, no SSE streams, no Durable Objects. `GET /mcp` returns 405 (no server-initiated streams). CORS open (same as the public API) so browser-based clients can connect.
- **Protocol layer:** a small hand-rolled JSON-RPC handler (`worker/src/mcp/`) supporting `initialize`, `notifications/initialized`, `ping`, `tools/list`, and `tools/call`. The official TypeScript SDK's Streamable HTTP transport is Node-oriented; the worker currently has one runtime dependency and we keep it that way. Target protocol version: `2025-06-18`, accepting older clients per spec version negotiation.
- **Business logic:** tool handlers call the existing modules (`register.ts`, `lookup-phone.ts`, `event-spots.ts`, `guild-purchase.ts`, `guild-status.ts`, `event-photos.ts`, `waitlist.ts`, `pricing.ts`, `credits.ts`) directly as functions — one implementation of registration/pricing/credit rules, no HTTP self-calls. Where a handler currently parses a `Request`, extract its core into a callable function rather than duplicating logic.

## Trust model

Same as the website: **no auth, phone-per-action**. The agent collects name/phone/email in conversation and passes them as tool arguments. `my_status` exposes exactly what the public `/api/lookup-phone` endpoint already exposes. No new abuse surface beyond the existing public API.

**No cancellations via MCP.** Without auth, a third party who knows a phone number could cancel someone's registration. Cancellations happen offline: users contact a community admin (the tools return the contact number / WhatsApp link when cancellation comes up).

## Tools (10)

### Read tools

| Tool | Input | Output |
|---|---|---|
| `list_events` | none (optional `from`/`to` dates) | Upcoming published events: id, name, date/time, venue, price (incl. `price_includes`), spots left, Guild-exclusive flag, register URL |
| `get_event` | `event_id` | Full details: description, custom questions (with per-option prices and per-option capacity remaining), spots left, cancellation policy note |
| `search_library` | optional `query`, `players`, `max_time` | Matching games: name, player count, play time, complexity. **Public fields only — never `owned_by` / `currently_with`** |
| `get_photos` | optional `event_id` | Photo album links per event (from the existing event-photos data) |
| `get_guild_info` | none | Guild Path tiers, pricing, benefits, purchase URL |
| `get_community_links` | none | WhatsApp group link, Instagram, Discord, website, contact number for admins (also the cancellation route) |
| `my_status` | `phone` | Upcoming confirmed registrations, waitlist entries, guild membership + tier + expiry, credit balance |

### Write tools

| Tool | Input | Output |
|---|---|---|
| `register_for_event` | `event_id`, `name`, `phone`, `email`, `custom_answers`, optional `plus_ones` | Runs the full existing flow: validation, spot check, differential option pricing, promo, guild discount, credit auto-apply. Returns amount due + UPI payment instructions (UPI ID + note format, same as the site's success card) + "cancellations: contact an admin" note. If full → suggests `join_waitlist`. |
| `join_waitlist` | `event_id`, `name`, `phone` | Waitlist confirmation via existing waitlist flow |
| `join_guild_path` | `tier`, `name`, `phone`, `email` | Existing guild-purchase flow; returns amount due + UPI instructions |

Registrations and purchases made through MCP are tagged `source: "mcp"` for attribution in admin.

Tool descriptions are written for the consuming LLM: they state when to use the tool, what to collect from the user first, and that payment is completed by the human via UPI (the agent must relay the instructions verbatim, not claim payment is done).

## Errors

`tools/call` failures return MCP `isError: true` results carrying the same plain-English validation messages the API produces today ("This event is full", "That phone number doesn't look right"), so the agent can relay or recover ("want the waitlist?"). Protocol-level errors (bad JSON-RPC, unknown method) return standard JSON-RPC error responses.

## Docs page

New `src/pages/mcp.astro` (added to sitemap normally):

- What it is, in plain language
- Connect URL: `https://api.boardgamecompany.in/mcp`
- Per-client setup: Claude.ai (custom connector), Claude Code (`claude mcp add`), ChatGPT (connector/developer mode), Cursor — copy-paste snippets
- Example prompts ("What's happening at BGC this weekend?", "Register me for Saturday's event")
- Privacy note: no login; your phone number is only sent when you ask your agent to act for you; payments stay on UPI, never through the agent
- Cancellation policy: contact an admin (number listed)

Community links and contact number come from one shared constants source used by both the worker tool and the site (values already exist on the site today).

## Testing

Vitest in `worker/`, following existing `*.test.ts` patterns:

- Protocol handler: initialize handshake, version negotiation, tools/list shape, unknown method, malformed JSON-RPC
- Each tool: happy path + key error path (full event, bad phone, unknown event id), asserting reuse of existing logic (e.g. differential pricing applied in `register_for_event`)
- Guard test: `search_library` output never contains `owned_by` / `currently_with`

## Out of scope

- OAuth / OTP verification (revisit if abuse appears)
- Cancellation tools (deliberate — see trust model)
- MCP resources/prompts capabilities (tools only, v1)
- Admin capabilities of any kind
- Rate limiting beyond what the public API has today
