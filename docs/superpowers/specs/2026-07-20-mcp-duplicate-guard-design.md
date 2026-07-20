# MCP Duplicate-Registration Guard — Design

**Date:** 2026-07-20
**Status:** Approved

## Purpose

When someone uses the MCP `register_for_event` tool for an event they already hold a non-cancelled registration for, the consuming agent must explicitly inform them and get their confirmation before a second spot is booked. Protects against agent retries and absent-minded double-booking. **MCP only** — the website form and `/api/register` are unchanged; admin manual registration is unaffected.

## Behavior

`register_for_event` (in `worker/src/mcp/write-tools.ts`) gains an optional input:

- `confirm_additional` (boolean, default false) — "Set to true only after the user has been told they already have a spot for this event and has explicitly confirmed they want another."

Pre-check, before the existing `handleRegister` call:

1. Sanitize the phone with `sanitizePhone`. If invalid, skip the pre-check (the wrapped handler already rejects invalid phones with its message).
2. One query: `registrations` where `event_id` = the given event, `phone` = sanitized phone, `payment_status != 'cancelled'`; sum `seats`. (Registrations store phone directly — no users-table hop.)
3. If the sum > 0 and `confirm_additional !== true`, return a **structured non-error result** (not `ToolError` — nothing failed):

```json
{
  "registered": false,
  "requires_confirmation": true,
  "existing_seats": 2,
  "message": "This phone number already has 2 seat(s) booked for this event. Tell the user this explicitly and ask whether they want to book an additional spot. Only if they confirm, call register_for_event again with confirm_additional: true."
}
```

4. Otherwise (no existing seats, or `confirm_additional === true`), proceed exactly as today.

If the pre-check query itself errors, proceed without the guard (best-effort, consistent with the codebase's auxiliary-read convention) — never block a valid registration on a transient failure.

## Agent guidance

- The `register_for_event` tool description gains one sentence describing the confirm flow.
- The server `initialize` instructions (in `worker/src/mcp/protocol.ts`) gain one line: duplicate registrations require the two-step confirmation; never set `confirm_additional` without the user's explicit yes.

## Out of scope

- Website form warning, `/api/register` changes, admin manual registration.
- `join_waitlist` and `join_guild_path` (waitlist already upserts idempotently; guild renewals are legitimate repeat purchases).

## Testing

In `worker/src/mcp/write-tools.test.ts`:
- Existing seats > 0, no flag → `requires_confirmation: true`, `handleRegister` NOT called.
- Existing seats > 0, `confirm_additional: true` → proceeds; forwarded body unchanged (no `confirm_additional` leaked to the wrapped handler).
- No existing seats, no flag → proceeds.
- Pre-check query error → proceeds (guard is best-effort).
