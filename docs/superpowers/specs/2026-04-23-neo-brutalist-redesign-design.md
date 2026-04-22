# Neo-Brutalist Redesign — Design Spec

**Date:** 2026-04-23
**Reference:** https://bgc.naveenb.com/
**Scope:** Visual redesign of all 5 pages (home, library, guild-path, calendar, register). No schema, endpoint, or data-flow changes.

## Goal

Replace the current clean orange design with a neo-brutalist / new-memphis aesthetic inspired by the reference site: chunky black borders, offset block shadows, playful multi-color cards, pill badges, and emoji accents. Keep BGC's existing content structure, unique features, and brand orange.

## Decisions

- **Fidelity:** Near-clone of the reference's visual language, adapted to BGC's content and features.
- **Primary accent:** BGC orange `#F47B20` (replaces the reference's yellow as primary, because our logo is orange). Reference's yellow `#FFD166` is used as a secondary highlight only.
- **Home "What We Do":** Keep the existing 3-card structure (Offline Gaming / Games Library / Growing Community), not a 6-card sessions grid. Each card gets a different accent color in the reference style.

## Design System

### Color Tokens (CSS variables in `src/styles/global.css`)

```
--primary:     #F47B20  (orange — buttons, links, primary accents)
--pink:        #FF6B6B
--blue:        #4ECDC4  (teal)
--green:       #A8E6CF
--purple:      #C3A6FF
--highlight:   #FFD166  (yellow — secondary accent, used sparingly)
--cream:       #FFF8E7  (default page bg)
--cream-dark:  #FAFAF5  (alternating section bg)
--black:       #1A1A1A
--white:       #FFFFFF
```

### Brutalist Primitives

- **Borders:** `--border: 3px solid var(--black)`, `--border-thick: 4px solid var(--black)`
- **Offset shadows** (no blur, solid black):
  - `--shadow-sm: 4px 4px 0 var(--black)`
  - `--shadow-md: 6px 6px 0 var(--black)`
  - `--shadow-lg: 8px 8px 0 var(--black)`
  - `--shadow-xl: 12px 12px 0 var(--black)`
- **Radii:** 8 / 12 / 16 / 20 px (`--radius-sm` → `--radius-xl`)
- **Interactive pattern:**
  - Hover: `transform: translate(-2px, -2px)` + upgraded shadow size
  - Active: `transform: translate(2px, 2px)` + no shadow (press effect)
- **Fonts:** Unchanged — Space Grotesk (headings), Inter (body).

### Reusable Component Classes

Added to `src/styles/global.css` so pages compose instead of repeating utilities:

- `.btn-primary` — orange bg, black text, thick border, offset shadow
- `.btn-secondary` — white bg, black text, thick border, offset shadow (→ pink on hover)
- `.btn-black` — black bg, white text (used for CTAs on colored cards)
- `.btn-nav` — smaller button variant for navbar
- `.card-brutal` — thick border + offset shadow + hover-translate pattern
- `.pill` / `.pill-black` / `.pill-accent` — badge / pill styles
- `.section-tag` — small uppercase pill above section titles
- `.input-brutal` — bordered input, offset shadow grows on focus

### Reveal Animation

Add a `.reveal` class + a small IntersectionObserver snippet in `Layout.astro` — sections fade in + translate up as they enter viewport. Nice-to-have.

## Navigation & Layout

### Navbar (`src/components/Nav.astro`)

- Fixed top, full width, 72px tall
- Cream background (`#FFF8E7`) with `3px solid black` bottom border
- Left: BGC logo (40px circle) + "Board Game Company" wordmark in Space Grotesk
- Desktop right: nav links with orange underline animating in on hover/active, and a primary CTA ("Register")
- On scroll: adds a soft `0 4px 20px rgba(0,0,0,0.1)` shadow beneath
- Mobile: shows hamburger toggle (hamburger animates to X when open)

### Mobile Menu (`src/components/MobileMenu.tsx`)

- Full-screen slide-in from right, cream bg
- Header mirrors navbar: 72px tall, black bottom border, close button on the right
- Large pill-friendly link rows; hover/active fill with `--cream-dark`
- Backdrop overlay: 60% black, fades in
- Primary CTA at the bottom of the link list

### Footer (`src/components/Footer.astro`)

- Black bg, white text, orange accents for section headings and link hover state
- 3-column grid: brand/tagline, link columns, collab callout
- Collab callout: left orange border, subtle white-alpha bg, for TTRPGcon / REPLAY mentions
- Collapses to 1 column below 768px
- Bottom copyright strip, muted, top border

### Layout Wrapper (`src/layouts/Layout.astro`)

- Sets cream background on `body`
- Pages add `margin-top: 72px` to clear the fixed nav
- Includes the reveal-on-scroll snippet

## Home Page (`src/pages/index.astro`)

**Section order:** Hero → Upcoming Event Banner → What Does BGC Do? → Guild Path Teaser → Community CTA → Footer.

### Hero

- Two-column grid (stacks on mobile, text centered)
- Left:
  - Orange "WELCOME 🎲" pill badge
  - Headline "Welcome to Board Game Company!" — "Board Game Company" in orange, wraps to its own line
  - Muted subtitle ("Our mission is to create a community that brings people together over board games...")
  - Two buttons: primary orange "Register for a Session", secondary white "Join The Community"
- Right: single hero photo (pick strongest from `/public/landing-photos/*.png`), 4/3 aspect, thick black border, 20px radius, `lg` offset shadow
- Both columns fade-in on load (`fadeInUp`)

### Upcoming Event Banner (`src/components/UpcomingEventBanner.tsx`)

- Below hero. Restyle inline:
  - White bg, thick black border, `md` offset shadow
  - Orange left edge (12px) separating date from event details
  - Event date as a big black pill
  - "View Details" orange arrow link on the right
- No logic changes — still reads the next published event from Supabase

### What Does BGC Do?

- Centered "WHAT WE DO" section tag pill, "What Does BGC Do?" section title
- 3-card grid (1 column on mobile):
  - **Card 1** — yellow highlight `#FFD166`: 🎲 Offline Gaming
  - **Card 2** — teal `#4ECDC4`: 📚 `<GameCount />` Games
  - **Card 3** — green `#A8E6CF`: 🤝 Growing Community
- Each card: `card-brutal` pattern, emoji at 2.5rem, bold heading, body text

### Guild Path Teaser

- Purple `#C3A6FF` card, full-width, thick border, `lg` offset shadow
- Left: "Guild Path" heading + short tagline
- Right: black "Explore Guild Path" button with offset shadow
- Decorative emoji (🎲 🎯 ♠ ♟) absolutely positioned in corners at 15% opacity, rotated — matches reference's `community-deco` pattern

### Community CTA

- Large orange `#F47B20` card, very chunky padding (80px / 60px), thick border, `lg` offset shadow
- Decorative emoji in all 4 corners at 15% opacity, rotated
- Centered "Join Our Community" headline + short text
- WhatsApp + Instagram buttons: black bg, white text, thick border
  - WhatsApp hover: fills WhatsApp green `#25D366`
  - Instagram hover: fills Instagram magenta `#E1306C`

## Library Page (`src/pages/library.astro` + `src/components/GameLibrary.tsx`)

### Header

- "GAMES LIBRARY" section tag pill
- "Our Library" title
- Muted subtitle
- Yellow `library-stats` pill below showing "🎲 N games" (uses `GameCount` logic)

### Controls

- Search input: white, 3px black border, `sm` offset shadow, grows to `md` on focus
- Filter chips: small pill buttons, 2px black border. Active = black fill, white text
- Grouped by complexity / player count / duration using a `library-filter-bar` container (collapsible behind a toggle on mobile)
- Sort dropdown on the right: white, bordered, Space Grotesk
- "Clear filters" link in pink, only shown when filters are active

### Grid

- Responsive: `repeat(auto-fill, minmax(280px, 1fr))`. On mobile: 2 columns. On very narrow screens: 2 columns with compact cards (hides description).
- **Card:** white bg, 4px black border, 16px radius, `sm` offset shadow
  - Header strip 100px tall, bg tinted by complexity (green / yellow / pink), game's first letter as a 3.5rem watermark at 20% opacity
  - Top-left pill: rating (if available) — black bg white text
  - Top-right pill: complexity label (Light / Medium / Heavy)
  - Body: game name (Space Grotesk bold), short description, meta tags at bottom (player count, duration) as small cream-bg pills
  - Hover: `translate(-3px, -3px)`, shadow `lg`

### Game Modal

- Overlay: 50% black, fade-in
- Modal: white, 4px border, `xl` shadow, slide-up animation, max-width 480px, max-height 85vh
- Close button top-right: cream bg, 2px border, turns yellow on hover
- Header strip tinted by complexity, with the letter watermark
- Body:
  - Title (Space Grotesk 1.5rem)
  - Badges row: rating + complexity
  - Full description
  - Detail grid: responsive `auto-fit minmax(120px, 1fr)` — Players / Duration / Complexity / Designer / BGG Link / etc. Each detail is a cream-bg card with 2px border, uppercase label + bold value
- **Only expose non-internal fields** — per CLAUDE.md, `owned_by` and `currently_with` are internal and must never appear in the frontend.

### Empty State

- 🔍 emoji at 4rem, muted "No games match your filters" in Space Grotesk

## Calendar Page (`src/pages/calendar.astro` + `src/components/EventList.tsx`)

### Header

- "WHAT'S HAPPENING" section tag pill
- "Upcoming Sessions" title
- Muted subtitle

### Month Groups

- Events grouped by month
- Each month gets a big orange pill title (e.g. "April 2026"), thick black border, `sm` offset shadow
- Below: responsive grid of event cards (`repeat(auto-fill, minmax(260px, 1fr))`)

### Event Card

- White bg, 4px black border, 16px radius, `md` offset shadow
- **Accent strip at top** (3px black bottom border):
  - Left: event date in Space Grotesk bold (e.g. "Sat 26 Apr")
  - Right: black "FEATURED" pill if event is featured
- **Body:** event name (bold), location row (📍 + venue), short description, time
- If registration is open: small orange "Register →" button at bottom, links to `/register?event=<id>`
- Hover: `translate(-4px, -4px)`, shadow `xl`

### Featured Event

- If an event has a featured flag, its card spans full width of the grid, larger padding, yellow highlight accent strip

### Empty State

- "🎲 No upcoming sessions yet — check back soon!" centered, muted

### Past Events

- Keep current behavior (hidden or toggle, whatever is currently in `EventList.tsx`)

### Data

- Uses existing public read via browser Supabase client (`is_published = true` RLS policy). No worker / schema changes.

## Guild Path Page (`src/pages/guild-path.astro` + `src/components/GuildPurchase.tsx` + `src/components/PaymentSheet.tsx`)

### Header

- "MEMBERSHIP" section tag pill
- "Guild Path" title
- Short tagline ("Level up, unlock perks, play more")

### Tier Display Cards

- Grid of N tier cards (matches whatever tiers exist in data)
- Each tier: distinct bg color (teal / yellow-highlight / purple rotating), thick border, offset shadow
- Inside: tier name (Space Grotesk bold), price pill, short description, bulleted perks list with ✓ marks, "Choose this tier" button (black bg, white text, offset shadow) at bottom
- "Most popular" black pill above the middle tier (optional, configurable)

### Purchase Flow (`GuildPurchase.tsx`)

Functionally unchanged. Restyled:

- Phone lookup step: `input-brutal` style, explanatory muted copy
- Tier selection step: uses the same tier-card pattern; selected card gets thicker border + its color fills
- Form step: labels as uppercase small tag style, inputs as `input-brutal`
- Error state: pink bordered card at top of form with message
- Success state: green card replacing the form with next steps

### Payment Sheet (`PaymentSheet.tsx`)

- Full-screen modal, cream bg, thick black border, `xl` offset shadow
- UPI QR code framed with thick black border + offset shadow
- Three payment app buttons (GPay / PhonePe / Paytm): big colored pill-buttons with icons, each with thick border + offset shadow
- UPI ID hardcoded in the component (per CLAUDE.md gotcha — update there if it changes)

### Benefits / FAQ

- Two-column card list on desktop (stacks on mobile)
- Each item: white card, thick border, `md` offset shadow, click to expand (accordion)

### CTA at Bottom

- Reuse the orange Community CTA block from the home page — "Not ready yet? Join our WhatsApp to try a session first."

## Register Page (`src/pages/register.astro` + `src/components/RegistrationForm.tsx` + `src/components/CustomQuestion.tsx`)

### Header

- "REGISTER" section tag pill
- "Register for a Session" title
- Short subtitle

### Form Wrapper

- Centered, max-width ~720px
- White card, 4px black border, 20px radius, `lg` offset shadow
- Orange accent strip at the top (12px, 3px black bottom border) for visual weight

### Event Selection

- Shown only if user didn't arrive via `?event=<id>`
- Grid of mini event cards matching calendar page pattern, click to select
- Selected state: card fills with orange, border thickens, white text
- Remaining-spots pill (from `GET /api/event-spots/:id`) in the corner

### Form Fields

- **Phone** first — triggers `POST /api/lookup-phone` on blur
  - If match found: autofills name/email, shows green "Welcome back, {name}!" pill above the form
  - If match is a guild member: purple pill shows tier + discount applied
- Text inputs: `input-brutal` — white, 3px black border, 8px radius, `sm` offset shadow, `lg` on focus
- Labels: Space Grotesk semibold, small uppercase tag style
- Error messages: pink text below field, bold
- Radio / checkbox groups: each option is a selectable pill-button (2px border). Selected = black fill, white text
- Seats selector: stepper with brutalist `+` / `−` buttons (black border, offset shadow)

### Custom Questions (`CustomQuestion.tsx`)

- Driven by `events.custom_questions` JSONB — already working
- Restyle the question-type components (text, radio, checkbox, select) to match the form aesthetic

### Price Summary Card

- Sticky on desktop, inline on mobile
- Yellow highlight bg, thick border, offset shadow
- Line items: base price × seats, guild discount (if any shown in green), final total in large Space Grotesk
- "Confirm & Pay" button — full-width on mobile, primary orange, thick border, offset shadow

### Success State

- Replaces form with a green card: ✅ emoji, "You're in! 🎲", registration details
- Link/button opens `PaymentSheet.tsx` for UPI payment

### Error State

- Pink bordered card at top of form with API error message

## Cross-Cutting Concerns

### Responsive Behavior

Breakpoints match reference:

- `≤968px`: 3-col grids → 2-col; footer 3→2 col
- `≤768px`: 2-col → 1-col; hero stacks; mobile menu activates
- `≤480px`: tighter padding; library grid stays 2-col with compact cards

### Accessibility

- Semantic HTML preserved (`<nav>`, `<main>`, `<section>` with headings)
- Borders ≥3px ensure high contrast visual separation
- Focus states: larger offset shadow + outline ring for keyboard users
- Color contrast verified: cream `#FFF8E7` + black `#1A1A1A` > 15:1; all colored card bgs use black text at ≥4.5:1

### What's Not Changing

- Supabase schema, RLS policies, worker endpoints
- Routes — same 5 pages
- Data flow (browser anon-key reads, worker service-key writes)
- `GameCount`, `UpcomingEventBanner` logic
- `custom_questions` JSONB flow
- Cloudflare Pages / Workers deployment

### What's Being Removed

- The 6-photo hero collage on home (replaced with single photo)
- Any Tailwind utility classes made redundant by the new component classes (prune pass at the end)

### Out of Scope

- New pages, new endpoints, schema changes
- Animations beyond fade-in reveal + hover translate
- Hero photo replacement (using existing `/landing-photos/*.png`)
- Logo redesign

## Files Touched

### New

- None (all changes are edits)

### Modified

- `src/styles/global.css` — new tokens, primitives, component classes, reveal animation CSS
- `src/layouts/Layout.astro` — body bg, reveal-on-scroll snippet
- `src/components/Nav.astro`
- `src/components/MobileMenu.tsx`
- `src/components/Footer.astro`
- `src/components/UpcomingEventBanner.tsx`
- `src/pages/index.astro`
- `src/pages/library.astro`
- `src/components/GameLibrary.tsx`
- `src/pages/calendar.astro`
- `src/components/EventList.tsx`
- `src/pages/guild-path.astro`
- `src/components/GuildPurchase.tsx`
- `src/components/PaymentSheet.tsx`
- `src/pages/register.astro`
- `src/components/RegistrationForm.tsx`
- `src/components/CustomQuestion.tsx`

## Validation / Success Criteria

- All 5 pages render with the new aesthetic end-to-end
- Existing functionality verified in browser: library filtering + modal, calendar display, guild-path purchase flow (phone lookup → tier → form → payment), register flow (event selection → phone lookup → form → payment)
- Responsive check at 480 / 768 / 968 / 1200px widths
- No regressions in Supabase reads, Worker calls, or payment sheet UPI deep links
- Build succeeds (`npm run build`) and Worker deploys cleanly
