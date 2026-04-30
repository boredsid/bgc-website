# Guild Email + Payment Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send a confirmation email after Guild Path purchases (mirroring the event registration email) and replace the existing email's UPI deep-link button with a link to a new standalone payment page on the website.

**Architecture:** Apps Script `doPost` becomes a router dispatching on `payload.type` to either `buildEventEmailHtml` or a new `buildGuildEmailHtml`. Worker `email.ts` grows a second export `sendGuildPurchaseEmail`. Worker `guild-purchase.ts` mirrors `register.ts`'s `ctx.waitUntil(...)` pattern. New `src/pages/pay.astro` + `PaymentPage.tsx` + extracted `UpiPaymentBlock.tsx` (shared with `PaymentSheet.tsx`).

**Tech Stack:** Astro/React frontend, Cloudflare Worker (TypeScript), Google Apps Script (V8), Supabase (existing).

**Spec:** `docs/superpowers/specs/2026-05-01-guild-email-and-payment-page-design.md`

**Builds on:** Previous registration email plan (`docs/superpowers/plans/2026-05-01-registration-confirmation-email.md`) — assume that implementation is fully shipped.

---

## Inputs (resolved)

- **`BGC_SITE_URL`:** placeholder `"https://boardgaming.in"` (the user can confirm/change before deploy). The implementer should set this in `wrangler.toml` and treat it as authoritative.
- All other inputs (UPI ID, Apps Script URL/secret, WhatsApp number, alias) carry over from the previous feature.

## File map

**New files:**
- `src/pages/pay.astro` — minimal Astro page that mounts `PaymentPage`
- `src/components/PaymentPage.tsx` — full-page payment surface, reads URL params
- `src/components/UpiPaymentBlock.tsx` — extracted shared QR + UPI ID + deep-link grid

**Modified files:**
- `src/components/PaymentSheet.tsx` — replaces inline QR/UPI block with `<UpiPaymentBlock>`
- `worker/wrangler.toml` — adds `BGC_SITE_URL` var
- `worker/src/index.ts` — adds `BGC_SITE_URL` to `Env`, passes `ctx` to `handleGuildPurchase`
- `worker/src/email.ts` — renames existing exports, adds `sendGuildPurchaseEmail`
- `worker/src/register.ts` — uses renamed import, includes `payment_url` in payload
- `worker/src/guild-purchase.ts` — adds `ctx`, fires email after insert

**Manually edited (Apps Script web UI):**
- `Code.gs` — `doPost` becomes router, rename `buildEmailHtml` → `buildEventEmailHtml`, add `buildGuildEmailHtml`

---

## Task 1: Extract `UpiPaymentBlock` component

**Files:**
- Create: `src/components/UpiPaymentBlock.tsx`
- Modify: `src/components/PaymentSheet.tsx`

- [ ] **Step 1: Create `src/components/UpiPaymentBlock.tsx`**

```tsx
const UPI_ID = import.meta.env.PUBLIC_UPI_ID as string;
const RECIPIENT_NAME = 'Board Game Company';

function buildUpiUrl(scheme: string, path: string, amount: number, note: string): string {
  const pn = encodeURIComponent(RECIPIENT_NAME);
  const tn = encodeURIComponent(note);
  return `${scheme}://${path}pay?pa=${UPI_ID}&pn=${pn}&am=${amount}&cu=INR&tn=${tn}`;
}

interface Props {
  amount: number;
  note: string;
}

export default function UpiPaymentBlock({ amount, note }: Props) {
  const genericUpi = `upi://pay?pa=${UPI_ID}&pn=${encodeURIComponent(RECIPIENT_NAME)}&am=${amount}&cu=INR&tn=${encodeURIComponent(note)}`;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=360x360&data=${encodeURIComponent(genericUpi)}`;

  const gpayUrl = buildUpiUrl('tez', 'upi/', amount, note);
  const phonepeUrl = buildUpiUrl('phonepe', '', amount, note);
  const paytmUrl = `paytmmp://pay?pa=${UPI_ID}&pn=${encodeURIComponent(RECIPIENT_NAME)}&am=${amount}&cu=INR&tn=${encodeURIComponent(note)}`;

  return (
    <>
      <div className="text-center mb-6">
        <p className="label-brutal mb-3">Scan with any UPI app</p>
        <div
          className="inline-block"
          style={{
            padding: '12px',
            background: '#FFFFFF',
            border: '4px solid #1A1A1A',
            boxShadow: '6px 6px 0 #1A1A1A',
            borderRadius: '16px',
          }}
        >
          <img src={qrUrl} alt="UPI QR Code" className="w-48 h-48 block" />
        </div>
      </div>

      <div className="mb-6 text-center">
        <p className="label-brutal mb-2">UPI ID</p>
        <div className="pill pill-yellow" style={{ display: 'inline-block', fontSize: '0.9rem' }}>
          {UPI_ID}
        </div>
      </div>

      <div className="mb-6">
        <p className="label-brutal text-center mb-3">Or pay directly with</p>
        <div className="grid grid-cols-3 gap-3">
          <a
            href={gpayUrl}
            aria-label="Pay with Google Pay"
            className="flex items-center justify-center h-16 rounded-xl no-underline transition-transform hover:-translate-x-[2px] hover:-translate-y-[2px]"
            style={{ background: '#FFFFFF', border: '3px solid #1A1A1A', boxShadow: '4px 4px 0 #1A1A1A' }}
          >
            <img src="/payment-app-icons/gpay.png" alt="Google Pay" className="max-h-10 max-w-[80%] object-contain" />
          </a>
          <a
            href={phonepeUrl}
            aria-label="Pay with PhonePe"
            className="flex items-center justify-center h-16 rounded-xl no-underline transition-transform hover:-translate-x-[2px] hover:-translate-y-[2px]"
            style={{ background: '#FFFFFF', border: '3px solid #1A1A1A', boxShadow: '4px 4px 0 #1A1A1A' }}
          >
            <img src="/payment-app-icons/phonepe.png" alt="PhonePe" className="max-h-10 max-w-[80%] object-contain" />
          </a>
          <a
            href={paytmUrl}
            aria-label="Pay with Paytm"
            className="flex items-center justify-center h-16 rounded-xl no-underline transition-transform hover:-translate-x-[2px] hover:-translate-y-[2px]"
            style={{ background: '#FFFFFF', border: '3px solid #1A1A1A', boxShadow: '4px 4px 0 #1A1A1A' }}
          >
            <img src="/payment-app-icons/paytm.jpg" alt="Paytm" className="max-h-10 max-w-[80%] object-contain" />
          </a>
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 2: Replace inline block in `src/components/PaymentSheet.tsx`**

Replace the entire file with:

```tsx
import UpiPaymentBlock from './UpiPaymentBlock';

interface Props {
  amount: number;
  payerName: string;
  onConfirm: () => void;
  onClose: () => void;
  submitting: boolean;
}

const RECIPIENT_NAME = 'Board Game Company';

export default function PaymentSheet({ amount, payerName, onConfirm, onClose, submitting }: Props) {
  return (
    <div
      className="fixed inset-0 z-[3000] flex items-center justify-center p-6 animate-fade-in"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={onClose}
    >
      <div
        className="animate-modal relative rounded-2xl overflow-y-auto w-full max-w-md"
        style={{
          background: '#FFF8E7',
          border: '4px solid #1A1A1A',
          boxShadow: '12px 12px 0 #1A1A1A',
          maxHeight: '90vh',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-lg cursor-pointer font-bold z-10"
          style={{ background: '#FFFFFF', border: '2px solid #1A1A1A' }}
        >
          ✕
        </button>

        <div className="p-8">
          <div className="text-center mb-6">
            <span className="pill pill-black mb-3 inline-block">Complete Payment</span>
            <p className="font-heading font-bold text-4xl mt-2" style={{ color: '#F47B20', letterSpacing: '-1px' }}>
              ₹{amount}
            </p>
            <p className="text-sm text-[#1A1A1A]/70 mt-1">{RECIPIENT_NAME}</p>
          </div>

          <UpiPaymentBlock amount={amount} note={payerName} />

          <button
            onClick={onConfirm}
            disabled={submitting}
            className="btn btn-primary w-full disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? 'Submitting...' : "I've completed the payment"}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Type-check the frontend**

Run from project root:

```bash
npx astro check
```

Expected: no new type errors in PaymentSheet/UpiPaymentBlock. (Pre-existing errors in unrelated files are OK.)

- [ ] **Step 4: Commit**

```bash
git add src/components/UpiPaymentBlock.tsx src/components/PaymentSheet.tsx
git commit -m "refactor(payment): extract UpiPaymentBlock from PaymentSheet"
```

---

## Task 2: Create payment page

**Files:**
- Create: `src/pages/pay.astro`
- Create: `src/components/PaymentPage.tsx`

- [ ] **Step 1: Create `src/components/PaymentPage.tsx`**

```tsx
import { useEffect, useState } from 'react';
import UpiPaymentBlock from './UpiPaymentBlock';

const RECIPIENT_NAME = 'Board Game Company';

type Parsed =
  | { ok: true; amount: number; label: string }
  | { ok: false };

function parseParams(): Parsed {
  if (typeof window === 'undefined') return { ok: false };
  const params = new URLSearchParams(window.location.search);
  const amountRaw = params.get('amount');
  const label = params.get('for');
  if (!amountRaw || !label) return { ok: false };
  const amount = Number.parseInt(amountRaw, 10);
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false };
  return { ok: true, amount, label };
}

export default function PaymentPage() {
  const [parsed, setParsed] = useState<Parsed | null>(null);

  useEffect(() => {
    setParsed(parseParams());
  }, []);

  if (parsed === null) {
    return <div className="text-center py-12 text-[#1A1A1A]/60 font-heading">Loading...</div>;
  }

  if (!parsed.ok) {
    return (
      <div className="card-brutal p-8 text-center" style={{ background: '#FFE5E5' }}>
        <div className="text-5xl mb-4">⚠️</div>
        <h1 className="font-heading text-2xl font-bold mb-2">Invalid payment link</h1>
        <p className="text-[#1A1A1A]/70 mb-6">
          The link you followed is missing payment details. Please check the URL or contact us.
        </p>
        <a href="/" className="btn btn-black no-underline">
          Back home
        </a>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto">
      <div className="text-center mb-6">
        <span className="pill pill-black mb-3 inline-block">Complete Payment</span>
        <h1 className="font-heading font-bold text-2xl mt-2" style={{ letterSpacing: '-0.5px' }}>
          Pay for {parsed.label}
        </h1>
        <p className="font-heading font-bold text-5xl mt-3" style={{ color: '#F47B20', letterSpacing: '-1px' }}>
          ₹{parsed.amount}
        </p>
        <p className="text-sm text-[#1A1A1A]/70 mt-1">{RECIPIENT_NAME}</p>
      </div>

      <div
        className="rounded-2xl p-8"
        style={{
          background: '#FFF8E7',
          border: '4px solid #1A1A1A',
          boxShadow: '8px 8px 0 #1A1A1A',
        }}
      >
        <UpiPaymentBlock amount={parsed.amount} note={parsed.label} />
      </div>

      <div className="text-center mt-8">
        <a href="/" className="text-sm text-[#1A1A1A]/60 no-underline hover:underline">
          ← Done, back home
        </a>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create `src/pages/pay.astro`**

Look at an existing page first to follow the project's layout pattern. Read `src/pages/register.astro` to see how pages mount React islands and apply layout/Nav/Footer:

Run: `cat src/pages/register.astro` (use Read tool)

Then create `src/pages/pay.astro` mirroring that structure exactly (same imports, same Nav/Footer, same wrapping `<main>`/section), but replacing the `<RegistrationForm>` mount with:

```astro
<PaymentPage client:load />
```

The frontmatter import should be:

```astro
import PaymentPage from '../components/PaymentPage';
```

The page `<title>` should be: `Pay — BGC`

Keep all other layout/styling identical to `register.astro` so the page feels consistent with the rest of the site.

- [ ] **Step 3: Type-check**

```bash
npx astro check
```

Expected: no new errors.

- [ ] **Step 4: Manual smoke test (optional, quick if dev server available)**

Skip if dev server isn't readily available. Otherwise:

```bash
npm run dev
```

Open `http://localhost:4321/pay?amount=500&for=Test+Event` — confirm QR + UPI ID + buttons render.
Open `http://localhost:4321/pay` — confirm "Invalid payment link" error state.

- [ ] **Step 5: Commit**

```bash
git add src/pages/pay.astro src/components/PaymentPage.tsx
git commit -m "feat(pay): add standalone payment page"
```

---

## Task 3: Add `BGC_SITE_URL` and `ctx` plumbing in Worker `index.ts`

**Files:**
- Modify: `worker/wrangler.toml`
- Modify: `worker/src/index.ts`

- [ ] **Step 1: Add `BGC_SITE_URL` to `worker/wrangler.toml`**

Replace the `[vars]` block. The full file should now read:

```toml
name = "bgc-api"
main = "src/index.ts"
compatibility_date = "2025-04-01"

[vars]
SUPABASE_URL = "https://yhgtwqdsnrslcgdvmunz.supabase.co"
UPI_ID = "suranjanadatta24-1@okaxis"
BGC_SITE_URL = "https://boardgaming.in"

# Set secrets via: wrangler secret put SUPABASE_SERVICE_KEY
# Email secrets: wrangler secret put APPS_SCRIPT_URL / APPS_SCRIPT_SECRET
```

- [ ] **Step 2: Update `worker/src/index.ts`**

Replace the file contents with:

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
  BGC_SITE_URL: string;
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
        response = await handleGuildPurchase(request, env, ctx);
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

- [ ] **Step 3: Type-check Worker**

```bash
cd worker && npx tsc --noEmit
```

Expected: errors will appear because `handleGuildPurchase`'s signature doesn't yet take `ctx`. That's fixed in Task 6 — proceed.

- [ ] **Step 4: Commit**

```bash
git add worker/wrangler.toml worker/src/index.ts
git commit -m "feat(worker): add BGC_SITE_URL var and ctx plumbing for guild handler"
```

(Branch will be type-clean again after Task 6.)

---

## Task 4: Update `email.ts` — rename + add guild send

**Files:**
- Modify: `worker/src/email.ts`

- [ ] **Step 1: Replace the entire file**

Replace `worker/src/email.ts` with:

```ts
import type { Env } from './index';

export interface EventEmailPayload {
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
  payment_url: string;
}

export interface GuildPurchaseEmailPayload {
  to: string;
  name: string;
  tier_key: 'initiate' | 'adventurer' | 'guildmaster';
  tier_name: string;
  period_months: number;
  starts_at: string;
  expires_at: string;
  total_amount: number;
  upi: {
    id: string;
    payee_name: string;
  };
  payment_url: string;
}

async function postToAppsScript(
  body: Record<string, unknown>,
  env: Env
): Promise<void> {
  if (!env.APPS_SCRIPT_URL || !env.APPS_SCRIPT_SECRET) {
    console.error('[email] APPS_SCRIPT_URL or APPS_SCRIPT_SECRET not configured; skipping');
    return;
  }

  const res = await fetch(env.APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, secret: env.APPS_SCRIPT_SECRET }),
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

export async function sendEventRegistrationEmail(
  payload: EventEmailPayload,
  env: Env
): Promise<void> {
  await postToAppsScript({ type: 'event_registration', ...payload }, env);
}

export async function sendGuildPurchaseEmail(
  payload: GuildPurchaseEmailPayload,
  env: Env
): Promise<void> {
  await postToAppsScript({ type: 'guild_purchase', ...payload }, env);
}
```

- [ ] **Step 2: Type-check**

```bash
cd worker && npx tsc --noEmit
```

Expected: errors in `register.ts` (uses old `sendRegistrationEmail` name) and `guild-purchase.ts` (signature). Both fixed in Tasks 5 and 6 respectively. Proceed.

- [ ] **Step 3: Commit**

```bash
git add worker/src/email.ts
git commit -m "refactor(worker): rename to sendEventRegistrationEmail, add sendGuildPurchaseEmail"
```

---

## Task 5: Update `register.ts` — use renamed import + add `payment_url`

**Files:**
- Modify: `worker/src/register.ts`

- [ ] **Step 1: Update the import**

In `worker/src/register.ts`, replace:

```ts
import { sendRegistrationEmail } from './email';
```

with:

```ts
import { sendEventRegistrationEmail } from './email';
```

- [ ] **Step 2: Update the call site to add `payment_url`**

Find the existing block:

```ts
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
```

Replace with:

```ts
  const payment_url = env.BGC_SITE_URL
    ? `${env.BGC_SITE_URL}/pay?amount=${totalAmount}&for=${encodeURIComponent(event.name)}`
    : '';

  ctx.waitUntil(
    sendEventRegistrationEmail(
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
        payment_url,
      },
      env
    ).catch((err) => console.error('[email] send error', err))
  );
```

- [ ] **Step 3: Type-check**

```bash
cd worker && npx tsc --noEmit
```

Expected: only the existing pre-Task-6 error in `guild-purchase.ts` remains. Proceed.

- [ ] **Step 4: Commit**

```bash
git add worker/src/register.ts
git commit -m "feat(register): include payment_url in confirmation email"
```

---

## Task 6: Wire email send into `guild-purchase.ts`

**Files:**
- Modify: `worker/src/guild-purchase.ts`

- [ ] **Step 1: Replace the entire file**

Replace `worker/src/guild-purchase.ts` with:

```ts
import type { Env } from './index';
import { getSupabase } from './supabase';
import { sanitizePhone, sanitizeEmail, sanitizeName, sanitizeSource, jsonResponse } from './validation';
import { sendGuildPurchaseEmail } from './email';

const VALID_TIERS = ['initiate', 'adventurer', 'guildmaster'] as const;
type Tier = typeof VALID_TIERS[number];

const TIER_PRICES: Record<Tier, number> = {
  initiate: 600,
  adventurer: 2000,
  guildmaster: 8000,
};

const TIER_DURATION_MONTHS: Record<Tier, number> = {
  initiate: 3,
  adventurer: 3,
  guildmaster: 12,
};

const TIER_DISPLAY_NAME: Record<Tier, string> = {
  initiate: 'Initiate',
  adventurer: 'Adventurer',
  guildmaster: 'Guildmaster',
};

export async function handleGuildPurchase(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const body = await request.json<{
    name: string;
    phone: string;
    email: string;
    tier: string;
    source?: string;
  }>();

  // Validate inputs
  const phone = sanitizePhone(body.phone || '');
  if (!phone) return jsonResponse({ error: 'Invalid phone number' }, 400);

  const name = sanitizeName(body.name || '');
  if (!name) return jsonResponse({ error: 'Invalid name' }, 400);

  const email = sanitizeEmail(body.email || '');
  if (!email) return jsonResponse({ error: 'Invalid email' }, 400);

  if (!VALID_TIERS.includes(body.tier as Tier)) {
    return jsonResponse({ error: 'Invalid tier' }, 400);
  }

  const source = sanitizeSource(body.source);

  const tier = body.tier as Tier;
  const amount = TIER_PRICES[tier];

  const supabase = getSupabase(env);

  // Upsert user — find by phone, update or insert
  const { data: existingUser } = await supabase
    .from('users')
    .select('id')
    .eq('phone', phone)
    .maybeSingle();

  let userId: string;

  if (existingUser) {
    await supabase
      .from('users')
      .update({ name, email, last_registered_at: new Date().toISOString() })
      .eq('id', existingUser.id);
    userId = existingUser.id;
  } else {
    const { data: newUser, error: userError } = await supabase
      .from('users')
      .insert({ phone, name, email, source })
      .select('id')
      .single();

    if (userError || !newUser) {
      return jsonResponse({ error: 'Failed to create user' }, 500);
    }
    userId = newUser.id;
  }

  // Calculate dates
  const startsAt = new Date().toISOString().split('T')[0];
  const expiresDate = new Date();
  expiresDate.setMonth(expiresDate.getMonth() + TIER_DURATION_MONTHS[tier]);
  const expiresAt = expiresDate.toISOString().split('T')[0];

  // Insert guild_path_members row
  const { data: purchase, error: purchaseError } = await supabase
    .from('guild_path_members')
    .insert({
      user_id: userId,
      tier,
      amount,
      status: 'pending',
      starts_at: startsAt,
      expires_at: expiresAt,
      source,
    })
    .select('id')
    .single();

  if (purchaseError || !purchase) {
    return jsonResponse({ error: 'Purchase failed' }, 500);
  }

  // Send confirmation email (fire-and-forget)
  const tierName = TIER_DISPLAY_NAME[tier];
  const payment_url = env.BGC_SITE_URL
    ? `${env.BGC_SITE_URL}/pay?amount=${amount}&for=${encodeURIComponent(tierName + ' (Guild Path)')}`
    : '';

  ctx.waitUntil(
    sendGuildPurchaseEmail(
      {
        to: email,
        name,
        tier_key: tier,
        tier_name: tierName,
        period_months: TIER_DURATION_MONTHS[tier],
        starts_at: startsAt,
        expires_at: expiresAt,
        total_amount: amount,
        upi: {
          id: env.UPI_ID,
          payee_name: 'Board Game Company',
        },
        payment_url,
      },
      env
    ).catch((err) => console.error('[email] send error', err))
  );

  return jsonResponse({ success: true, purchase_id: purchase.id });
}
```

- [ ] **Step 2: Type-check**

```bash
cd worker && npx tsc --noEmit
```

Expected: no errors. The Worker is now fully type-clean.

- [ ] **Step 3: Commit**

```bash
git add worker/src/guild-purchase.ts
git commit -m "feat(guild-purchase): send confirmation email via Apps Script after insert"
```

---

## Task 7: Update Apps Script `Code.gs`

This task is performed in the Apps Script web UI by the human — it cannot be scripted by a subagent.

**Files:**
- Modify (in Apps Script): `Code.gs`

- [ ] **Step 1: Open the existing `BGC Registration Email` Apps Script project**

`script.google.com` → open `BGC Registration Email`. The existing `Code.gs` has functions: `doPost`, `jsonResponse`, `escapeHtml`, `buildEmailHtml`, `testBuildEmailHtml`, `testSendEmailToSelf`, plus the constants at the top.

- [ ] **Step 2: Rename `buildEmailHtml` to `buildEventEmailHtml`**

Use Apps Script editor's find-and-replace (Cmd-F → Find and replace) on the whole file:
- Find: `buildEmailHtml`
- Replace with: `buildEventEmailHtml`
- Replace all (should hit 4 occurrences: function definition, two usages in test functions, and one in `doPost`).

- [ ] **Step 3: Update the payment block inside `buildEventEmailHtml` to use `payment_url`**

Inside `buildEventEmailHtml`, find this block:

```js
  let paymentBlock = '';
  if (totalAmount > 0) {
    const upiUrl = 'tez://upi/pay?pa=' + encodeURIComponent(upi.id) +
      '&pn=' + encodeURIComponent(upi.payee_name) +
      '&am=' + totalAmount +
      '&cu=INR&tn=' + encodeURIComponent(event.name);
    paymentBlock =
      '<table style="width:100%;border-collapse:collapse;margin:24px 0;background:#FFF8F0;border:2px solid #1A1A1A;border-radius:8px;">' +
        '<tr><td style="padding:20px;">' +
          '<div style="font-size:13px;text-transform:uppercase;letter-spacing:1px;color:#999;margin-bottom:8px;">If you haven\'t paid yet</div>' +
          '<div style="font-family:monospace;font-size:15px;color:#1A1A1A;margin-bottom:4px;">UPI: ' + escapeHtml(upi.id) + '</div>' +
          '<div style="font-family:monospace;font-size:15px;color:#1A1A1A;margin-bottom:16px;">Amount: ₹' + totalAmount + '</div>' +
          '<a href="' + upiUrl + '" style="display:inline-block;background:#F47B20;color:#fff;text-decoration:none;padding:12px 24px;border-radius:6px;font-weight:bold;font-size:15px;">Pay ₹' + totalAmount + ' via Google Pay</a>' +
          '<div style="color:#999;font-size:13px;margin-top:12px;">Already paid? You can ignore this section.</div>' +
        '</td></tr>' +
      '</table>';
  }
```

Replace it with:

```js
  let paymentBlock = '';
  if (totalAmount > 0) {
    const buttonHtml = payload.payment_url
      ? '<a href="' + payload.payment_url + '" style="display:inline-block;background:#F47B20;color:#fff;text-decoration:none;padding:12px 24px;border-radius:6px;font-weight:bold;font-size:15px;">Complete payment</a>'
      : '';
    paymentBlock =
      '<table style="width:100%;border-collapse:collapse;margin:24px 0;background:#FFF8F0;border:2px solid #1A1A1A;border-radius:8px;">' +
        '<tr><td style="padding:20px;">' +
          '<div style="font-size:13px;text-transform:uppercase;letter-spacing:1px;color:#999;margin-bottom:8px;">If you haven\'t paid yet</div>' +
          '<div style="font-family:monospace;font-size:15px;color:#1A1A1A;margin-bottom:4px;">UPI: ' + escapeHtml(upi.id) + '</div>' +
          '<div style="font-family:monospace;font-size:15px;color:#1A1A1A;margin-bottom:16px;">Amount: ₹' + totalAmount + '</div>' +
          buttonHtml +
          (buttonHtml ? '<div style="color:#999;font-size:13px;margin-top:12px;">Already paid? You can ignore this section.</div>' : '') +
        '</td></tr>' +
      '</table>';
  }
```

- [ ] **Step 4: Add `buildGuildEmailHtml` function**

Append this function to `Code.gs` (above the test functions, below `buildEventEmailHtml`):

```js
function buildGuildEmailHtml(payload) {
  const name = payload.name;
  const tierName = payload.tier_name;
  const periodMonths = payload.period_months;
  const totalAmount = payload.total_amount;
  const upi = payload.upi;

  const expiresDate = new Date(payload.expires_at + 'T00:00:00+05:30');
  const expiresStr = Utilities.formatDate(expiresDate, 'Asia/Kolkata', 'd MMMM yyyy');
  const periodLabel = periodMonths + ' month' + (periodMonths === 1 ? '' : 's') + ' · valid until ' + expiresStr;

  const totalLine = '₹' + totalAmount;

  let paymentBlock = '';
  if (totalAmount > 0) {
    const buttonHtml = payload.payment_url
      ? '<a href="' + payload.payment_url + '" style="display:inline-block;background:#F47B20;color:#fff;text-decoration:none;padding:12px 24px;border-radius:6px;font-weight:bold;font-size:15px;">Complete payment</a>'
      : '';
    paymentBlock =
      '<table style="width:100%;border-collapse:collapse;margin:24px 0;background:#FFF8F0;border:2px solid #1A1A1A;border-radius:8px;">' +
        '<tr><td style="padding:20px;">' +
          '<div style="font-size:13px;text-transform:uppercase;letter-spacing:1px;color:#999;margin-bottom:8px;">If you haven\'t paid yet</div>' +
          '<div style="font-family:monospace;font-size:15px;color:#1A1A1A;margin-bottom:4px;">UPI: ' + escapeHtml(upi.id) + '</div>' +
          '<div style="font-family:monospace;font-size:15px;color:#1A1A1A;margin-bottom:16px;">Amount: ₹' + totalAmount + '</div>' +
          buttonHtml +
          (buttonHtml ? '<div style="color:#999;font-size:13px;margin-top:12px;">Already paid? You can ignore this section.</div>' : '') +
        '</td></tr>' +
      '</table>';
  }

  return '<!DOCTYPE html>' +
    '<html><head><meta charset="utf-8"><title>Welcome to the Guild</title></head>' +
    '<body style="margin:0;padding:0;background:#f5f5f5;font-family:Verdana,Geneva,sans-serif;color:#1A1A1A;">' +
      '<table style="width:100%;border-collapse:collapse;background:#f5f5f5;padding:24px 0;">' +
        '<tr><td align="center">' +
          '<table style="width:100%;max-width:600px;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden;">' +
            '<tr><td style="background:#F47B20;padding:20px 24px;">' +
              '<div style="color:#fff;font-family:Verdana,Geneva,sans-serif;font-weight:900;font-size:20px;letter-spacing:1px;">Board Game Company</div>' +
            '</td></tr>' +
            '<tr><td style="padding:32px 24px;">' +
              '<div style="font-family:Verdana,Geneva,sans-serif;font-weight:900;font-size:28px;line-height:1.2;color:#1A1A1A;margin-bottom:24px;">Welcome to the Guild, ' + escapeHtml(name) + '!</div>' +
              '<table style="width:100%;border-collapse:collapse;background:#FFF8F0;border:2px solid #1A1A1A;border-radius:8px;">' +
                '<tr><td style="padding:20px;">' +
                  '<div style="font-family:Verdana,Geneva,sans-serif;font-weight:900;font-size:20px;color:#1A1A1A;margin-bottom:8px;">' + escapeHtml(tierName) + '</div>' +
                  '<div style="color:#1A1A1A;font-size:15px;">' + periodLabel + '</div>' +
                '</td></tr>' +
              '</table>' +
              '<div style="font-family:Verdana,Geneva,sans-serif;font-weight:900;font-size:22px;color:#F47B20;margin:24px 0 0 0;">Total: ' + totalLine + '</div>' +
              paymentBlock +
              '<div style="color:#666;font-size:14px;margin-top:32px;border-top:1px solid #eee;padding-top:16px;">' +
                'Questions? Reply to this email or WhatsApp <a href="https://wa.me/' + WHATSAPP_NUMBER_DIGITS + '" style="color:#F47B20;">' + WHATSAPP_NUMBER_DISPLAY + '</a>.' +
              '</div>' +
              '<div style="color:#999;font-size:13px;margin-top:8px;">Board Game Company · Bangalore\'s tabletop gaming community</div>' +
            '</td></tr>' +
          '</table>' +
        '</td></tr>' +
      '</table>' +
    '</body></html>';
}
```

- [ ] **Step 5: Update `doPost` to dispatch by `payload.type`**

Replace the body of `doPost` with:

```js
function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);

    const expectedSecret = SCRIPT_PROPS.getProperty('SHARED_SECRET');
    if (!expectedSecret || payload.secret !== expectedSecret) {
      return jsonResponse({ error: 'unauthorized' });
    }

    const type = payload.type || 'event_registration';

    let html;
    let subject;

    if (type === 'guild_purchase') {
      if (!payload.to || !payload.tier_name) {
        return jsonResponse({ error: 'invalid payload' });
      }
      html = buildGuildEmailHtml(payload);
      subject = '[BGC] Welcome to the Guild — ' + payload.tier_name + '!';
    } else {
      if (!payload.to || !payload.event || !payload.event.name) {
        return jsonResponse({ error: 'invalid payload' });
      }
      html = buildEventEmailHtml(payload);
      subject = "[BGC] You're registered for " + payload.event.name + '!';
    }

    MailApp.sendEmail({
      to: payload.to,
      subject: subject,
      htmlBody: html,
      name: 'Board Game Company',
      from: FROM_ADDRESS,
    });

    return jsonResponse({ success: true });
  } catch (err) {
    return jsonResponse({ error: String(err) });
  }
}
```

- [ ] **Step 6: Add `testGuildEmailToSelf` test runner**

Append below `testSendEmailToSelf`:

```js
function testGuildEmailToSelf() {
  const me = Session.getActiveUser().getEmail();
  const payload = {
    to: me,
    name: 'Test User',
    tier_key: 'adventurer',
    tier_name: 'Adventurer',
    period_months: 3,
    starts_at: '2026-05-01',
    expires_at: '2026-08-01',
    total_amount: 2000,
    upi: { id: 'suranjanadatta24-1@okaxis', payee_name: 'Board Game Company' },
    payment_url: 'https://boardgaming.in/pay?amount=2000&for=Adventurer%20%28Guild%20Path%29',
  };
  const html = buildGuildEmailHtml(payload);
  MailApp.sendEmail({
    to: payload.to,
    subject: '[BGC] Welcome to the Guild — ' + payload.tier_name + '!',
    htmlBody: html,
    name: 'Board Game Company',
    from: FROM_ADDRESS,
  });
  Logger.log('Sent test guild email to ' + me);
}
```

- [ ] **Step 7: Save the project**

Cmd-S in the Apps Script editor.

- [ ] **Step 8: Run `testGuildEmailToSelf`**

Select `testGuildEmailToSelf` from the function dropdown → Run. Check inbox for an email titled `[BGC] Welcome to the Guild — Adventurer!`. Verify:
- Hero: "Welcome to the Guild, Test User!"
- Membership card: "Adventurer" + "3 months · valid until 1 August 2026"
- Total: ₹2000
- Payment block with "Complete payment" button linking to `https://boardgaming.in/pay?amount=2000&for=Adventurer%20%28Guild%20Path%29`
- Layout matches event email styling (orange band, footer, etc.)

If layout is broken, iterate on `buildGuildEmailHtml` and re-run.

- [ ] **Step 9: Sanity-check existing event email still renders**

Run `testSendEmailToSelf` (the existing test). Inbox should receive the event email as before. Verify:
- The "Pay ₹X via Google Pay" button is now replaced with "Complete payment" linking to a `boardgaming.in/pay?...` URL.
- Everything else (font, layout) unchanged.

---

## Task 8: Re-deploy Apps Script as new version

**Files:**
- (Apps Script web UI only — no repo changes)

- [ ] **Step 1: Re-deploy the Web App**

In Apps Script editor: Deploy → Manage deployments → click the existing deployment's edit (pencil) icon → Version: New version → click "Deploy".

The `/exec` URL stays the same — Worker secrets do NOT need updating.

- [ ] **Step 2: Smoke-test the new deployment with curl**

From a local terminal (replace `<URL>` and `<SECRET>` with real values; `<URL>` should be the same `/exec` URL you've used before):

```bash
curl -L -X POST '<URL>' \
  -H 'Content-Type: application/json' \
  -d '{
    "secret": "<SECRET>",
    "type": "guild_purchase",
    "to": "<your-test-email>",
    "name": "Curl Test",
    "tier_key": "initiate",
    "tier_name": "Initiate",
    "period_months": 3,
    "starts_at": "2026-05-01",
    "expires_at": "2026-08-01",
    "total_amount": 600,
    "upi": { "id": "suranjanadatta24-1@okaxis", "payee_name": "Board Game Company" },
    "payment_url": "https://boardgaming.in/pay?amount=600&for=Initiate%20%28Guild%20Path%29"
  }'
```

Expected: `{"success":true}` and an email arrives.

- [ ] **Step 3: Negative test — old payload still works**

```bash
curl -L -X POST '<URL>' \
  -H 'Content-Type: application/json' \
  -d '{
    "secret": "<SECRET>",
    "to": "<your-test-email>",
    "name": "Backcompat Test",
    "event": {
      "name": "Test Event",
      "date": "2026-05-17T19:00:00+05:30",
      "venue_name": "The Den",
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

(No `type` field, no `payment_url`.) Expected: `{"success":true}` and an event email arrives. Payment block should render WITHOUT the "Complete payment" button (button hidden when `payment_url` missing).

---

## Task 9: Push frontend to GitHub (CF Pages auto-deploys)

**Files:**
- (No repo changes — git push only)

- [ ] **Step 1: Push commits**

```bash
git push
```

This triggers a Cloudflare Pages rebuild that publishes the new `/pay` page along with the refactored `PaymentSheet`/`UpiPaymentBlock`.

- [ ] **Step 2: Wait for the Pages deploy to complete**

Watch the Cloudflare dashboard's Pages → Deployments tab until status is "Success" (typically 1–2 minutes).

- [ ] **Step 3: Smoke-test the live `/pay` page**

Open `https://<your-live-site>/pay?amount=500&for=Test+Event` — confirm QR + UPI ID + deep-link buttons render, page title says "Pay for Test Event".

Open `https://<your-live-site>/pay` — confirm "Invalid payment link" error state.

---

## Task 10: Deploy Worker

**Files:**
- (No repo changes — wrangler deploy only)

- [ ] **Step 1: Confirm `BGC_SITE_URL` is correct in `wrangler.toml`**

If your live site is on a different domain than `https://boardgaming.in`, edit `worker/wrangler.toml` to set the correct value, commit, and push before deploying.

- [ ] **Step 2: Deploy Worker**

```bash
cd worker
npx wrangler deploy
```

Expected: deploy succeeds, URL printed (`bgc-api.boredsid.workers.dev`).

- [ ] **Step 3: Tail logs in another terminal**

```bash
cd worker && npx wrangler tail
```

Leave running for Tasks 11 and 12.

---

## Task 11: End-to-end test — guild purchase

**Files:**
- (No repo changes — manual verification)

- [ ] **Step 1: Make a guild purchase on the live site**

1. Open `https://<your-live-site>/guild-path`.
2. Pick the **Initiate** tier (cheapest, ₹600).
3. Fill the form with a phone you control + an email you can check.
4. Click "Pay ₹600" → on PaymentSheet, click "I've completed the payment" (no need to actually pay).
5. Wait for the success modal.

- [ ] **Step 2: Verify the email**

Email should arrive within ~5 seconds. Check:
- Subject: `[BGC] Welcome to the Guild — Initiate!`
- From: `Board Game Company <hello@boardgamecompany.in>`
- Hero: "Welcome to the Guild, [your name]!"
- Membership card: "Initiate" + "3 months · valid until [3 months from today]"
- Total: ₹600
- Payment block: "Complete payment" button linking to `<BGC_SITE_URL>/pay?amount=600&for=Initiate%20%28Guild%20Path%29`
- Click the button on a desktop or mobile — should land on the live `/pay` page showing ₹600 + "Pay for Initiate (Guild Path)" + working QR/buttons.

- [ ] **Step 3: Check `wrangler tail`**

Confirm no `[email]` error lines appeared after the `POST /api/guild-purchase` request.

---

## Task 12: End-to-end test — event email button

**Files:**
- (No repo changes — manual verification)

- [ ] **Step 1: Submit a real event registration**

Open `https://<your-live-site>/register?event=<a-published-paid-event-id>`, fill the form, complete the flow as before.

- [ ] **Step 2: Verify the email**

The newly-arrived event email should now have:
- Same content as before EXCEPT:
- Payment block: "Complete payment" button (instead of "Pay ₹X via Google Pay")
- Button URL points to `<BGC_SITE_URL>/pay?amount=<X>&for=<Event+Name>`

- [ ] **Step 3: Click the button**

Should land on the live `/pay` page with correct amount + label. QR code should be valid (scans to UPI app with right amount).

---

## Self-review notes

- **Spec coverage:**
  - Payment page (URL params, validation, `<UpiPaymentBlock>` extraction): Tasks 1, 2, 9 (deploy)
  - Apps Script router + new builder + rename: Task 7
  - Worker email.ts rename + add: Task 4
  - Worker `register.ts` payment_url + renamed import: Task 5
  - Worker `guild-purchase.ts` ctx + email send: Task 6
  - Worker `index.ts` ctx wiring + Env field: Task 3
  - `BGC_SITE_URL` var: Task 3 (`wrangler.toml`)
  - Backwards-compat (old payloads, missing `payment_url`): Task 7 step 3 (button hidden when missing) + Task 8 step 3 (curl test verifies)
  - Deployment order: Tasks 7 → 8 → 9 → 10 (Apps Script → frontend → Worker)
  - End-to-end + e2e for old flow: Tasks 11, 12
- **Type consistency:** `EventEmailPayload`, `GuildPurchaseEmailPayload`, `sendEventRegistrationEmail`, `sendGuildPurchaseEmail` all match between Worker code (Tasks 4, 5, 6) and Apps Script payload shape (Task 7).
- **Worker pre-Task-6 type errors:** Tasks 3, 4, 5 each leave the Worker temporarily un-type-clean. Each task notes this. Task 6 closes the loop.
- **Apps Script UI tasks (7, 8) cannot be subagent-dispatched** — the user runs them. The implementer subagents handle Tasks 1–6.
- **No retry logic, no DB write from `/pay`, no analytics** — all confirmed YAGNI per spec.
