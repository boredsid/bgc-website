# Homepage Redesign — Design Spec

**Date:** 2026-04-26
**Branch context:** `redesign/neo-brutalist`
**Scope:** `src/pages/index.astro` only (other pages already redesigned in prior commits)

## Why

The current homepage was the first page touched in the neo-brutalist redesign and has fallen behind the rest of the site. Specific problems the user identified:

- **Upcoming event banner is too quiet** — slim card sandwiched between hero and "What we do." For a community whose primary funnel is event registration, the next event should feel like a marquee, not a footnote.
- **"What we do" reads like a brochure** — three colored boxes with emoji + paragraph. Lacks the playful chaos that makes BGC fun.
- **Photo usage is wasted** — 6 community photos sit unused in `public/landing-photos/`; only one is used.
- **No social proof / scale** — strangers have no signal that BGC is established and active.
- **Mobile feels squished** — desktop-first hero collapses awkwardly on phones.
- **Guild Path teaser is buried** — single quiet card near the bottom.

Photos are also unshipped: 8–15MB PNGs each. Catastrophic on mobile.

## Audience and Goals

The homepage serves two audiences with roughly equal priority (approach **C** from the brainstorm):

- **First-time visitors** — strangers arriving from Instagram, word-of-mouth, or search. Need to (a) trust BGC is real and active, (b) understand what BGC does, (c) have a clear path to register for their first session.
- **Returning regulars** — already know BGC. Want to see what's on this week and act fast.

The hybrid layout gives both audiences value above the fold: vibe for the strangers (hero + photo band), event-of-the-week for the regulars (marquee directly below).

## Visual Direction

Keep the existing neo-brutalist system. The redesign uses it more confidently — bigger photos, more density, more variety in stripe colors. Tokens, fonts, and primitives (`card-brutal`, `pill-*`, `btn-*`) remain unchanged. No new design system work.

## Page Structure

Top-to-bottom on mobile (the canonical view). Desktop is the same column flow; sections widen but order is preserved.

### 1. Hero

- **Background:** charcoal `#1A1A1A` full-bleed.
- **Eyebrow tag:** `BANGALORE'S` — yellow `#FFD166`, uppercase, tight letterspacing, small.
- **Headline:** `Gaming Community.` — white, Space Grotesk weight 800, line-height 1.0, very tight letterspacing. Mobile clamp baseline: ~3rem; desktop: ~6rem.
- **Subline:** white at ~70% opacity, one sentence: `3,500+ players. <GameCount/>+ games. Sessions every weekend, all over Bangalore.` The `<GameCount>` React island is reused as-is.
- **CTAs:** two pills, side-by-side on desktop, stacked on mobile:
  - Primary orange: `Register for a session →` → `/register`
  - Outlined-on-dark (white border, transparent fill): `Join the WhatsApp` → existing WhatsApp invite URL
- **Vertical sizing:** target ~75% of mobile viewport height on first paint, padded so headline never touches edges.

### 2. Hero Photo Band

- Sits flush below the hero — no gap, no padding.
- Three photos edge-to-edge in a row.
- **Mobile:** horizontal scroll-snap strip; ~85% viewport width per photo, snaps to each as the user swipes. Shows ~1.1 photos at rest so a slice of the next one peeks in.
- **Desktop:** three photos side-by-side, equal width, fill the page width up to the brutalist max-width (`1200px` matching other pages).
- Each photo is in a tall portrait crop (~3:4), thin black border, no offset shadow (the band itself is the visual unit).
- 4px black bottom border anchors the band into the brutalist system.
- **Photos:** picked from `src/assets/landing/` after optimization (see Photo Pipeline). Preference for energetic action shots and group shots over static table-top shots.

### 3. Event Marquee

- Full-width band, yellow `#FFD166` background, 4px black top + bottom borders.
- This is the **redesign of the existing `<UpcomingEventBanner>` React island** — same data source (Supabase next event), heavy restyle.

**Content (when an upcoming event exists):**

- Eyebrow tag: `▸ {RELATIVE_DATE}` — black, uppercase, weight 700.
- Event name: Space Grotesk weight 700, ~2.5rem mobile / ~4rem desktop, tight letterspacing.
- Sub-line: `{venue_area} · {time} · ₹{price}`
- **Spots-left bar:** thin horizontal bar showing `seats_taken / total_seats`. Sits just below the sub-line.
  - Default: filled in black on a black-bordered track, with text `{remaining} of {total} spots left`.
  - When `remaining ≤ 3`: bar turns red, text reads `Almost full — {remaining} {seats|spot|spots} left`.
  - When `remaining === 0` (sold out): bar fills 100% red, text reads `Event full`.
- **Primary button:**
  - Default: black pill `Register →` → `/register?event={id}`
  - Sold out: black pill `Join waitlist →` → `/register?event={id}` (existing form already handles waitlist by virtue of the worker rejecting overbookings; UX detail can be confirmed during implementation)
- Ghost link below: `or see all upcoming →` → `/calendar`

**Relative date logic** (computed from `event.date` against `now()` in IST):
- Same calendar day → `TONIGHT` (if event time is later today) or fall through to actual date
- Tomorrow → `TOMORROW`
- 2–7 days out, weekend → `THIS SATURDAY`, `THIS SUNDAY` (as applicable)
- 2–7 days out, weekday → weekday name, e.g. `THIS THURSDAY`
- 8–14 days out → `NEXT {WEEKDAY}`
- >14 days out → formatted absolute date `{WEEKDAY} {DAY} {MON}` (e.g. `SAT 17 MAY`)

**Empty state (no upcoming published event):**
- Same yellow band, quieter copy:
  - Heading: `No public sessions on the calendar right now.`
  - Sub: `We post the next one in the WhatsApp group first — drop in.`
  - Button: black `Join the WhatsApp` (links to existing invite URL)
- No spots bar, no calendar link.

**Spots-left data** comes from the existing worker endpoint `GET /api/event-spots/:event_id`. The current `<UpcomingEventBanner>` does not call it; it will after this change.

### 4. Editorial Stripes — "What We Do"

Three full-width stripes, no gap between them, separated by 4px black borders. Each stripe is a 50/50 split of photo and copy. Photo side alternates: left, right, left. On mobile, all stripes stack as image-above-copy (image full width, copy below).

No brutalist offset shadows on the stripes themselves (already heavy enough). Each photo gets a thin black border.

**Stripe 1 — Sessions** — background `#FFD166` (yellow), photo on left
- Eyebrow: `01 / SESSIONS`
- Heading: `We host every weekend at cafes across Bangalore.`
- Body: `Indiranagar, Koramangala, HSR, Whitefield. Show up, sit down, learn a new game, meet new people. Beginners always welcome.`
- CTA link: `See the calendar →` → `/calendar`

**Stripe 2 — Library** — background `#4A9B8E` (teal), photo on right
- Eyebrow: `02 / LIBRARY`
- Heading: `<GameCount/>+ board games. From 10-minute fillers to 4-hour epics.`
- Body: `Catan, Scythe, Wingspan, Clocktower, D&D — plus party games, two-player wonders, and weird imports you've never heard of. Browse the full list.`
- CTA link: `Browse the library →` → `/library`

**Stripe 3 — Community** — background `#C3A6FF` (lavender), photo on left
- Eyebrow: `03 / COMMUNITY`
- Heading: `Not a class. Not a service. A community.`
- Body: `We're 3,500+ players in Bangalore who keep showing up because the people are the point. Drop into the WhatsApp group — say hi.`
- CTA link: `Join the WhatsApp →` → existing WhatsApp URL

**Photo assignment:** decided during implementation by visual fit. Suggested mapping:
- Stripe 1 → a cafe-table action shot
- Stripe 2 → a library / shelf / game-spread shot
- Stripe 3 → a group laughing / posed shot

**New component:** `src/components/EditorialStripe.astro` — props: `number`, `label`, `heading`, `body`, `ctaText`, `ctaHref`, `bgColor`, `photoSrc`, `photoSide` (`'left' | 'right'`).

### 5. Guild Path Teaser

- Full-width black band `#1A1A1A`. Hard contrast against the lavender stripe above.
- Eyebrow tag: `▸ FOR THE REGULARS` (yellow, uppercase, small).
- Heading: `Get on the Guild Path.` (white, large, Space Grotesk 800).
- Sub: `Join the ranks. Cheaper sessions, free events, exclusive perks. Three tiers.` (white at 70%).
- **Three tier pills** in a row (stack on mobile narrower than ~480px):
  - `Apprentice` — color matching the existing Apprentice tier on `/guild-path`
  - `Veteran` — color matching the existing Veteran tier
  - `Legend` — color matching the existing Legend tier
  - Each pill shows tier name + `From ₹X / yr` (price pulled from the same source `/guild-path` uses, so changes stay in sync; if no shared source exists, hardcode and add a TODO).
  - Tapping a pill jumps to `/guild-path#tier-{slug}` so the destination scrolls to that tier card.
- Big primary orange button: `See all tiers →` → `/guild-path`.

Personalization (e.g., greeting returning Guild members by name) is **out of scope** for this redesign. Flagged as a possible future enhancement.

### 6. Community CTA

- Full-width orange band `#F47B20`.
- One of the group photos sits behind the text at low opacity (~15%) and slight blur (`blur(2px)` or none — implementation can decide). Replaces the current opacity-15 emoji decorations, which go away.
- Massive heading, white, Space Grotesk 800: `Come play with us.`
- One short line, white at 80%: `WhatsApp is where the action happens. Instagram is where the photos do.`
- Two black pill buttons side-by-side (stack on mobile):
  - `WhatsApp Group` → existing invite URL
  - `@boardgamecompany on Instagram` → `https://instagram.com/boardgamecompany`
- Tiny line below in dark text (~70% black on orange): `Or just turn up to a session. We don't bite.`

### 7. Site Footer

Unchanged — existing `Footer.astro` continues to work as-is.

## Photo Pipeline

Six source photos currently live at `public/landing-photos/{1..6}.png` at 8–15MB each. They will be:

1. **Moved** to `src/assets/landing/` so Astro's `astro:assets` build pipeline picks them up. Filenames preserved (`1.png`–`6.png`), or renamed to descriptive slugs if helpful.
2. **Used via `<Image>` from `astro:assets`** in the homepage and component code, which auto-generates WebP variants and `srcset`.
3. **Width variants:** 400, 800, 1600. Quality ~78. Target final transferred size ~30–150KB depending on viewport.
4. **Loading strategy:**
   - Hero photo band (3 photos): `loading="eager"`, `fetchpriority="high"` for the first one only.
   - All other photos (editorial stripes, community CTA background): `loading="lazy"`.
5. **Original PNGs** in `public/landing-photos/` can be deleted after the move, or kept for now and removed in a cleanup pass.

If `astro:assets` is not already configured to output WebP, configuration is added in `astro.config.mjs` as part of this work.

## Component Inventory

| File | Action | Notes |
|------|--------|-------|
| `src/pages/index.astro` | Rewrite | All sections above |
| `src/components/UpcomingEventBanner.tsx` | Heavy restyle + new logic | Marquee styling, relative-date, spots-left bar, empty/sold-out states, calls `/api/event-spots/:id` |
| `src/components/HeroPhotoBand.astro` | New | Mobile scroll-snap photo strip / desktop 3-up |
| `src/components/EditorialStripe.astro` | New | Reusable stripe with photo+copy split |
| `src/assets/landing/` | New directory | Optimized photo sources |
| `astro.config.mjs` | Adjust if needed | Confirm `astro:assets` WebP output |

No new components are needed for the Guild Path teaser or Community CTA — those are inline in `index.astro` since they aren't reused elsewhere.

No new worker endpoints. Existing `/api/event-spots/:event_id` covers the spots-left data; `<GameCount>` and Supabase event reads are unchanged.

## Mobile-First Notes

The page is designed mobile-first throughout. Specific commitments:

- All sections are vertically stacked on mobile, no two-column layouts forced into single columns.
- Hero takes ~75% of viewport height — visitor lands on a confident statement, scrolls to find the marquee.
- Hero photo band uses scroll-snap on mobile so the 3 photos don't shrink to thumbnails.
- Editorial stripes stack image-above-copy, full-width image, no awkward letterboxing.
- Guild Path tier pills wrap or stack on narrow screens.
- All CTAs are full-width (or near-full-width) tap targets on mobile, ≥44pt tall.
- Total page weight on mobile target: <800KB initial paint, <2MB total (driven mostly by lazy-loaded photos).

## Out of Scope

The following are intentionally **not** part of this redesign and may be addressed in follow-up work:

- Personalization for returning Guild members (greet by name, show renewal status).
- Live Instagram follower count (Instagram API constraints; "3,500+" is hardcoded).
- A photo-wall / Polaroid section.
- Restructuring the site footer or nav.
- Other pages (already done).

## Open Questions

None at spec time. Implementation may surface small details (e.g., exact photo crops, exact spots-bar pixel design) — those are implementation decisions, not design ones.
