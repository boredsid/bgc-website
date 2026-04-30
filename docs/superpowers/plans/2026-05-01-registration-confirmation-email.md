# Registration Confirmation Email Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send an HTML confirmation email to every user immediately after they submit a registration on the BGC site, regardless of payment status, via a Google Apps Script Web App that sends from a personal Gmail account.

**Architecture:** The Worker `register.ts` builds an email payload after the registration insert succeeds and POSTs it to a Google Apps Script Web App via `ctx.waitUntil` (fire-and-forget). The Apps Script verifies a shared secret, builds the HTML, and sends with `MailApp.sendEmail`. UPI ID is promoted out of the frontend hardcode into a shared env var.

**Tech Stack:** Cloudflare Workers (TypeScript), Google Apps Script (V8), Astro/React frontend, Supabase (existing).

**Spec:** `docs/superpowers/specs/2026-05-01-registration-confirmation-email-design.md`

---

## Inputs (resolved)

- **Apps Script owner Gmail:** `boardgamecompany2024@gmail.com` (this account creates and runs the Apps Script).
- **Visible "From" address:** `hello@boardgamecompany.in` (a domain alias of the Gmail account above).
- **WhatsApp number digits:** `919982200768` (used in `wa.me/<digits>`).
- **WhatsApp number display:** `+91 99822 00768`.
- **UPI ID:** `suranjanadatta24-1@okaxis` (confirmed unchanged).

### Critical precondition for the alias

For emails to come **from** `hello@boardgamecompany.in` instead of `boardgamecompany2024@gmail.com`, the alias must be set up as a verified "Send mail as" address in the Gmail account. Verify before Task 4:

1. Sign in to `mail.google.com` as `boardgamecompany2024@gmail.com`.
2. Settings (gear) → "See all settings" → "Accounts and Import" tab.
3. Under "Send mail as", `hello@boardgamecompany.in` must be listed and verified.

If it is not listed, set it up via "Add another email address" before continuing — Apps Script's `MailApp.sendEmail({ from })` will fail with a permissions error otherwise.

---

## Task 1: Promote UPI ID to env vars

**Files:**
- Modify: `src/components/PaymentSheet.tsx:9-10`
- Modify: `worker/wrangler.toml`
- Modify: `.env.local` (project root)

- [ ] **Step 1: Add `UPI_ID` var to `worker/wrangler.toml`**

Replace the file contents with:

```toml
name = "bgc-api"
main = "src/index.ts"
compatibility_date = "2025-04-01"

[vars]
SUPABASE_URL = "https://yhgtwqdsnrslcgdvmunz.supabase.co"
UPI_ID = "suranjanadatta24-1@okaxis"

# Set secrets via: wrangler secret put SUPABASE_SERVICE_KEY
# Email secrets: wrangler secret put APPS_SCRIPT_URL / APPS_SCRIPT_SECRET
```

- [ ] **Step 2: Add `PUBLIC_UPI_ID` to `.env.local`**

Append to `.env.local`:

```
PUBLIC_UPI_ID=suranjanadatta24-1@okaxis
```

- [ ] **Step 3: Update `PaymentSheet.tsx` to read from env**

In `src/components/PaymentSheet.tsx`, replace lines 9-10:

```tsx
const UPI_ID = 'suranjanadatta24-1@okaxis';
const RECIPIENT_NAME = 'Board Game Company';
```

with:

```tsx
const UPI_ID = import.meta.env.PUBLIC_UPI_ID as string;
const RECIPIENT_NAME = 'Board Game Company';
```

- [ ] **Step 4: Verify locally**

Run: `npm run dev`
Open: `http://localhost:4321/register?event=<any-published-event-id>`
Fill the form, click "Proceed to Pay", confirm the PaymentSheet shows the UPI ID identical to before. Inspect QR code or UPI ID pill — should match `suranjanadatta24-1@okaxis`.

- [ ] **Step 5: Commit**

```bash
git add src/components/PaymentSheet.tsx worker/wrangler.toml .env.local
git commit -m "refactor(payment): move UPI ID to env vars"
```

Note: `.env.local` is committed in this repo per existing pattern — verify with `git status` after staging. If `.env.local` is gitignored, skip staging it (the dev still needs the value locally; production sets it in Cloudflare Pages dashboard).

- [ ] **Step 6: Set `PUBLIC_UPI_ID` in Cloudflare Pages dashboard**

1. Go to Cloudflare dashboard → Pages → the BGC site project → Settings → Environment variables.
2. Add `PUBLIC_UPI_ID` = `suranjanadatta24-1@okaxis` to **both** Production and Preview environments.
3. Trigger a redeploy (Deployments → "Retry deployment" on the latest, or push a fresh commit). Per CLAUDE.md gotcha: env var changes only take effect after redeploy.

---

## Task 2: Set up Apps Script project and skeleton

This task is performed in the Apps Script web UI by the human — it cannot be scripted.

**Files:**
- Create (in Apps Script): `Code.gs` (single file inside the new Apps Script project)

- [ ] **Step 1: Create the Apps Script project**

1. Sign in to `script.google.com` using the `boardgamecompany2024@gmail.com` account.
2. Click "New project". Rename it to `BGC Registration Email`.
3. Delete the default content of `Code.gs`.

- [ ] **Step 2: Paste the skeleton with secret verification**

Paste this into `Code.gs`:

```js
const SCRIPT_PROPS = PropertiesService.getScriptProperties();

const WHATSAPP_NUMBER_DIGITS = '919982200768';
const WHATSAPP_NUMBER_DISPLAY = '+91 99822 00768';
const FROM_ADDRESS = 'hello@boardgamecompany.in';

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);

    const expectedSecret = SCRIPT_PROPS.getProperty('SHARED_SECRET');
    if (!expectedSecret || payload.secret !== expectedSecret) {
      return jsonResponse({ error: 'unauthorized' });
    }

    // Email sending will be wired up in Task 4.
    return jsonResponse({ success: true, stub: true });
  } catch (err) {
    return jsonResponse({ error: String(err) });
  }
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
```

These values come from "Inputs (resolved)" at the top of the plan.

- [ ] **Step 3: Set the SHARED_SECRET script property**

1. In the Apps Script editor, click the gear icon → "Project Settings".
2. Scroll to "Script Properties" → "Add script property".
3. Set name `SHARED_SECRET`, value: a freshly generated random string (use `openssl rand -hex 32` in a terminal). Save it — you'll paste the same value into the Worker secret in Task 9.

- [ ] **Step 4: Save the project**

Click the floppy/save icon. Confirm there are no syntax errors.

- [ ] **Step 5: Commit (no code change in repo, but record progress)**

This task produces no repo changes. Move on to Task 3.

---

## Task 3: Add `buildEmailHtml` function in Apps Script

**Files:**
- Modify (in Apps Script): `Code.gs`

- [ ] **Step 1: Add `escapeHtml` and `buildEmailHtml` to `Code.gs`**

Append below the existing `jsonResponse` function:

```js
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, function(c) {
    return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
  });
}

function buildEmailHtml(payload) {
  const name = payload.name;
  const event = payload.event;
  const seats = payload.seats;
  const totalAmount = payload.total_amount;
  const customQuestions = payload.custom_questions || [];
  const upi = payload.upi;

  const eventDate = new Date(event.date);
  const dateStr = Utilities.formatDate(eventDate, 'Asia/Kolkata', 'EEE, d MMM yyyy');
  const timeStr = Utilities.formatDate(eventDate, 'Asia/Kolkata', 'h:mm a');

  const venue = event.venue_area
    ? escapeHtml(event.venue_name) + ' · ' + escapeHtml(event.venue_area)
    : escapeHtml(event.venue_name);

  const totalLine = totalAmount === 0 ? 'Free (Guild Path)' : '₹' + totalAmount;

  let priceIncludesLine = '';
  if (event.price_includes) {
    priceIncludesLine = '<div style="color:#666;font-size:14px;margin-top:8px;">' +
      escapeHtml(event.price_includes) + '</div>';
  }

  let selectionsBlock = '';
  const visibleAnswers = customQuestions.filter(function(q) {
    return q.answer !== '' && q.answer !== false && q.answer !== null && q.answer !== undefined;
  });
  if (visibleAnswers.length > 0) {
    const rows = visibleAnswers.map(function(q) {
      return '<tr>' +
        '<td style="padding:6px 12px 6px 0;color:#666;font-size:14px;vertical-align:top;">' + escapeHtml(q.label) + '</td>' +
        '<td style="padding:6px 0;color:#1A1A1A;font-size:14px;">' + escapeHtml(String(q.answer)) + '</td>' +
        '</tr>';
    }).join('');
    selectionsBlock =
      '<table style="width:100%;border-collapse:collapse;margin:20px 0;">' +
        '<tr><td colspan="2" style="font-size:13px;text-transform:uppercase;letter-spacing:1px;color:#999;padding-bottom:8px;">Your selections</td></tr>' +
        rows +
      '</table>';
  }

  let paymentBlock = '';
  if (totalAmount > 0) {
    const upiUrl = 'upi://pay?pa=' + encodeURIComponent(upi.id) +
      '&pn=' + encodeURIComponent(upi.payee_name) +
      '&am=' + totalAmount +
      '&cu=INR&tn=' + encodeURIComponent(event.name);
    paymentBlock =
      '<table style="width:100%;border-collapse:collapse;margin:24px 0;background:#FFF8F0;border:2px solid #1A1A1A;border-radius:8px;">' +
        '<tr><td style="padding:20px;">' +
          '<div style="font-size:13px;text-transform:uppercase;letter-spacing:1px;color:#999;margin-bottom:8px;">If you haven\'t paid yet</div>' +
          '<div style="font-family:monospace;font-size:15px;color:#1A1A1A;margin-bottom:4px;">UPI: ' + escapeHtml(upi.id) + '</div>' +
          '<div style="font-family:monospace;font-size:15px;color:#1A1A1A;margin-bottom:16px;">Amount: ₹' + totalAmount + '</div>' +
          '<a href="' + upiUrl + '" style="display:inline-block;background:#F47B20;color:#fff;text-decoration:none;padding:12px 24px;border-radius:6px;font-weight:bold;font-size:15px;">Pay ₹' + totalAmount + ' via UPI app</a>' +
          '<div style="color:#999;font-size:13px;margin-top:12px;">Already paid? You can ignore this section.</div>' +
        '</td></tr>' +
      '</table>';
  }

  return '<!DOCTYPE html>' +
    '<html><head><meta charset="utf-8"><title>You are registered</title></head>' +
    '<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,Helvetica,sans-serif;color:#1A1A1A;">' +
      '<table style="width:100%;border-collapse:collapse;background:#f5f5f5;padding:24px 0;">' +
        '<tr><td align="center">' +
          '<table style="width:100%;max-width:600px;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden;">' +
            '<tr><td style="background:#F47B20;padding:20px 24px;">' +
              '<div style="color:#fff;font-family:Arial Black,Helvetica,Arial,sans-serif;font-weight:900;font-size:20px;letter-spacing:1px;">BGC</div>' +
            '</td></tr>' +
            '<tr><td style="padding:32px 24px;">' +
              '<div style="font-family:Arial Black,Helvetica,Arial,sans-serif;font-weight:900;font-size:28px;line-height:1.2;color:#1A1A1A;margin-bottom:24px;">You\'re registered, ' + escapeHtml(name) + '!</div>' +
              '<table style="width:100%;border-collapse:collapse;background:#FFF8F0;border:2px solid #1A1A1A;border-radius:8px;">' +
                '<tr><td style="padding:20px;">' +
                  '<div style="font-family:Arial Black,Helvetica,Arial,sans-serif;font-weight:900;font-size:20px;color:#1A1A1A;margin-bottom:8px;">' + escapeHtml(event.name) + '</div>' +
                  '<div style="color:#1A1A1A;font-size:15px;margin-bottom:4px;">' + dateStr + ' · ' + timeStr + '</div>' +
                  '<div style="color:#1A1A1A;font-size:15px;margin-bottom:4px;">' + venue + '</div>' +
                  '<div style="color:#1A1A1A;font-size:15px;">' + seats + ' seat' + (seats === 1 ? '' : 's') + '</div>' +
                  priceIncludesLine +
                '</td></tr>' +
              '</table>' +
              selectionsBlock +
              '<div style="font-family:Arial Black,Helvetica,Arial,sans-serif;font-weight:900;font-size:22px;color:#F47B20;margin:24px 0 0 0;">Total: ' + totalLine + '</div>' +
              paymentBlock +
              '<div style="color:#666;font-size:14px;margin-top:32px;border-top:1px solid #eee;padding-top:16px;">' +
                'Questions? Reply to this email or WhatsApp <a href="https://wa.me/' + WHATSAPP_NUMBER_DIGITS + '" style="color:#F47B20;">' + WHATSAPP_NUMBER_DISPLAY + '</a>.' +
              '</div>' +
              '<div style="color:#999;font-size:13px;margin-top:8px;">— BGC · Bangalore\'s board gaming community</div>' +
            '</td></tr>' +
          '</table>' +
        '</td></tr>' +
      '</table>' +
    '</body></html>';
}
```

- [ ] **Step 2: Add a manual test runner function**

Append to `Code.gs`:

```js
function testBuildEmailHtml() {
  const samplePaid = {
    name: 'Test User',
    event: {
      name: 'Catan Night',
      date: '2026-05-17T19:00:00+05:30',
      venue_name: 'The Den',
      venue_area: 'Indiranagar',
      price_includes: 'Includes dinner + library access',
    },
    seats: 2,
    total_amount: 1000,
    discount_applied: null,
    custom_questions: [
      { id: 'q1', label: 'Game preference', answer: 'Catan' },
      { id: 'q2', label: 'Dietary', answer: 'Vegetarian' },
    ],
    upi: { id: 'suranjanadatta24-1@okaxis', payee_name: 'Board Game Company' },
  };
  const sampleFree = Object.assign({}, samplePaid, {
    total_amount: 0,
    discount_applied: 'adventurer',
    custom_questions: [],
    event: Object.assign({}, samplePaid.event, { price_includes: null }),
  });
  Logger.log('--- PAID ---');
  Logger.log(buildEmailHtml(samplePaid));
  Logger.log('--- FREE ---');
  Logger.log(buildEmailHtml(sampleFree));
}
```

- [ ] **Step 3: Run `testBuildEmailHtml` in the Apps Script editor**

1. In the editor, select `testBuildEmailHtml` from the function dropdown.
2. Click "Run".
3. Open "Execution log" (View → Logs or Ctrl+Enter).
4. Confirm both HTML strings logged without errors.
5. Spot-check: paid output contains `Pay ₹1000 via UPI app`, free output contains `Free (Guild Path)` and no payment block.

- [ ] **Step 4: Save the project.**

---

## Task 4: Wire up `MailApp.sendEmail` in `doPost`

**Files:**
- Modify (in Apps Script): `Code.gs`

- [ ] **Step 1: Replace the stub in `doPost`**

In `Code.gs`, replace the body of `doPost` with:

```js
function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);

    const expectedSecret = SCRIPT_PROPS.getProperty('SHARED_SECRET');
    if (!expectedSecret || payload.secret !== expectedSecret) {
      return jsonResponse({ error: 'unauthorized' });
    }

    if (!payload.to || !payload.event || !payload.event.name) {
      return jsonResponse({ error: 'invalid payload' });
    }

    const html = buildEmailHtml(payload);
    const subject = "You're registered for " + payload.event.name + ' — BGC';

    MailApp.sendEmail({
      to: payload.to,
      subject: subject,
      htmlBody: html,
      name: 'BGC',
      from: FROM_ADDRESS,
    });

    return jsonResponse({ success: true });
  } catch (err) {
    return jsonResponse({ error: String(err) });
  }
}
```

- [ ] **Step 2: Add a self-send test**

Append to `Code.gs`:

```js
function testSendEmailToSelf() {
  const me = Session.getActiveUser().getEmail();
  const payload = {
    to: me,
    name: 'Test User',
    event: {
      name: 'Test Event',
      date: '2026-05-17T19:00:00+05:30',
      venue_name: 'The Den',
      venue_area: 'Indiranagar',
      price_includes: 'Includes dinner',
    },
    seats: 1,
    total_amount: 500,
    discount_applied: null,
    custom_questions: [{ id: 'q1', label: 'Game', answer: 'Catan' }],
    upi: { id: 'suranjanadatta24-1@okaxis', payee_name: 'Board Game Company' },
  };
  const html = buildEmailHtml(payload);
  MailApp.sendEmail({
    to: payload.to,
    subject: "You're registered for " + payload.event.name + ' — BGC',
    htmlBody: html,
    name: 'BGC',
    from: FROM_ADDRESS,
  });
  Logger.log('Sent test email to ' + me);
}
```

- [ ] **Step 3: Run `testSendEmailToSelf` and grant permissions**

1. Select `testSendEmailToSelf` in the function dropdown → Run.
2. Apps Script will prompt for permissions: "Send email as you" — review and authorize.
3. After authorization, run again. Apps Script will prompt for an additional permission to send mail as the alias — authorize. Check the inbox for the email. Verify:
   - From: `BGC <hello@boardgamecompany.in>`
   - Subject: `You're registered for Test Event — BGC`
   - Layout matches the spec (orange header band, event card, payment block, footer)
   - Render in Gmail web AND Gmail mobile app if accessible

If you see "Invalid From: address" instead of the email, the alias setup in the precondition was missed — go back and add `hello@boardgamecompany.in` as a "Send mail as" address in Gmail settings.

If the layout is broken, iterate on `buildEmailHtml` (Task 3 step 1) and re-run.

- [ ] **Step 4: Save the project.**

---

## Task 5: Deploy Apps Script as Web App

**Files:**
- (Apps Script UI only — no repo changes)

- [ ] **Step 1: Create a Web App deployment**

1. In the Apps Script editor, click "Deploy" → "New deployment".
2. Click the gear icon next to "Select type" → choose "Web app".
3. Description: `BGC registration email v1`.
4. Execute as: **Me (BGC_GMAIL)**.
5. Who has access: **Anyone** (required for unauthenticated Worker calls — the shared secret in body is the actual auth boundary).
6. Click "Deploy".
7. Copy the **Web App URL** (ends in `/exec`). Save it — Task 9 needs it.

- [ ] **Step 2: Smoke-test the deployment with curl**

Run from a local terminal (replace `<URL>` and `<SECRET>`):

```bash
curl -L -X POST '<URL>' \
  -H 'Content-Type: application/json' \
  -d '{
    "secret": "<SECRET>",
    "to": "<your-test-email>",
    "name": "Curl Test",
    "event": {
      "name": "Curl Event",
      "date": "2026-05-17T19:00:00+05:30",
      "venue_name": "Test Venue",
      "venue_area": "Indiranagar",
      "price_includes": null
    },
    "seats": 1,
    "total_amount": 500,
    "discount_applied": null,
    "custom_questions": [],
    "upi": { "id": "suranjanadatta24-1@okaxis", "payee_name": "Board Game Company" }
  }'
```

Expected: `{"success":true}` and an email arrives at the test address.

- [ ] **Step 3: Negative test — wrong secret**

Run the same curl with `"secret": "wrong"`.
Expected: `{"error":"unauthorized"}` and no email sent.

---

## Task 6: Refactor Worker handlers to receive `ExecutionContext`

**Files:**
- Modify: `worker/src/index.ts`
- Modify: `worker/src/register.ts:5`
- Modify: `worker/src/lookup-phone.ts` (signature only if it doesn't take a third arg already)
- Modify: `worker/src/event-spots.ts` (signature only)
- Modify: `worker/src/guild-purchase.ts` (signature only)

- [ ] **Step 1: Update `worker/src/index.ts`**

Replace the file contents:

```ts
import { handleLookupPhone } from './lookup-phone';
import { handleRegister } from './register';
import { handleEventSpots } from './event-spots';
import { handleGuildPurchase } from './guild-purchase';

export interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
  UPI_ID: string;
  APPS_SCRIPT_URL: string;
  APPS_SCRIPT_SECRET: string;
}

function corsHeaders(origin: string | null): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    const headers = corsHeaders(origin);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers });
    }

    try {
      let response: Response;

      if (url.pathname === '/api/lookup-phone' && request.method === 'POST') {
        response = await handleLookupPhone(request, env);
      } else if (url.pathname === '/api/register' && request.method === 'POST') {
        response = await handleRegister(request, env, ctx);
      } else if (url.pathname.startsWith('/api/event-spots/') && request.method === 'GET') {
        const eventId = url.pathname.split('/api/event-spots/')[1];
        response = await handleEventSpots(eventId, env);
      } else if (url.pathname === '/api/guild-purchase' && request.method === 'POST') {
        response = await handleGuildPurchase(request, env);
      } else {
        response = new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
      }

      const newHeaders = new Headers(response.headers);
      for (const [key, value] of Object.entries(headers)) {
        newHeaders.set(key, value);
      }
      return new Response(response.body, { status: response.status, headers: newHeaders });
    } catch (err) {
      return new Response(
        JSON.stringify({ error: 'Internal server error' }),
        { status: 500, headers: { ...headers, 'Content-Type': 'application/json' } }
      );
    }
  },
};
```

- [ ] **Step 2: Update `handleRegister` signature in `worker/src/register.ts`**

Change line 5 from:

```ts
export async function handleRegister(request: Request, env: Env): Promise<Response> {
```

to:

```ts
export async function handleRegister(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
```

(Body unchanged for now — `ctx` will be used in Task 8.)

- [ ] **Step 3: Type-check the Worker**

Run:

```bash
cd worker && npx tsc --noEmit
```

Expected: no errors. (Cloudflare Workers types include `ExecutionContext` via `@cloudflare/workers-types`.)

- [ ] **Step 4: Commit**

```bash
git add worker/src/index.ts worker/src/register.ts
git commit -m "refactor(worker): pass ExecutionContext through to register handler"
```

---

## Task 7: Create `worker/src/email.ts`

**Files:**
- Create: `worker/src/email.ts`

- [ ] **Step 1: Create the file**

Create `worker/src/email.ts` with:

```ts
import type { Env } from './index';

export interface EmailPayload {
  to: string;
  name: string;
  event: {
    name: string;
    date: string;
    venue_name: string;
    venue_area: string | null;
    price_includes: string | null;
  };
  seats: number;
  total_amount: number;
  discount_applied: string | null;
  custom_questions: Array<{ id: string; label: string; answer: string | boolean }>;
  upi: {
    id: string;
    payee_name: string;
  };
}

export async function sendRegistrationEmail(payload: EmailPayload, env: Env): Promise<void> {
  if (!env.APPS_SCRIPT_URL || !env.APPS_SCRIPT_SECRET) {
    console.error('[email] APPS_SCRIPT_URL or APPS_SCRIPT_SECRET not configured; skipping');
    return;
  }

  const body = JSON.stringify({ ...payload, secret: env.APPS_SCRIPT_SECRET });

  const res = await fetch(env.APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    redirect: 'follow',
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '<unreadable>');
    console.error(`[email] non-OK response: ${res.status} ${text}`);
    return;
  }

  const result = await res.json<{ success?: boolean; error?: string }>().catch(() => null);
  if (!result?.success) {
    console.error(`[email] non-success body: ${JSON.stringify(result)}`);
  }
}
```

- [ ] **Step 2: Type-check**

Run:

```bash
cd worker && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add worker/src/email.ts
git commit -m "feat(worker): add sendRegistrationEmail module"
```

---

## Task 8: Wire email send into `register.ts`

**Files:**
- Modify: `worker/src/register.ts`

- [ ] **Step 1: Add the import**

At the top of `worker/src/register.ts`, add:

```ts
import { sendRegistrationEmail } from './email';
```

- [ ] **Step 2: Build payload and call after successful insert**

In `worker/src/register.ts`, find the block that ends with:

```ts
  if (regError) {
    return jsonResponse({ error: 'Registration failed' }, 500);
  }

  return jsonResponse({ success: true, registration_id: registration.id });
}
```

Replace it with:

```ts
  if (regError) {
    return jsonResponse({ error: 'Registration failed' }, 500);
  }

  const customQuestionsForEmail = customQuestions
    .filter((q) => {
      const a = customAnswers[q.id];
      return a !== undefined && a !== null && a !== '' && a !== false;
    })
    .map((q) => ({
      id: q.id,
      label: q.label,
      answer: customAnswers[q.id] as string | boolean,
    }));

  ctx.waitUntil(
    sendRegistrationEmail(
      {
        to: email,
        name,
        event: {
          name: event.name,
          date: event.date,
          venue_name: event.venue_name,
          venue_area: event.venue_area ?? null,
          price_includes: event.price_includes ?? null,
        },
        seats,
        total_amount: totalAmount,
        discount_applied: discountApplied,
        custom_questions: customQuestionsForEmail,
        upi: {
          id: env.UPI_ID,
          payee_name: 'Board Game Company',
        },
      },
      env
    ).catch((err) => console.error('[email] send error', err))
  );

  return jsonResponse({ success: true, registration_id: registration.id });
}
```

- [ ] **Step 3: Type-check**

Run:

```bash
cd worker && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add worker/src/register.ts
git commit -m "feat(register): send confirmation email via Apps Script after insert"
```

---

## Task 9: Set Worker secrets and deploy

**Files:**
- (No repo changes — Cloudflare Worker config only)

- [ ] **Step 1: Set `APPS_SCRIPT_URL` secret**

Run from `worker/` directory:

```bash
cd worker
npx wrangler secret put APPS_SCRIPT_URL
```

When prompted, paste the Web App URL copied in Task 5 step 1 (the `/exec` URL).

- [ ] **Step 2: Set `APPS_SCRIPT_SECRET` secret**

```bash
npx wrangler secret put APPS_SCRIPT_SECRET
```

Paste the same random string set as `SHARED_SECRET` in Apps Script Script Properties (Task 2 step 3).

- [ ] **Step 3: Deploy the Worker**

```bash
npx wrangler deploy
```

Expected: deployment succeeds, URL printed (`bgc-api.boredsid.workers.dev`).

- [ ] **Step 4: Tail the Worker logs in a separate terminal**

```bash
npx wrangler tail
```

Leave this running for Tasks 10–12. Watch for `[email]` log lines.

---

## Task 10: End-to-end test — paid registration

**Files:**
- (No repo changes — manual verification)

- [ ] **Step 1: Submit a real paid registration**

1. Open `https://boredgaming.in/register?event=<published-paid-event-id>` (or the dev/staging URL for the deployed site).
2. Fill out the form with a phone you control and an email you can check (e.g. your own).
3. Choose 1 seat, fill any custom questions.
4. Click "Proceed to Pay" → on PaymentSheet, click "I've completed the payment".
5. Wait for the success screen.

- [ ] **Step 2: Verify the email**

Within ~5 seconds, an email should arrive at the address you used. Check:

- Subject: `You're registered for <Event Name> — BGC`
- From: `BGC <hello@boardgamecompany.in>`
- Hero: `You're registered, <Your Name>!`
- Event card shows correct event name, date, venue, seat count
- `price_includes` line shows if event has it
- "Your selections" block shows custom answers (if any)
- Total: `₹<correct amount>`
- Payment block: UPI ID matches, "Pay via UPI app" button present
- Footer: WhatsApp link works
- Render in Gmail web AND Gmail mobile (if available)

- [ ] **Step 3: Check `wrangler tail` output**

In the tail terminal, confirm no `[email]` error lines appeared.

---

## Task 11: End-to-end test — free Guild Path registration

**Files:**
- (No repo changes — manual verification)

- [ ] **Step 1: Use a phone associated with a paid Guild Path adventurer/guildmaster**

If no such test member exists, briefly insert one in Supabase:

```sql
-- Replace <user_id> with a real users.id whose phone you control
INSERT INTO guild_path_members (user_id, tier, status, expires_at)
VALUES ('<user_id>', 'adventurer', 'paid', '2027-01-01');
```

(Remember to remove this row after testing.)

- [ ] **Step 2: Submit a registration with that phone**

The form should detect the membership and skip PaymentSheet. After clicking "Get my spot" you should land on the success screen.

- [ ] **Step 3: Verify the email**

Email should arrive with:

- Total: `Free (Guild Path)`
- **No** payment block (no UPI button, no "If you haven't paid yet" section)

- [ ] **Step 4: Clean up the test guild member row**

```sql
DELETE FROM guild_path_members WHERE user_id = '<user_id>' AND tier = 'adventurer' AND status = 'paid' AND expires_at = '2027-01-01';
```

---

## Task 12: Failure path — verify registration still succeeds when email fails

**Files:**
- (No repo changes — temporary secret manipulation)

- [ ] **Step 1: Break the Apps Script secret in the Worker**

```bash
cd worker
npx wrangler secret put APPS_SCRIPT_SECRET
```

Paste a known-bad value like `BROKEN_FOR_TEST`.

- [ ] **Step 2: Submit a registration**

Use a fresh phone/email (or the same one — the registration row will be created either way).

- [ ] **Step 3: Verify outcomes**

- The success page renders for the user (no error).
- The Supabase `registrations` table has the new row.
- **No** confirmation email arrives.
- `wrangler tail` shows a `[email] non-success body: {"error":"unauthorized"}` log line.

- [ ] **Step 4: Restore the real secret**

```bash
npx wrangler secret put APPS_SCRIPT_SECRET
```

Paste the real shared secret again.

- [ ] **Step 5: Submit one more registration to confirm normal operation resumed**

Email should arrive again.

---

## Self-review notes

- **Spec coverage:** All 7 spec sections (Goal, Architecture, Email content, Data flow, Code shape, Error handling, Secrets & setup) are addressed across Tasks 1–12.
- **No automated test framework added:** The existing Worker has none, and adding one for a single fire-and-forget call is YAGNI. Verification is `tsc --noEmit` + manual e2e + `wrangler tail`. Apps Script logic is verified via the in-editor runner (`testBuildEmailHtml`, `testSendEmailToSelf`).
- **WhatsApp number / Gmail address are real placeholders the user must fill in** — flagged at the top of the plan. Implementation should not proceed past "Inputs needed" without these values.
- **`.env.local` commit caveat in Task 1 step 5:** if it's gitignored, don't stage it; the dev environment still works locally and the prod value goes in Cloudflare Pages env vars.
- **Apps Script Web App returns redirects** — the Worker fetch uses `redirect: 'follow'` to handle this.
- **Email failure logs** appear as `[email] ...` in `wrangler tail` — searchable prefix.
