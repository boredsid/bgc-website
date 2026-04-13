# Guild Path Purchase Flow

**Date:** 2026-04-14
**Issue:** #11 — Update the guild path page to have its own purchase and payment flow

## Overview

Add a self-service purchase flow to the guild-path page so users can select a membership tier, enter their details, pay via UPI, and submit a purchase request. The site owner confirms payment manually by changing the row's `status` from `pending` to `paid` in Supabase.

## User Flow

1. User visits `/guild-path` and sees the three tier cards (Initiate, Adventurer, Guildmaster), each with a "Select Plan" button.
2. Clicking "Select Plan" reveals an inline form below the cards showing: selected plan name, a "Change" link, and fields for name, phone, email. The submit button reads "Pay ₹{amount}".
3. Submitting the form opens the existing `PaymentSheet` component (QR code + GPay/PhonePe/Paytm deep links).
4. Clicking "I've completed the payment" calls the worker endpoint, which inserts the purchase row.
5. A success message is shown: "Thanks! We'll confirm your membership shortly."

## Database

### New table: `guild_path_members`

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | uuid | PK, auto-generated | |
| `user_id` | uuid | FK → users.id, NOT NULL | |
| `tier` | text | NOT NULL, check in ('initiate','adventurer','guildmaster') | |
| `amount` | int | NOT NULL | Price in rupees |
| `status` | text | NOT NULL, default 'pending', check in ('pending','paid') | Owner flips to 'paid' manually |
| `starts_at` | date | NOT NULL | Set to today at purchase time |
| `expires_at` | date | NOT NULL | starts_at + 3 months (initiate/adventurer) or + 12 months (guildmaster) |

- RLS enabled, no public access (worker only).
- No unique constraint on `user_id` — allows repeat purchases over time.

### Drop table: `guild_members`

The existing `guild_members` table is replaced by `guild_path_members`.

### Migration

- Drop `guild_members`.
- Create `guild_path_members` with the schema above.

## Worker API

### New endpoint: `POST /api/guild-purchase`

**Request body:**
```json
{
  "name": "string",
  "phone": "string",
  "email": "string",
  "tier": "initiate" | "adventurer" | "guildmaster"
}
```

**Logic:**
1. Validate name, phone, email using existing sanitization helpers from `validation.ts`.
2. Validate tier is one of the three valid values.
3. Look up price from a hardcoded map: `{ initiate: 600, adventurer: 2000, guildmaster: 8000 }`.
4. Look up user by phone:
   - Exists → use their `id`, update name and email.
   - Doesn't exist → insert into `users`, get the new `id`.
5. Calculate `starts_at` (today) and `expires_at` (today + 3 months for initiate/adventurer, today + 12 months for guildmaster).
6. Insert into `guild_path_members` with `user_id`, `tier`, `amount`, `status: 'pending'`, `starts_at`, `expires_at`.
7. Return `{ success: true, purchase_id: <id> }`.

**Error responses:** 400 for validation errors, 500 for insert failures.

### Update: `POST /api/register`

Update the discount lookup in `register.ts` to query `guild_path_members` instead of `guild_members`:
- Query where `phone` matches (join through `users` table), `status = 'paid'`, and `expires_at >= today`.
- Discount logic remains the same (adventurer/guildmaster → 100% off, initiate → 20% off).

## Frontend

### New component: `GuildPurchase.tsx`

A React island that replaces the static tier cards and "Interested?" CTA on the guild-path page.

**State machine:**
- `idle` → showing tier cards with "Select Plan" buttons
- `form` → tier selected, showing inline form with name/phone/email + "Pay ₹{amount}" button
- `payment` → PaymentSheet open
- `submitting` → calling worker endpoint
- `success` → showing confirmation message

**Tier card changes:**
- Each card gets a "Select Plan" button at the bottom (white outline on the colored background).
- Tier names use the `font-heading` class (Space Grotesk).

**Inline form:**
- Appears below the tier cards grid, replacing the "Interested? Get in touch" CTA.
- Shows selected plan name with a "Change" link (returns to `idle` state).
- Three fields: name, phone, email (all required).
- Submit button: "Pay ₹{amount}" in primary orange.
- On submit → opens PaymentSheet with the tier's amount.

**PaymentSheet integration:**
- Reuses the existing `PaymentSheet` component.
- `payerName` = the name entered in the form.
- `amount` = tier price.
- `onConfirm` → calls `POST /api/guild-purchase` via the worker URL, then transitions to `success`.

**Success state:**
- Replaces the form with a confirmation message: "Thanks! We'll confirm your membership shortly."

### Update: `guild-path.astro`

- Remove the static tier cards and "Interested?" CTA.
- Import and render `<GuildPurchase client:load />`.
- The tier data (names, prices, benefits, badges, notes, colors) moves into the React component.
- Keep the disclaimer text ("All tiers are applicable for a maximum ticket price...") as static Astro content below the component.

## Design

- Tier card styling matches the existing design (accent/primary/secondary backgrounds, white text, rounded-2xl).
- Tier names use Space Grotesk (`font-heading`).
- Inline form uses a warm background (`bg-[#FFF8F0]`) with a primary-colored border.
- "Pay ₹{amount}" button uses the primary orange, full-width, rounded-full.
- "Change" link is primary-colored underlined text.
