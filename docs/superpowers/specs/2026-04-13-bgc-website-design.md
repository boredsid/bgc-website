# Board Game Company Website — Design Spec

## Overview

Website for Board Game Company (BGC), a Bangalore-based board gaming community that hosts sessions at cafes and restaurants across the city. The site serves as the public face of the community — showcasing the game library, membership tiers, upcoming events, and handling event registration with UPI payments.

**Tagline:** Bringing people together over board games.
**Mission:** Our mission is to create a community that brings people together over board games.

## Tech Stack

- **Framework:** Astro (static site generator) with React islands for interactive components
- **Hosting:** Cloudflare Pages (static site) + Cloudflare Workers (API layer)
- **Database:** Supabase (PostgreSQL + Row Level Security)
- **Payments:** UPI deep links + QR codes (GPay, PhonePe, Paytm)
- **Deployment:** Auto-deploys from GitHub via Cloudflare Pages

## Architecture

**Approach: Fully Static + Client-Side Supabase**

- All pages are statically generated at build time by Astro
- Game library, events, and registration forms are React islands that fetch from Supabase directly in the browser using the anon key + RLS
- Cloudflare Worker handles sensitive operations: registration writes, phone lookups, membership checks
- The Worker holds the Supabase service role key; the browser only ever sees the anon key

**Data flow:**
- Public reads (games, events) → browser fetches from Supabase directly (anon key + RLS)
- Sensitive reads (user lookup, membership check) → browser calls Worker → Worker queries Supabase with service key
- Writes (registration) → browser calls Worker → Worker validates + writes to Supabase with service key

## Visual Direction

**Palette: Orange Energy**

| Token         | Color   | Usage                                  |
|---------------|---------|----------------------------------------|
| Background    | #FFF8F0 | Page backgrounds                       |
| Primary       | #F47B20 | Buttons, highlights, accents           |
| Secondary     | #1A1A1A | Secondary buttons, body text           |
| Accent        | #4A9B8E | Differentiation (tier cards, tags)     |
| Highlight     | #FFD166 | Badges, banners, subtle highlights     |
| White         | #FFFFFF | Card backgrounds, inputs               |

**Typography:**
- Headers: Space Grotesk (bold/700)
- Body: Inter (regular/400, medium/500)

**Vibe:** Playful but clean, warm, community-focused. Bold orange from the logo is the dominant brand color. Real community photos featured prominently.

**Logo:** Orange circle with black "BGC" lettering (bgc-logo.png in project root).

## Navigation (All Pages)

**Top nav bar:**
- Left: BGC logo + "Board Game Company"
- Center/right links: Home, Library, Guild Path, Calendar, Register
- CTA button: "Join Us" (links to Instagram)
- Mobile: hamburger menu

**Footer:**
- BGC logo + tagline
- Quick links to all pages
- Contact: Instagram (@boardgamecompany), WhatsApp (+91 9982200768), Email (hello@boardgamecompany.in)
- Associated events: REPLAY (replaycon.in), TTRPGcon (ttrpgcon.in)
- "Based in Bangalore"

## Pages

### 1. Landing Page (`/`)

**Hero Section:**
- Large heading: "Welcome to Board Game Company!" (Space Grotesk)
- Subtext: mission statement + "Currently hosting in Bangalore"
- Two CTAs: "Register for a Session" (orange) and "Follow Us" (black, links to Instagram)
- Photo collage on the right — grid of community photos at cafes

**Upcoming Event Banner:**
- Highlighted card showing the next upcoming event (fetched from Supabase)
- Displays: date, venue, price
- "Register" CTA linking to `/register?event=<event_id>`
- Hidden if no upcoming events

**What We Do Section:**
- 2-3 cards: "Board game sessions at cafes across Bangalore", "130+ games in our library", "Join our growing community"
- Simple icons or small photos

**Guild Path Teaser:**
- Brief intro to membership tiers
- "Track your progress and level up through the BGC ranks"
- "Explore Guild Path" CTA

**Associated Events:**
- Small section featuring REPLAY and TTRPGcon with links

### 2. Board Game Library (`/library`)

**Page Header:**
- Title: "Our Library"
- Subtitle: "Browse our collection of 130+ board games"

**Filter/Search Bar (sticky on scroll):**
- Text search by game name
- Player count filter (dropdown)
- Complexity filter: Light / Medium / Heavy
- Play time filter: Quick (<30 min) / Medium (30-60 min) / Long (60+ min)
- Clear all filters button

**Game Grid:**
- Responsive card grid (3-4 cols desktop, 2 tablet, 1 mobile)
- Each card: title, player count, play time, complexity badge (color-coded), rating
- "Owned By" and "Currently With" fields are internal only — not displayed

**Data:** React island fetches all games from Supabase on page load. Filtering is client-side (130 games is small enough).

### 3. Guild Path (`/guild-path`)

**Page Header:**
- Title: "Guild Path"
- Subtitle: "Our loyalty and membership plans"

**Tier Cards (3 cards, row on desktop, stacked on mobile):**

**Initiate** — Sage/green card
- ₹600 / 3 months
- Benefits: 20% off events, 10% off tag-alongs, early access, exclusive Guild Path events
- Note: "Free if you've attended 10+ events in the last year"

**Adventurer** — Orange card, "Recommended" badge
- ₹2,000 / 3 months
- Everything in Initiate + all events free, 1 free tag-along

**Guildmaster** — Black/dark card, "Best Value" badge
- ₹8,000 / 12 months
- Everything in Adventurer + 5 free tag-alongs, REPLAY convention passes

**Fine Print:** "All tiers applicable for a maximum ticket price of ₹1000 per event and are inclusive of cover charges"

**CTA:** "Interested? Get in touch" → WhatsApp link with prefilled message

**This page is fully static.** No Supabase fetch. Pricing/benefits hardcoded in Astro, updated by code change + redeploy.

### 4. Events Calendar (`/calendar`)

**Page Header:**
- Title: "Upcoming Events"
- Subtitle: "Find your next session"

**Event Cards (vertical list, chronological):**
Each card shows:
- Date (day, month, time — prominently displayed)
- Event name
- Venue (name + area)
- Price per person
- Spots remaining (capacity minus sum of `seats` across all registrations for this event), or "Sold Out" badge
- Short description
- "Register" button → `/register?event=<event_id>`

**States:**
- Spots available → orange "Register" button
- Sold out → greyed out "Sold Out" badge, no register button
- No upcoming events → "No upcoming events right now. Follow us on Instagram to stay updated!"

**Data:** React island fetches events from Supabase where date >= today, sorted chronologically.

### 5. Registration (`/register?event=<event_id>`)

**Event Header (top of page):**
- Event name, date, venue, price per person
- Spots remaining count

**Registration Form:**

*Phone-first flow:*
1. Phone number field is first
2. On entering phone, calls `POST /api/lookup-phone` (Worker)
3. If existing user → auto-fills name and email (editable)
4. If Guild Path member → shows discount banner and adjusts pricing

*Standard fields:*
- Phone (tel) — first field
- Name (text) — auto-filled if returning user
- Email (email) — auto-filled if returning user
- Number of seats (quantity selector, capped by remaining spots)

*Custom questions (dynamic, per event):*
- Rendered from the event's `custom_questions` JSON field
- Supported types:
  - **select** — dropdown from options (e.g., meal preference)
  - **radio** — choose one, with optional per-option capacity (e.g., game choice, max N players)
  - **text** — free-form short answer
  - **checkbox** — yes/no toggle
- Each question: label, type, options (if applicable), required flag, optional capacity per option

*Total bar:*
- Calculated: price x seats - Guild Path discount
- Updates live as quantity/discount changes

**Payment (UPI bottom sheet):**
- "Proceed to Pay" triggers form validation
- Bottom sheet slides up:
  - Payment amount
  - QR code (generated UPI deep link)
  - Direct pay buttons: GPay, PhonePe, Paytm
  - "I've completed the payment" confirmation button
- If total is ₹0 (free via membership) → skips payment, "Get my spot" button submits directly

**On submission:**
- Worker validates, writes registration to Supabase, upserts user record
- Confirmation screen with event details

**Edge cases:**
- Invalid/missing event ID → "Event not found" message
- Sold out → form disabled, "Sold Out" message
- Custom question option at capacity → greyed out with "(Full)" label

## Supabase Schema

### `users`
| Column              | Type        | Notes                     |
|---------------------|-------------|---------------------------|
| id                  | uuid        | PK                        |
| phone               | text        | unique index              |
| name                | text        |                           |
| email               | text        |                           |
| first_registered_at | timestamptz |                           |
| last_registered_at  | timestamptz |                           |

### `games`
| Column         | Type    | Notes                          |
|----------------|---------|--------------------------------|
| id             | uuid    | PK                             |
| title          | text    |                                |
| player_count   | text    | e.g., "2-4"                    |
| max_players    | int     |                                |
| avg_rating     | decimal |                                |
| weight         | decimal |                                |
| complexity     | text    | Light / Medium / Heavy         |
| play_time      | text    | e.g., "60-120"                 |
| max_play_time  | int     |                                |
| length         | text    | Quick / Medium / Long          |
| owned_by       | text    | internal only                  |
| currently_with | text    | internal only                  |

### `events`
| Column           | Type        | Notes                                    |
|------------------|-------------|------------------------------------------|
| id               | uuid        | PK                                       |
| name             | text        |                                          |
| description      | text        |                                          |
| date             | timestamptz |                                          |
| venue_name       | text        |                                          |
| venue_area       | text        |                                          |
| price            | int         | in rupees                                |
| capacity         | int         |                                          |
| custom_questions | jsonb       | array of question definitions            |
| is_published     | boolean     |                                          |
| created_at       | timestamptz |                                          |

### `guild_members`
| Column          | Type        | Notes                                |
|-----------------|-------------|--------------------------------------|
| id              | uuid        | PK                                   |
| name            | text        |                                      |
| phone           | text        | unique index                         |
| email           | text        |                                      |
| tier            | text        | initiate / adventurer / guildmaster  |
| starts_at       | date        |                                      |
| expires_at      | date        |                                      |
| events_attended | int         | for 10+ free Initiate eligibility    |
| created_at      | timestamptz |                                      |

### `registrations`
| Column           | Type        | Notes                          |
|------------------|-------------|--------------------------------|
| id               | uuid        | PK                             |
| event_id         | uuid        | FK → events                    |
| name             | text        |                                |
| phone            | text        |                                |
| email            | text        |                                |
| seats            | int         |                                |
| total_amount     | int         |                                |
| discount_applied | text        | null or tier name              |
| custom_answers   | jsonb       |                                |
| payment_status   | text        | pending / confirmed            |
| created_at       | timestamptz |                                |

### RLS Policies

| Table         | Public SELECT                    | Public INSERT/UPDATE/DELETE |
|---------------|----------------------------------|----------------------------|
| games         | Yes                              | No                         |
| events        | Yes (where is_published = true)  | No                         |
| users         | No                               | No (Worker only)           |
| guild_members | No                               | No (Worker only)           |
| registrations | No                               | No (Worker only)           |

### `custom_questions` JSON Format

```json
[
  {
    "id": "game_choice",
    "label": "Which game do you want to play?",
    "type": "radio",
    "required": true,
    "options": [
      { "value": "Brass Birmingham", "capacity": 4 },
      { "value": "Ark Nova", "capacity": 4 }
    ]
  },
  {
    "id": "meal_pref",
    "label": "Meal preference",
    "type": "select",
    "required": true,
    "options": [
      { "value": "Veg Thali" },
      { "value": "Non-Veg Thali" }
    ]
  }
]
```

## Cloudflare Worker API

All endpoints live under `/api/*` on the same domain. The Worker holds the Supabase service role key as an environment secret.

### `POST /api/lookup-phone`

Combined user + membership lookup.

**Input:** `{ phone: string }`

**Returns:**
```json
{
  "user": { "found": true, "name": "Rahul", "email": "rahul@example.com" },
  "membership": { "isMember": true, "tier": "adventurer", "discount": "free" }
}
```

Membership check verifies `expires_at >= today`.

### `POST /api/register`

**Input:**
```json
{
  "event_id": "uuid",
  "name": "string",
  "phone": "string",
  "email": "string",
  "seats": 1,
  "custom_answers": { "game_choice": "Brass Birmingham", "meal_pref": "Veg Thali" },
  "payment_status": "confirmed"
}
```

**Validates:**
- Event exists and is published
- Spots remaining >= requested seats
- Required custom questions answered
- Per-option capacity not exceeded
- Re-checks Guild Path membership server-side (recalculates total, doesn't trust client)

**Actions:**
- Writes to `registrations` table
- Upserts `users` table (creates if new phone, updates name/email/last_registered_at if existing)

**Returns:** `{ success: true, registration_id: "uuid" }` or error

### `GET /api/event-spots/:event_id`

**Returns:**
```json
{
  "capacity": 30,
  "registered": 18,
  "remaining": 12,
  "option_counts": {
    "game_choice": { "Brass Birmingham": 3, "Ark Nova": 2 }
  }
}
```

Returns current registration count per custom question option (for capacity-limited options).

## External Links & Contact

- Instagram: @boardgamecompany
- WhatsApp: +91 9982200768
- Email: hello@boardgamecompany.in
- REPLAY convention: replaycon.in
- TTRPGcon: ttrpgcon.in
- Location: Bangalore, India
