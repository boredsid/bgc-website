# Guild Path Confirmation Email + Payment Page — Design

**Date:** 2026-05-01
**Status:** Approved
**Builds on:** `docs/superpowers/specs/2026-05-01-registration-confirmation-email-design.md`

## Goal

Two follow-on features:

1. **Guild Path purchase confirmation email** — same fire-and-forget HTML email pattern that ships for event registrations, adapted for `guild_path_members` rows created via `/api/guild-purchase`.
2. **Standalone payment page** — replace the email's UPI deep-link button with a link to a new public page on the site (`/pay`) that renders the existing `PaymentSheet` UI as a full page. Replaces the unreliable `tez://` deep link used in the event email shipped earlier today.

## Architecture

```
Email button (event OR guild)  ──▶  https://<BGC_SITE_URL>/pay?amount=N&for=<label>
                                       │
                                       └─ Astro page renders QR + UPI ID + deep links
                                          (no DB write; row is already 'confirmed')

Browser ──POST /api/guild-purchase──▶  Worker
                                         │
                                         ├─ insert guild_path_members row (existing)
                                         │
                                         └─ ctx.waitUntil(sendGuildPurchaseEmail(...))   ← new
                                                  │
                                                  ▼
                                         Apps Script doPost
                                                  │
                                                  └─ dispatch on payload.type:
                                                     - 'event_registration' → buildEventEmailHtml
                                                     - 'guild_purchase'     → buildGuildEmailHtml
```

**Key choices:**

- **Single Apps Script Web App, dispatched by `payload.type`.** Same `/exec` URL, same shared secret, same deployment. Default to `'event_registration'` for backwards-compat with the already-running flow.
- **Worker `email.ts`** grows a second export, `sendGuildPurchaseEmail`, alongside the renamed `sendEventRegistrationEmail`. Each function POSTs the same shape; only the `type` field and inner schema differ.
- **Payment page** is purely informational — no Worker endpoint, no DB write. The row is already `confirmed` server-side at the moment the email goes out, so the page just renders payment surfaces (QR, deep links, UPI ID).
- **`BGC_SITE_URL` is a Worker var** in `wrangler.toml`, passed to the email payload. Lets the URL change without re-deploying Apps Script.
- **Backwards-compatible Apps Script changes** — old payloads (without `type` or without `payment_url`) still produce a valid email. New event emails get the `/pay` button instead of the `tez://` deep link.

## Payment page

**Files:**

- Create: `src/pages/pay.astro` — minimal Astro shell that mounts the React island
- Create: `src/components/PaymentPage.tsx` — full-page version of PaymentSheet
- Create: `src/components/UpiPaymentBlock.tsx` — extracted shared component (QR + UPI ID pill + GPay/PhonePe/Paytm buttons)
- Modify: `src/components/PaymentSheet.tsx` — replace inline QR/deep-link block with `<UpiPaymentBlock>`

**URL contract:**

- `?amount=<int>` — positive integer rupees
- `?for=<string>` — short label, used as the page title and as the UPI `tn=` (transaction note)

Example: `/pay?amount=2000&for=Adventurer+%28Guild+Path%29`

**Page layout:**

- Title: `Pay for [for]`
- Big amount display: `₹[amount]`
- `<UpiPaymentBlock>` — QR code (using existing `qrserver.com` URL pattern), UPI ID pill, three deep-link buttons
- Bottom: small "Done" link to `/`

**Validation:** if `amount` is missing/non-numeric/≤0 OR `for` is empty, render an error state with message "Invalid payment link" and a link back home. No PaymentSheet UI rendered in this case.

**Why extract `UpiPaymentBlock`:** the QR + UPI ID + deep-link grid is duplicated logic between `PaymentSheet` (modal) and `PaymentPage` (full page). Shared component keeps both in sync — important because UPI deep-link schemes change occasionally and we don't want them to drift.

## Email integration

### Apps Script `Code.gs` changes

- Rename `buildEmailHtml` → `buildEventEmailHtml`. Move all current logic into it unchanged except for the payment block, which now reads `payload.payment_url`.
  - If `payment_url` present and `total_amount > 0`: render a button with `href="<payment_url>"` and label "Complete payment".
  - If `payment_url` missing: render the payment block without the button (UPI ID + amount text only).
  - The old `tez://` URL builder is removed.
- Add `buildGuildEmailHtml(payload)` — same chrome (header band, hero, total, payment block, footer), but the middle "event card" is replaced with a "membership card":
  - Tier name (e.g., "Adventurer")
  - Period label: e.g., "3 months · valid until 1 August 2026"
  - Tier price label: e.g., "₹2,000 / 3 months"
- `doPost` becomes a router:
  ```js
  const builderType = payload.type || 'event_registration';
  const html = builderType === 'guild_purchase'
    ? buildGuildEmailHtml(payload)
    : buildEventEmailHtml(payload);
  const subject = builderType === 'guild_purchase'
    ? "[BGC] Welcome to the Guild — " + payload.tier_name + "!"
    : "[BGC] You're registered for " + payload.event.name + "!";
  ```
- Validation: for `guild_purchase`, require `payload.to` and `payload.tier_name`; for `event_registration`, require `payload.to` and `payload.event.name`. Else return `{error: 'invalid payload'}`.

### Worker `email.ts` changes

- Rename `EmailPayload` → `EventEmailPayload`. Add `type: 'event_registration'` and `payment_url: string` to its shape.
- Rename `sendRegistrationEmail` → `sendEventRegistrationEmail`. Sets `type: 'event_registration'` on the POST body.
- Add `GuildPurchaseEmailPayload`:
  ```ts
  interface GuildPurchaseEmailPayload {
    to: string;
    name: string;
    tier_key: 'initiate' | 'adventurer' | 'guildmaster';
    tier_name: string;
    tier_price_label: string;
    period_label: string;
    starts_at: string;
    expires_at: string;
    total_amount: number;
    upi: { id: string; payee_name: string };
    payment_url: string;
  }
  ```
- Add `sendGuildPurchaseEmail(payload, env)` — same fetch shape as the event variant, sets `type: 'guild_purchase'` on the POST body. Same defensive empty-check on `APPS_SCRIPT_URL` / `APPS_SCRIPT_SECRET`. Same `[email]` log prefix.

### Worker `register.ts` changes

- Build `payment_url`:
  ```ts
  const payment_url = env.BGC_SITE_URL
    ? `${env.BGC_SITE_URL}/pay?amount=${totalAmount}&for=${encodeURIComponent(event.name)}`
    : '';
  ```
- Add `payment_url` (and the renamed import) to the existing `sendEventRegistrationEmail(...)` call.

### Worker `guild-purchase.ts` changes

- Add `ctx: ExecutionContext` parameter to `handleGuildPurchase` signature (parallel to `handleRegister`).
- Worker-side tier display map (small duplication of frontend `src/lib/guild-tiers.ts`):
  ```ts
  const TIER_DISPLAY: Record<Tier, { name: string; period_label_unit: string }> = {
    initiate:    { name: 'Initiate',    period_label_unit: 'months' },
    adventurer:  { name: 'Adventurer',  period_label_unit: 'months' },
    guildmaster: { name: 'Guildmaster', period_label_unit: 'months' },
  };
  ```
- After successful insert, build payload and call `ctx.waitUntil(sendGuildPurchaseEmail(...).catch(...))`. Build `payment_url` analogously to event registration:
  ```ts
  const payment_url = env.BGC_SITE_URL
    ? `${env.BGC_SITE_URL}/pay?amount=${amount}&for=${encodeURIComponent(tierDisplay.name + ' (Guild Path)')}`
    : '';
  ```
- Build `period_label` from `starts_at` and `expires_at`: `"${TIER_DURATION_MONTHS[tier]} months · valid until ${formattedExpiresAt}"`.

### Worker `index.ts` changes

- Add `BGC_SITE_URL: string` to the `Env` interface.
- Pass `ctx` to `handleGuildPurchase` (signature change).

### Worker `wrangler.toml` changes

- Add `BGC_SITE_URL = "https://boardgaming.in"` under `[vars]` — placeholder. Update to actual production URL before final deploy.

## Error handling & edge cases

| Scenario | Behavior |
|---|---|
| Payment page: `amount` missing/non-numeric/≤0 | Render error state, link home. No PaymentSheet UI. |
| Payment page: `for` missing/empty | Same error state. |
| Payment page: extra unknown URL params | Ignored. |
| Payment page accessed directly without params | Same error state. |
| Apps Script: payload missing `type` | Defaults to `'event_registration'` (back-compat). |
| Apps Script: event payload missing `payment_url` | Button hidden in payment block; UPI ID + amount text still shown. |
| Apps Script: `payload.type === 'guild_purchase'` missing required fields | Returns `{error: 'invalid payload'}`, no email sent. |
| Worker: `BGC_SITE_URL` empty/unset | `payment_url` set to `''` in payload; Apps Script renders button-less payment block. Logs `[email]` warning. |
| Worker: guild insert succeeds, email send fails | Logged via `[email]`, purchase still succeeds (same fire-and-forget guarantee). |

## Deployment order

Important — Apps Script must be updated first so guild emails don't hit old code that doesn't know `type: 'guild_purchase'`:

1. **Apps Script first.** Update `Code.gs` with new `doPost` router, rename `buildEmailHtml` → `buildEventEmailHtml`, add `buildGuildEmailHtml`. Re-deploy via "Manage deployments" → edit existing deployment → "New version". `/exec` URL stays the same; no Worker secret update needed.
2. **Then Worker.** `cd worker && npx wrangler deploy`.
3. **Then frontend push.** Push to `main` to trigger Cloudflare Pages rebuild, which deploys the new payment page.

If Worker is deployed before Apps Script, there's a brief window where guild emails would render as malformed events. Sequencing this way avoids that.

## Out of scope (YAGNI)

- No "I've paid" button on the payment page (no DB write to perform).
- No payment page analytics / tracking.
- No backfill emails for past registrations.
- No tier-specific welcome content / benefits list in the guild email (the user just bought it; they saw the benefits seconds ago).
- No retry queue or admin failure notifications (same rationale as the original email design).

## Testing

- **Apps Script:** add `testGuildEmailToSelf` runner inside `Code.gs` paralleling `testSendEmailToSelf`. Run, eyeball output.
- **Payment page:** load `/pay?amount=500&for=Test+Event` in dev, confirm QR + deep links render correctly. Load `/pay` (no params) and `/pay?amount=abc` to confirm error state.
- **End-to-end guild:** purchase any tier on `/guild-path` with a real email, verify email arrives correctly formatted, click "Complete payment" button → lands on payment page with right amount + label.
- **End-to-end event:** submit any event registration, verify email's button now goes to `/pay` (not `tez://`).
- **Failure path:** temporarily break `APPS_SCRIPT_SECRET` and confirm both event and guild flows still complete (rows inserted, no error to user) with logs in `wrangler tail`.
