# Guild Path Purchase Flow — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a self-service guild membership purchase flow to the guild-path page with UPI payment, backed by a new `guild_path_members` table and worker endpoint.

**Architecture:** New Supabase table `guild_path_members` replaces `guild_members`. New worker endpoint `POST /api/guild-purchase` handles user upsert + purchase row insertion. New React island `GuildPurchase.tsx` on the guild-path page manages tier selection → form → PaymentSheet → success flow.

**Tech Stack:** Astro 5, React, Tailwind CSS 4, Supabase (PostgreSQL + RLS), Cloudflare Workers

---

## File Structure

| Action | File | Responsibility |
|--------|------|---------------|
| Create | `supabase/migrations/002_guild_path_members.sql` | Drop `guild_members`, create `guild_path_members` |
| Create | `worker/src/guild-purchase.ts` | Handler for `POST /api/guild-purchase` |
| Modify | `worker/src/index.ts` | Route `/api/guild-purchase` to new handler |
| Modify | `worker/src/register.ts:101-120` | Update discount lookup to use `guild_path_members` |
| Modify | `worker/src/lookup-phone.ts:15-27` | Update membership lookup to use `guild_path_members` |
| Create | `src/components/GuildPurchase.tsx` | React island: tier cards + form + payment + success |
| Modify | `src/pages/guild-path.astro` | Replace static content with `<GuildPurchase />` island |

---

### Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/002_guild_path_members.sql`

- [ ] **Step 1: Write the migration SQL**

Create `supabase/migrations/002_guild_path_members.sql`:

```sql
-- Drop the old guild_members table
drop table if exists guild_members;

-- Create the new guild_path_members table
create table guild_path_members (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references users(id),
  tier text not null check (tier in ('initiate', 'adventurer', 'guildmaster')),
  amount int not null,
  status text not null default 'pending' check (status in ('pending', 'paid')),
  starts_at date not null,
  expires_at date not null
);

create index guild_path_members_user_id_idx on guild_path_members (user_id);

alter table guild_path_members enable row level security;
-- No public access — Worker only
```

- [ ] **Step 2: Run the migration against Supabase**

Run via the Supabase dashboard SQL editor (or CLI if configured). Paste the contents of `002_guild_path_members.sql` and execute.

- [ ] **Step 3: Verify the table exists**

In the Supabase dashboard, confirm:
- `guild_members` table is gone
- `guild_path_members` table exists with columns: `id`, `user_id`, `tier`, `amount`, `status`, `starts_at`, `expires_at`
- RLS is enabled with no policies (worker-only access)

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/002_guild_path_members.sql
git commit -m "feat: add guild_path_members migration, drop guild_members"
```

---

### Task 2: Worker Endpoint — `POST /api/guild-purchase`

**Files:**
- Create: `worker/src/guild-purchase.ts`
- Modify: `worker/src/index.ts`

- [ ] **Step 1: Create the guild-purchase handler**

Create `worker/src/guild-purchase.ts`:

```typescript
import type { Env } from './index';
import { getSupabase } from './supabase';
import { sanitizePhone, sanitizeEmail, sanitizeName, jsonResponse } from './validation';

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

export async function handleGuildPurchase(request: Request, env: Env): Promise<Response> {
  const body = await request.json<{
    name: string;
    phone: string;
    email: string;
    tier: string;
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
      .insert({ phone, name, email })
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
    })
    .select('id')
    .single();

  if (purchaseError || !purchase) {
    return jsonResponse({ error: 'Purchase failed' }, 500);
  }

  return jsonResponse({ success: true, purchase_id: purchase.id });
}
```

- [ ] **Step 2: Wire up the route in `index.ts`**

In `worker/src/index.ts`, add the import at the top with the other imports:

```typescript
import { handleGuildPurchase } from './guild-purchase';
```

Add the route inside the `try` block, after the `event-spots` route and before the `else` 404:

```typescript
      } else if (url.pathname === '/api/guild-purchase' && request.method === 'POST') {
        response = await handleGuildPurchase(request, env);
      } else {
```

- [ ] **Step 3: Build the worker to check for type errors**

```bash
cd worker && npm run build
```

Expected: Build succeeds with no errors.

- [ ] **Step 4: Commit**

```bash
git add worker/src/guild-purchase.ts worker/src/index.ts
git commit -m "feat: add POST /api/guild-purchase worker endpoint"
```

---

### Task 3: Update Discount Lookups to Use `guild_path_members`

**Files:**
- Modify: `worker/src/register.ts:101-120`
- Modify: `worker/src/lookup-phone.ts:15-27`

- [ ] **Step 1: Update `register.ts` discount lookup**

In `worker/src/register.ts`, replace lines 101-120 (the guild membership check block):

```typescript
  // Check Guild Path membership and calculate total
  // First find user by phone, then check guild_path_members
  const { data: regUser } = await supabase
    .from('users')
    .select('id')
    .eq('phone', phone)
    .maybeSingle();

  let totalAmount = event.price * seats;
  let discountApplied: string | null = null;

  if (regUser) {
    const { data: member } = await supabase
      .from('guild_path_members')
      .select('tier, expires_at')
      .eq('user_id', regUser.id)
      .eq('status', 'paid')
      .gte('expires_at', new Date().toISOString().split('T')[0])
      .order('expires_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (member) {
      if (member.tier === 'adventurer' || member.tier === 'guildmaster') {
        totalAmount = 0;
        discountApplied = member.tier;
      } else if (member.tier === 'initiate') {
        totalAmount = Math.round(totalAmount * 0.8);
        discountApplied = 'initiate';
      }
    }
  }
```

- [ ] **Step 2: Update `lookup-phone.ts` membership lookup**

In `worker/src/lookup-phone.ts`, replace the `Promise.all` block (lines 15-27) with:

```typescript
  const userResult = await supabase
    .from('users')
    .select('id, name, email')
    .eq('phone', phone)
    .maybeSingle();

  const user = userResult.data;

  let member: { tier: string; expires_at: string } | null = null;

  if (user) {
    const memberResult = await supabase
      .from('guild_path_members')
      .select('tier, expires_at')
      .eq('user_id', user.id)
      .eq('status', 'paid')
      .gte('expires_at', new Date().toISOString().split('T')[0])
      .order('expires_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    member = memberResult.data;
  }
```

Also remove the old lines 29-30 (`const user = userResult.data;` and `const member = memberResult.data;`) since they're now handled inline above. The rest of the function (lines 32-53) stays the same — it already reads from `member` and `user`.

- [ ] **Step 3: Build the worker to check for type errors**

```bash
cd worker && npm run build
```

Expected: Build succeeds with no errors.

- [ ] **Step 4: Commit**

```bash
git add worker/src/register.ts worker/src/lookup-phone.ts
git commit -m "fix: update discount and membership lookups to use guild_path_members"
```

---

### Task 4: Create `GuildPurchase.tsx` React Component

**Files:**
- Create: `src/components/GuildPurchase.tsx`

- [ ] **Step 1: Create the component**

Create `src/components/GuildPurchase.tsx`:

```tsx
import { useState } from 'react';
import PaymentSheet from './PaymentSheet';

const WORKER_URL = import.meta.env.PUBLIC_WORKER_URL;

type Tier = {
  key: string;
  name: string;
  price: number;
  priceLabel: string;
  period: string;
  color: string;
  badge: string | null;
  benefits: string[];
  note: string | null;
};

const TIERS: Tier[] = [
  {
    key: 'initiate',
    name: 'Initiate',
    price: 600,
    priceLabel: '₹600',
    period: '3 months',
    color: 'bg-accent',
    badge: null,
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
    price: 2000,
    priceLabel: '₹2,000',
    period: '3 months',
    color: 'bg-primary',
    badge: 'Recommended',
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
    price: 8000,
    priceLabel: '₹8,000',
    period: '12 months',
    color: 'bg-secondary',
    badge: 'Best Value',
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

type Step = 'idle' | 'form' | 'payment' | 'submitting' | 'success';

export default function GuildPurchase() {
  const [step, setStep] = useState<Step>('idle');
  const [selectedTier, setSelectedTier] = useState<Tier | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function selectTier(tier: Tier) {
    setSelectedTier(tier);
    setStep('form');
    setError(null);
  }

  function handleChange() {
    setSelectedTier(null);
    setStep('idle');
    setError(null);
  }

  function handleFormSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setStep('payment');
  }

  async function handlePaymentConfirm() {
    if (!selectedTier) return;
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch(`${WORKER_URL}/api/guild-purchase`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          phone,
          email,
          tier: selectedTier.key,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Something went wrong');
        setStep('form');
        setSubmitting(false);
        return;
      }

      setStep('success');
    } catch {
      setError('Something went wrong. Please try again.');
      setStep('form');
    }
    setSubmitting(false);
  }

  // Success state
  if (step === 'success') {
    return (
      <div className="bg-white rounded-2xl border border-border p-8 text-center max-w-lg mx-auto">
        <div className="text-5xl mb-4">🎉</div>
        <h2 className="font-heading text-2xl font-bold mb-2">Thanks!</h2>
        <p className="text-muted">
          We'll confirm your membership shortly. You'll receive the benefits once your payment is verified.
        </p>
      </div>
    );
  }

  // Payment sheet
  if (step === 'payment' && selectedTier) {
    return (
      <PaymentSheet
        amount={selectedTier.price}
        payerName={name}
        onConfirm={handlePaymentConfirm}
        onClose={() => setStep('form')}
        submitting={submitting}
      />
    );
  }

  return (
    <>
      {/* Tier Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto">
        {TIERS.map((tier) => (
          <div
            key={tier.key}
            className={`${tier.color} text-white rounded-2xl p-6 flex flex-col relative`}
          >
            {tier.badge && (
              <span className="absolute top-4 right-4 bg-highlight text-secondary text-xs font-bold px-3 py-1 rounded-full">
                {tier.badge}
              </span>
            )}
            <h3 className="font-heading text-2xl font-bold mb-4">{tier.name}</h3>
            <p className="font-heading font-bold text-sm uppercase tracking-wide mb-3 opacity-80">
              Benefits
            </p>
            <ul className="flex-1 space-y-2 mb-6">
              {tier.benefits.map((benefit, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <span className="mt-0.5 opacity-60">•</span>
                  <span>{benefit}</span>
                </li>
              ))}
            </ul>
            {tier.note && (
              <div className="bg-white/20 rounded-lg px-3 py-2 text-xs mb-4">
                {tier.note}
              </div>
            )}
            <div className="border-t border-white/20 pt-4 mb-4">
              <span className="font-heading text-3xl font-bold">{tier.priceLabel}</span>
              <span className="text-sm opacity-70 ml-1">/ {tier.period}</span>
            </div>
            <button
              onClick={() => selectTier(tier)}
              className="w-full py-3 rounded-full border-2 border-white text-white font-heading font-semibold hover:bg-white/10 transition-colors"
            >
              Select Plan
            </button>
          </div>
        ))}
      </div>

      {/* Inline Form */}
      {step === 'form' && selectedTier && (
        <div className="max-w-md mx-auto mt-8">
          <div className="bg-[#FFF8F0] border border-primary rounded-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm text-muted">
                Selected plan:{' '}
                <strong className="text-secondary font-heading">{selectedTier.name}</strong>
              </p>
              <button
                onClick={handleChange}
                className="text-sm text-primary hover:underline"
              >
                Change
              </button>
            </div>

            <form onSubmit={handleFormSubmit} className="flex flex-col gap-3">
              <div>
                <label className="block text-sm text-muted mb-1">Name *</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your full name"
                  required
                  className="w-full px-4 py-2.5 rounded-xl border border-border bg-white text-sm focus:outline-none focus:border-primary"
                />
              </div>
              <div>
                <label className="block text-sm text-muted mb-1">Phone *</label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="10-digit mobile number"
                  required
                  className="w-full px-4 py-2.5 rounded-xl border border-border bg-white text-sm focus:outline-none focus:border-primary"
                />
              </div>
              <div>
                <label className="block text-sm text-muted mb-1">Email *</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="your@email.com"
                  required
                  className="w-full px-4 py-2.5 rounded-xl border border-border bg-white text-sm focus:outline-none focus:border-primary"
                />
              </div>

              {error && (
                <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
                  {error}
                </div>
              )}

              <button
                type="submit"
                className="w-full bg-primary text-white py-3 rounded-full font-heading font-semibold text-lg hover:bg-primary-dark transition-colors mt-1"
              >
                Pay {selectedTier.priceLabel}
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 2: Build the Astro site to check for errors**

```bash
npm run build
```

Expected: Build succeeds (the component isn't used yet, but should compile).

- [ ] **Step 3: Commit**

```bash
git add src/components/GuildPurchase.tsx
git commit -m "feat: add GuildPurchase React component with tier selection, form, and payment"
```

---

### Task 5: Update `guild-path.astro` to Use the React Island

**Files:**
- Modify: `src/pages/guild-path.astro`

- [ ] **Step 1: Replace the page content**

Replace the entire contents of `src/pages/guild-path.astro` with:

```astro
---
import Layout from '../layouts/Layout.astro';
import GuildPurchase from '../components/GuildPurchase.tsx';
---

<Layout title="Guild Path" description="Our loyalty and membership plans — level up your BGC experience">
  <section class="pt-24 pb-12 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
    <div class="text-center mb-10">
      <h1 class="font-heading text-4xl font-bold">Guild Path</h1>
      <p class="mt-2 text-muted text-lg">Our loyalty and membership plans</p>
    </div>

    <GuildPurchase client:load />

    <p class="text-center text-muted text-sm mt-8 max-w-2xl mx-auto">
      All tiers are applicable for a maximum ticket price of ₹1,000 per event and are inclusive of cover charges.
    </p>
  </section>
</Layout>
```

- [ ] **Step 2: Build the full site**

```bash
npm run build
```

Expected: Build succeeds, all 5 pages generated.

- [ ] **Step 3: Run the dev server and test the flow**

```bash
npm run dev
```

Open `http://localhost:4321/guild-path` and verify:
1. Three tier cards render with correct styling, benefits, and "Select Plan" buttons
2. Clicking "Select Plan" shows the inline form with the correct tier name
3. "Change" link returns to the card view
4. Form validates required fields
5. "Pay ₹{amount}" button shows the correct price for the selected tier
6. PaymentSheet opens with QR code and app buttons
7. "I've completed the payment" button triggers the submission (will need the worker running to fully test)

- [ ] **Step 4: Commit**

```bash
git add src/pages/guild-path.astro
git commit -m "feat: wire up GuildPurchase island on guild-path page"
```

---

### Task 6: Deploy and Verify End-to-End

- [ ] **Step 1: Deploy the worker**

```bash
cd worker && npx wrangler deploy
```

Expected: Worker deploys successfully.

- [ ] **Step 2: Run the Supabase migration**

If not already done in Task 1, run the migration SQL from `supabase/migrations/002_guild_path_members.sql` in the Supabase dashboard SQL editor.

- [ ] **Step 3: Push to GitHub for Cloudflare Pages deploy**

```bash
git push origin main
```

Expected: Cloudflare Pages auto-deploys.

- [ ] **Step 4: End-to-end test on production**

1. Visit the live guild-path page
2. Select a tier, fill in test details, proceed through payment
3. Check Supabase dashboard → `guild_path_members` table has a new row with status `pending`
4. Check `users` table has the corresponding user
5. Change `status` to `paid` in the dashboard
6. Register for an event with the same phone number → verify discount is applied

- [ ] **Step 5: Close the GitHub issue**

```bash
gh issue close 11 --comment "Resolved — guild path now has its own purchase and payment flow"
```
