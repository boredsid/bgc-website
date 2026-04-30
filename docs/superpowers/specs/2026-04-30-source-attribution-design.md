# Source Attribution

Capture a `?source=` URL parameter (e.g. `?source=instagram`) and attribute event registrations, guild path purchases, and first-touch user records to it.

## Goal

Know where signups come from. When someone shares a link on Instagram vs WhatsApp vs a Telegram group, we want to see that breakdown in the database without any third-party analytics.

## Schema

One migration adds nullable `source text` to three tables:

```sql
alter table users add column source text;
alter table registrations add column source text;
alter table guild_path_members add column source text;
```

All nullable. No backfill — historical rows remain NULL and are reported as "unknown" in any future analytics.

## Capture flow

1. **Landing.** User opens any BGC page with `?source=instagram` in the URL.
2. **Session storage write.** A small inline script in `Layout.astro` runs before React hydration:
   - Reads `source` from `window.location.search`.
   - Sanitizes: lowercase, keep only `[a-z0-9_-]`, max 50 chars. If empty after sanitize, do nothing.
   - If `sessionStorage.bgc_source` is empty, write the sanitized value. **First-touch wins** within a session — a later `?source=whatsapp` in the same tab does not overwrite an earlier `?source=instagram`.
3. **Read on signup.** `src/lib/source.ts` exports `getSource(): string | null` which reads from sessionStorage. React forms call this when assembling their POST body.
4. **Send to Worker.** The `/api/register` and `/api/guild-purchase` request bodies include an optional `source` field.
5. **Persist.** The Worker re-sanitizes (defense in depth) and writes the source onto the appropriate row.

## Persistence rules

| Table | When source is written | When source is preserved |
|-------|------------------------|--------------------------|
| `users.source` | Only on **insert** (new user) | Never overwritten — represents first-touch |
| `registrations.source` | On every insert | N/A (each registration gets its own source) |
| `guild_path_members.source` | On every insert | N/A |

If an existing user signs up again from a new source, `users.source` keeps the original value, but the new `registrations.source` or `guild_path_members.source` reflects the latest source.

## Files

### New
- `src/lib/source.ts` — exports `getSource(): string | null`. Reads from `sessionStorage.bgc_source`.

### Modified
- `src/layouts/Layout.astro` — add an inline `<script is:inline>` that captures the source on page load and writes to sessionStorage with first-touch semantics.
- `src/components/RegistrationForm.tsx` — include `source: getSource()` in the `/api/register` POST body.
- `src/components/GuildPurchase.tsx` — include `source: getSource()` in the `/api/guild-purchase` POST body.
- `worker/src/validation.ts` — add `sanitizeSource(s: string): string | null` with the same rules as the frontend.
- `worker/src/register.ts` — accept optional `source`, sanitize, set `users.source` on user insert (only), set `registrations.source` on insert.
- `worker/src/guild-purchase.ts` — accept optional `source`, sanitize, set `users.source` on user insert (only), set `guild_path_members.source` on insert.
- `supabase/migrations/004_source_attribution.sql` — the schema migration above.

## Sanitization rules

Both frontend and Worker apply the same rules:

- Lowercase the string.
- Strip any character not in `[a-z0-9_-]`.
- Truncate to 50 characters.
- If the result is empty, treat as absent (do not write).

This permits values like `instagram`, `whatsapp`, `tg-group`, `april_meetup_story`. It rejects script content, whitespace, and accidental noise.

## Edge cases

- **No `?source=` ever seen.** All three columns stay NULL. Existing behavior unchanged.
- **Multiple `?source=` values in one session.** First one wins; later ones are ignored.
- **User clears storage between landing and signup.** They get attributed as direct/unknown for that signup. Acceptable — sessionStorage is per-tab and per-session, so this is rare.
- **User signs up via Instagram, then later via WhatsApp.** `users.source = 'instagram'` (unchanged). The new registration row has `source = 'whatsapp'`. Reports can use either column depending on the question.
- **Worker receives a malformed `source` field** (not a string, too long, control chars). Sanitizer treats it as absent; the row is inserted with `source = NULL`. No error returned.

## Out of scope (YAGNI)

- `utm_medium` and `utm_campaign` columns. The schema can grow later if we run multi-dimensional campaigns.
- localStorage / cross-visit persistence. Sticky-for-session is enough for the typical "see post → click → sign up within minutes" path.
- An allowlist of valid source values. Analytics can group raw strings; an allowlist would silently drop new sources we forgot to register.
- An admin UI for source breakdowns. Direct Supabase queries are sufficient for now.

## Testing

- **Frontend.** Open `/?source=instagram`, navigate to `/register`, register for an event. Inspect the inserted `registrations` and `users` rows in Supabase — both should have `source = 'instagram'`.
- **First-touch on users.** With the same phone, register again from `/?source=whatsapp`. `users.source` stays `instagram`; new `registrations.source` is `whatsapp`.
- **Sanitization.** Open `/?source=<script>alert(1)</script>` — confirm sessionStorage contains only the sanitized remnant (or nothing) and that no row receives the raw value.
- **Empty / absent.** Open `/register` directly with no `?source=`. Registration succeeds with `source = NULL` on all rows.
