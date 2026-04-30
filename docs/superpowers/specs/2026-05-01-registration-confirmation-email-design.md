# Registration Confirmation Email — Design

**Date:** 2026-05-01
**Status:** Approved

## Goal

Send a single HTML confirmation email to every user immediately after they submit a registration on the BGC site, regardless of payment status (`pending` or `confirmed`). Email comes from the BGC personal Gmail account via Google Apps Script.

## Architecture

```
Browser  ──POST /api/register──▶  Worker
                                    │
                                    ├─ insert registration row (existing)
                                    │
                                    └─ ctx.waitUntil(sendEmail(...))   ← new, fire-and-forget
                                                │
                                                ▼
                                       Apps Script Web App (doPost)
                                                │
                                                ├─ verify shared secret
                                                └─ MailApp.sendEmail(...)  ← from BGC Gmail
```

**Key decisions:**

- **Email service:** Google Apps Script Web App + `MailApp.sendEmail` from a personal Gmail account (100 emails/day quota).
- **Trigger:** Fires on every successful registration insert, regardless of `payment_status`.
- **Fire-and-forget:** Worker uses `ctx.waitUntil` so email failures never block or fail the registration response. The user is registered even if the email never sends.
- **Auth:** Apps Script Web App is deployed with "Anyone" access (required for unauthenticated Worker calls). A shared secret in the request body gates actual sending. The secret lives in a Worker secret and an Apps Script Script Property.
- **Single source of truth for UPI ID:** Moved from `PaymentSheet.tsx` hardcode into a Worker secret (used by the email payload) plus a `PUBLIC_UPI_ID` env var (used by `PaymentSheet.tsx`).

## Email content

**Subject:** `You're registered for <Event Name> — BGC`
**From name:** `BGC`
**Reply-to:** the BGC Gmail (default)

**Body sections, top to bottom:**

1. **Header band** — orange (`#F47B20`) bar with "BGC" wordmark in white, left-aligned.
2. **Hero line** — "You're registered, [Name]!" in heavy weight (Arial Black / Helvetica Bold fallback for Space Grotesk).
3. **Event card** — bordered box on `#FFF8F0`:
   - Event name
   - Date formatted as "Sat, 17 May 2026 · 7:00 PM" (IST)
   - Venue: `<venue_name> · <venue_area>` (renders just `venue_name` if `venue_area` is empty)
   - Seats: "N seats"
   - `price_includes` line in muted gray (hidden if null)
4. **Your selections** — only renders if `custom_questions` array is non-empty. Two-column list of `label → answer` for each answered custom question.
5. **Total amount** —
   - If `total_amount > 0`: "Total: ₹<amount>"
   - If `total_amount === 0`: "Total: Free (Guild Path)"
6. **Payment block** — only renders if `total_amount > 0`. Framed as "If you haven't paid yet:":
   - UPI ID + amount as monospace text (copy-friendly)
   - "Pay via UPI app" button → `upi://pay?pa=<id>&pn=BGC&am=<amount>&cu=INR&tn=<event-name>` (works on mobile, harmless on desktop)
   - Note: "Already paid? You can ignore this section."
7. **Footer** — "Questions? Reply to this email or WhatsApp [number]." + small BGC sign-off.

**Styling:**

- Max width 600px, centered, table-based layout (email-client compatible).
- Inline CSS only.
- Palette: `#F47B20` (primary), `#FFF8F0` (bg), `#1A1A1A` (text), `#4A9B8E` (accent).
- No external images — wordmark is text, not an image.

## Data flow

**Worker → Apps Script payload (POST JSON):**

```json
{
  "secret": "<shared-secret>",
  "to": "user@example.com",
  "name": "User Name",
  "event": {
    "name": "Catan Night",
    "date": "2026-05-17T19:00:00+05:30",
    "venue_name": "The Den",
    "venue_area": "Indiranagar",
    "price_includes": "Includes dinner + library access"
  },
  "seats": 2,
  "total_amount": 1000,
  "discount_applied": null,
  "custom_questions": [
    { "id": "q1", "label": "Game preference", "answer": "Catan" }
  ],
  "upi": {
    "id": "yourid@okaxis",
    "payee_name": "BGC"
  }
}
```

**Worker resolves the payload:** Joins the registration's raw `custom_answers` map (`{id: value}`) against `event.custom_questions` to produce a `custom_questions` array with labels. Apps Script does not need to know the question schema.

**Apps Script response:** `{ success: true }` on success, `{ error: "..." }` with non-200 status on failure. Worker logs the response but ignores it.

## Code shape

### Worker

- **New file:** `worker/src/email.ts` exporting `sendRegistrationEmail(payload, env): Promise<void>`.
- **Modify `worker/src/register.ts`:** After the registration insert succeeds, build the payload and call `ctx.waitUntil(sendRegistrationEmail(payload, env).catch(err => console.error('email failed', err)))`.
- **Modify `worker/src/index.ts`:** Change `fetch(request, env)` to `fetch(request, env, ctx)` and pass `ctx` through to handlers that need it (currently just `handleRegister`).
- **Modify `worker/src/index.ts` `Env` interface:** Add `APPS_SCRIPT_URL`, `APPS_SCRIPT_SECRET`, `UPI_ID`.

### Apps Script

- **Single file:** `Code.gs`.
- **`doPost(e)`** — parse JSON body, verify `secret` against `PropertiesService.getScriptProperties().getProperty('SHARED_SECRET')`, build HTML via `buildEmailHtml(payload)`, send with `MailApp.sendEmail({ to, subject, htmlBody, name: 'BGC' })`.
- **`buildEmailHtml(payload)`** — pure function returning the HTML string. Testable in isolation from the Apps Script runner.

### Frontend

- **Modify `src/components/PaymentSheet.tsx`:** Replace the hardcoded UPI ID with `import.meta.env.PUBLIC_UPI_ID`.

## Error handling & edge cases

| Scenario | Behavior |
|---|---|
| Apps Script down / slow / non-200 | Worker logs via `console.error`, returns success to browser. User registered, no email. Visible in `wrangler tail`. |
| Wrong shared secret | Apps Script returns 401, Worker logs, swallows. |
| User typos email (passes format validation) | MailApp sends, bounces silently to BGC Gmail's "Mail Delivery Subsystem". |
| Daily quota (100/day) hit | MailApp throws inside Apps Script. Apps Script returns 500. Worker logs. |
| `total_amount === 0` (Guild Path free) | Payment block hidden, "Total: Free (Guild Path)" shown. |
| `custom_answers` empty/missing | "Your selections" section hidden. |
| `price_includes` null | That line hidden. |
| Event without `venue_area` | Render just `venue_name`. |

**Out of scope (YAGNI):**

- Retry queue / DLQ — small volume, manual resend is fine.
- `email_sent` flag in DB — schema change for marginal value; failures show in logs.
- Admin failure notifications — quota issues will be obvious from missing emails.
- Double-send protection — 1 registration = 1 email. Duplicate-registration concerns are a separate problem.
- `.ics` calendar attachment — adds Apps Script complexity without strong demand.

## Secrets & setup

**Worker secrets (via `wrangler secret put`):**

- `APPS_SCRIPT_URL` — the Web App `/exec` URL.
- `APPS_SCRIPT_SECRET` — random string.

**Worker vars (in `worker/wrangler.toml`):**

- `UPI_ID` — moved from `PaymentSheet.tsx` hardcode. Not secret (already public in the UI), but lives here so the Worker can embed it in the email payload.

**Apps Script Script Properties:**

- `SHARED_SECRET` — same value as `APPS_SCRIPT_SECRET`.

**Frontend env (`.env.local` and Cloudflare Pages):**

- `PUBLIC_UPI_ID` — same UPI ID, used by `PaymentSheet.tsx`.

**One-time setup steps (will be detailed in the implementation plan):**

1. Create the Apps Script project, paste `Code.gs`.
2. Set `SHARED_SECRET` in Script Properties.
3. Run `doPost` once manually to grant Mail permission.
4. Deploy as Web App (execute as: me; access: Anyone).
5. Copy the `/exec` URL into the Worker secret.
6. Set `APPS_SCRIPT_URL` and `APPS_SCRIPT_SECRET` as Worker secrets; set `UPI_ID` in `worker/wrangler.toml`.
7. Set `PUBLIC_UPI_ID` in Cloudflare Pages env vars and `.env.local`.
8. Deploy Worker and site.

## Inputs needed before implementation

- **BGC Gmail address** that will own the Apps Script project and send emails (determines the visible "From" address).
- **WhatsApp contact number** to include in the email footer.
- **Confirmation of the existing UPI ID** currently hardcoded in `PaymentSheet.tsx` (will be promoted to env var).

## Testing

- **Unit-ish:** Test `buildEmailHtml(payload)` inside Apps Script runner with a sample payload covering: paid registration with custom answers, free Guild Path registration, registration without `price_includes` or `custom_answers`, event without `venue_area`.
- **End-to-end:** Submit a real registration on the dev site, confirm email arrives correctly formatted in inbox. Test on Gmail web, Gmail mobile app, and Apple Mail.
- **Failure path:** Temporarily break `APPS_SCRIPT_SECRET` to confirm registration still succeeds and error appears in `wrangler tail`.
