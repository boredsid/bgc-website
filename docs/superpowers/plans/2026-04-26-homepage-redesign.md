# Homepage Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite `src/pages/index.astro` per `docs/superpowers/specs/2026-04-26-homepage-redesign.md` — dark hero, photo band, yellow event marquee with relative-date label and spots-left bar, three editorial stripes, dense Guild Path teaser, photo-backed Community CTA, and an Astro `astro:assets` photo pipeline.

**Architecture:** The site is Astro 5 with React islands and Tailwind 4 (CSS-based config). The redesign stays inside the existing brutalist design system (tokens in `src/styles/global.css`). Data sources are unchanged: Supabase via the browser client for events; the existing Cloudflare Worker `/api/event-spots/:id` endpoint for capacity; `<GameCount>` for the live game count. No new worker endpoints. Photos move from `public/landing-photos/` (8–15MB PNGs) to `src/assets/landing/` so Astro's built-in `<Image>` pipeline emits responsive WebP variants automatically.

**Tech Stack:** Astro 5 · React 19 islands · Tailwind 4 · Supabase JS · Cloudflare Pages + Workers · `astro:assets` (built into Astro 5)

**Verification approach:** This codebase has no unit-test framework (intentional for a small static site). Tasks verify with: (1) `npx astro check` for type errors, (2) `npm run build` for build errors, (3) `npm run dev` + browser inspection for visual + behavior, and (4) targeted `grep`/`curl` assertions on built HTML where useful. Each task ends in a working homepage so visual review is possible after every commit.

---

## File Map

**New:**
- `src/lib/guild-tiers.ts` — shared `TIERS` array (data only, no React)
- `src/assets/landing/1.png` … `6.png` — optimized photo sources (moved from `public/landing-photos/`)
- `src/components/HeroPhotoBand.astro` — mobile scroll-snap photo strip / desktop 3-up
- `src/components/EditorialStripe.astro` — reusable photo+copy stripe

**Modified:**
- `src/pages/index.astro` — full rewrite (one section per task)
- `src/components/UpcomingEventBanner.tsx` — heavy restyle to marquee, add relative-date logic + spots-left bar + edge-case states
- `src/components/GuildPurchase.tsx` — import `TIERS` from `src/lib/guild-tiers.ts` instead of local const

**Deleted at end:**
- `public/landing-photos/*.png` — replaced by optimized assets in `src/assets/landing/`

---

## Task 1: Extract Guild tier data into a shared module

**Why first:** The new Guild Path teaser on the homepage (Task 6) needs the same tier names, prices, and colors as the existing `/guild-path` page. Extracting first means both consumers read from one source.

**Files:**
- Create: `src/lib/guild-tiers.ts`
- Modify: `src/components/GuildPurchase.tsx` (top of file, ~line 1–66)

- [ ] **Step 1: Create the shared module**

Write `src/lib/guild-tiers.ts`:

```ts
export type Tier = {
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

export const TIERS: Tier[] = [
  {
    key: 'initiate',
    name: 'Initiate',
    price: 600,
    priceLabel: '₹600',
    period: '3 months',
    color: '#4ECDC4',
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
    color: '#FFD166',
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
    color: '#C3A6FF',
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
```

- [ ] **Step 2: Refactor `GuildPurchase.tsx` to import**

In `src/components/GuildPurchase.tsx`, delete the local `type Tier = ...` (currently lines ~6–17) and the local `const TIERS: Tier[] = [ ... ]` block (currently lines ~19–66). Replace with this import at the top of the file (after the existing `import` lines):

```ts
import { TIERS, type Tier } from '../lib/guild-tiers';
```

Leave the rest of the file unchanged.

- [ ] **Step 3: Verify type check passes**

Run: `npx astro check`
Expected: 0 errors, 0 warnings (or unchanged from baseline; previous baseline can be confirmed with `git stash && npx astro check` if needed).

- [ ] **Step 4: Verify build passes**

Run: `npm run build`
Expected: build succeeds, `dist/` produced, no errors.

- [ ] **Step 5: Verify `/guild-path` still works in dev**

Run: `npm run dev` (background). Open `http://localhost:4321/guild-path`. Confirm three tier cards render with the same names, prices, colors, and benefits as before. Stop dev server.

- [ ] **Step 6: Commit**

```bash
git add src/lib/guild-tiers.ts src/components/GuildPurchase.tsx
git commit -m "refactor(design): extract Guild tier data into src/lib/guild-tiers.ts"
```

---

## Task 2: Move photos into `astro:assets` pipeline

**Why now:** All later tasks reference these images via Astro's `<Image>` component. Doing this once up front means each subsequent task imports from a stable location.

**Files:**
- Create: `src/assets/landing/1.png` … `6.png` (moved from `public/landing-photos/`)
- Modify: `src/pages/index.astro` (one image reference at line 30 — the current hero photo)

- [ ] **Step 1: Move the photos**

Run from project root:

```bash
mkdir -p src/assets/landing
mv public/landing-photos/1.png public/landing-photos/2.png public/landing-photos/3.png public/landing-photos/4.png public/landing-photos/5.png public/landing-photos/6.png src/assets/landing/
rmdir public/landing-photos
```

Expected: `src/assets/landing/` contains six PNGs (`1.png`–`6.png`), `public/landing-photos/` no longer exists.

- [ ] **Step 2: Update the existing reference in `index.astro` to use `astro:assets`**

In `src/pages/index.astro`:

At the top of the frontmatter (after the existing imports), add:

```astro
import { Image } from 'astro:assets';
import landing1 from '../assets/landing/1.png';
```

Then replace the existing `<img>` tag (currently around lines 29–34, the hero photo) with:

```astro
<Image
  src={landing1}
  alt="BGC game session"
  widths={[400, 800, 1200]}
  sizes="(max-width: 768px) 100vw, 600px"
  class="w-full object-cover rounded-[20px]"
  style="aspect-ratio: 4/3; border: 4px solid #1A1A1A; box-shadow: 8px 8px 0 #1A1A1A;"
/>
```

Astro auto-generates WebP variants and `srcset`. Default quality is fine for now; we'll let later tasks tune it if needed.

- [ ] **Step 3: Verify build emits optimized images**

Run: `npm run build`
Expected: build succeeds. Check the build output — confirm `dist/_astro/` contains generated WebP files for landing photo 1.

```bash
ls dist/_astro/ | grep -E "1\..*\.(webp|png)" | head
```

Expected: at least one `1.<hash>.webp` file (and possibly different-width variants).

- [ ] **Step 4: Verify the homepage still renders correctly**

Run: `npm run dev`. Open `http://localhost:4321/`. The hero photo still appears (now served as WebP with `srcset`). Check Network tab: the response is WebP, not the original 9.7MB PNG, and is well under 500KB. Stop dev server.

- [ ] **Step 5: Commit**

```bash
git add src/assets/landing/ src/pages/index.astro
git rm -r public/landing-photos 2>/dev/null || true
git commit -m "feat(design): move landing photos into astro:assets pipeline"
```

---

## Task 3: Restyle `UpcomingEventBanner` into the marquee

**Goal:** Convert the existing slim React island into the yellow full-width marquee with relative-date label, spots-left bar, and edge-case states. Keep it self-contained so the homepage rewrite (Task 4 onward) can simply embed it.

**Files:**
- Modify: `src/components/UpcomingEventBanner.tsx` (full rewrite — the file is small)

- [ ] **Step 1: Rewrite the component**

Replace the entire contents of `src/components/UpcomingEventBanner.tsx` with:

```tsx
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Event, EventSpots } from '../lib/types';

const WORKER_URL = import.meta.env.PUBLIC_WORKER_URL;
const WHATSAPP_URL = 'https://chat.whatsapp.com/GL1h4jipksfCW4vm7OtZjp';

function formatRelativeDate(eventDate: Date): string {
  const now = new Date();
  const diffMs = eventDate.getTime() - now.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const sameCalendarDay =
    eventDate.getFullYear() === now.getFullYear() &&
    eventDate.getMonth() === now.getMonth() &&
    eventDate.getDate() === now.getDate();

  if (sameCalendarDay) return 'TONIGHT';
  if (diffDays === 1 || (diffDays === 0 && eventDate > now)) return 'TOMORROW';

  const weekday = eventDate.toLocaleDateString('en-IN', { weekday: 'long' }).toUpperCase();

  if (diffDays >= 2 && diffDays <= 7) return `THIS ${weekday}`;
  if (diffDays >= 8 && diffDays <= 14) return `NEXT ${weekday}`;

  return eventDate
    .toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })
    .toUpperCase();
}

function formatTime(eventDate: Date): string {
  return eventDate.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
}

export default function UpcomingEventBanner() {
  const [event, setEvent] = useState<Event | null>(null);
  const [spots, setSpots] = useState<EventSpots | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const { data: nextEvent } = await supabase
        .from('events')
        .select('*')
        .gte('date', new Date().toISOString())
        .order('date', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (cancelled) return;
      setEvent(nextEvent ?? null);

      if (nextEvent) {
        try {
          const res = await fetch(`${WORKER_URL}/api/event-spots/${nextEvent.id}`);
          if (res.ok) {
            const data = (await res.json()) as EventSpots;
            if (!cancelled) setSpots(data);
          }
        } catch {
          // network/worker failure: leave spots null; bar simply won't render
        }
      }
      if (!cancelled) setLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return null;

  if (!event) {
    return (
      <section
        className="w-full"
        style={{ background: '#FFD166', borderTop: '4px solid #1A1A1A', borderBottom: '4px solid #1A1A1A' }}
      >
        <div className="max-w-[1200px] mx-auto px-6 py-8 md:py-12 text-center md:text-left">
          <h2 className="font-heading font-bold text-3xl md:text-5xl" style={{ letterSpacing: '-1px' }}>
            No public sessions on the calendar right now.
          </h2>
          <p className="mt-3 text-[#1A1A1A]/80 text-base md:text-lg">
            We post the next one in the WhatsApp group first — drop in.
          </p>
          <a
            href={WHATSAPP_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-black no-underline mt-6 inline-block"
          >
            Join the WhatsApp →
          </a>
        </div>
      </section>
    );
  }

  const eventDate = new Date(event.date);
  const relativeDate = formatRelativeDate(eventDate);
  const time = formatTime(eventDate);

  const total = spots?.capacity ?? event.capacity;
  const remaining = spots?.remaining ?? null;
  const used = remaining !== null ? Math.max(0, total - remaining) : null;
  const fillPct = used !== null && total > 0 ? Math.min(100, (used / total) * 100) : 0;

  const soldOut = remaining === 0;
  const almostFull = remaining !== null && remaining > 0 && remaining <= 3;

  let spotsText: string | null = null;
  if (remaining !== null) {
    if (soldOut) spotsText = 'Event full';
    else if (almostFull) spotsText = `Almost full — ${remaining} ${remaining === 1 ? 'spot' : 'spots'} left`;
    else spotsText = `${remaining} of ${total} spots left`;
  }

  const barColor = soldOut || almostFull ? '#DC2626' : '#1A1A1A';

  return (
    <section
      className="w-full"
      style={{ background: '#FFD166', borderTop: '4px solid #1A1A1A', borderBottom: '4px solid #1A1A1A' }}
    >
      <div className="max-w-[1200px] mx-auto px-6 py-8 md:py-12">
        <div className="font-heading font-bold text-sm md:text-base tracking-wider">▸ {relativeDate}</div>
        <h2
          className="font-heading font-bold mt-1"
          style={{ fontSize: 'clamp(2rem, 5vw, 4rem)', letterSpacing: '-1px', lineHeight: 1.05 }}
        >
          {event.name}
        </h2>
        <p className="mt-3 text-[#1A1A1A]/80 text-base md:text-lg">
          {event.venue_area} · {time} · ₹{event.price}
        </p>

        {spotsText !== null && (
          <div className="mt-5 max-w-md">
            <div
              className="w-full h-3 rounded-full overflow-hidden"
              style={{ border: '2px solid #1A1A1A', background: '#FFFFFF' }}
            >
              <div className="h-full" style={{ width: `${fillPct}%`, background: barColor, transition: 'width 0.3s' }} />
            </div>
            <p className="mt-2 text-sm font-semibold" style={{ color: barColor }}>
              {spotsText}
            </p>
          </div>
        )}

        <div className="mt-6 flex flex-wrap items-center gap-4">
          <a href={`/register?event=${event.id}`} className="btn btn-black no-underline">
            {soldOut ? 'Join waitlist →' : 'Register →'}
          </a>
          <a href="/calendar" className="text-sm font-semibold underline underline-offset-4">
            or see all upcoming →
          </a>
        </div>
      </div>
    </section>
  );
}
```

Notes for implementer:
- `EventSpots` type is already defined in `src/lib/types.ts` — `{ capacity, registered, remaining, option_counts }`.
- The `.maybeSingle()` call is preferred over `.single()` because the empty state is expected and shouldn't log a Supabase error.
- The fallback when the worker fetch fails (`spotsText === null`) means we still render the marquee with name/date/CTA, just without the spots bar. The page should never break because the worker is down.

- [ ] **Step 2: Verify type check**

Run: `npx astro check`
Expected: 0 errors.

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: success.

- [ ] **Step 4: Manually verify in dev — happy path**

Run: `npm run dev`. Open `http://localhost:4321/`. The current homepage still embeds the banner inside the section at line 40 (`<UpcomingEventBanner client:load />`). It will now render as a yellow full-width marquee — temporarily it'll look out of place inside the existing layout, that's expected (it gets repositioned in Task 4). Verify:
  - Yellow band with black borders top + bottom.
  - Relative date eyebrow shows (e.g., "THIS SATURDAY").
  - Event name renders.
  - Spots bar appears with text like "12 of 24 spots left".
  - Register and "see all upcoming" both work.

- [ ] **Step 5: Verify edge cases manually**

In Supabase Studio (or via SQL), check what happens for a sold-out event by temporarily setting one event's seats to fill capacity (or by inspecting the Network tab to confirm the spots data flows correctly). For the empty-state, no automated check is needed — the code path is straightforward and the static check (it returns the JSX block when `event` is null) is sufficient. Stop dev server.

- [ ] **Step 6: Commit**

```bash
git add src/components/UpcomingEventBanner.tsx
git commit -m "feat(design): restyle UpcomingEventBanner into yellow marquee with spots bar"
```

---

## Task 4: Build the new hero + photo band

**Goal:** Replace the current hero (welcome heading + single photo + CTAs) with the dark slab + edge-to-edge photo strip from the spec. Add the `HeroPhotoBand` component.

**Files:**
- Create: `src/components/HeroPhotoBand.astro`
- Modify: `src/pages/index.astro` (replace lines 9–37 of the original hero, plus add the band)

- [ ] **Step 1: Create `HeroPhotoBand.astro`**

Write `src/components/HeroPhotoBand.astro`:

```astro
---
import { Image } from 'astro:assets';
import p1 from '../assets/landing/1.png';
import p2 from '../assets/landing/2.png';
import p3 from '../assets/landing/3.png';

const photos = [
  { src: p1, alt: 'BGC session at a Bangalore cafe' },
  { src: p2, alt: 'Players gathered around a board game' },
  { src: p3, alt: 'Group laughing during a session' },
];
---

<div
  class="hero-photo-band"
  style="border-bottom: 4px solid #1A1A1A; background: #1A1A1A;"
>
  <div class="hero-photo-band-inner">
    {photos.map((photo) => (
      <div class="hero-photo-band-item">
        <Image
          src={photo.src}
          alt={photo.alt}
          widths={[400, 800, 1200]}
          sizes="(max-width: 768px) 85vw, 33vw"
          loading="eager"
          class="hero-photo-band-img"
        />
      </div>
    ))}
  </div>
</div>

<style>
  .hero-photo-band-inner {
    display: flex;
    flex-direction: row;
    overflow-x: auto;
    scroll-snap-type: x mandatory;
    scrollbar-width: none;
    -ms-overflow-style: none;
  }
  .hero-photo-band-inner::-webkit-scrollbar {
    display: none;
  }
  .hero-photo-band-item {
    flex: 0 0 85%;
    scroll-snap-align: center;
    aspect-ratio: 3 / 4;
    border-right: 2px solid #1A1A1A;
  }
  .hero-photo-band-item:last-child {
    border-right: none;
  }
  .hero-photo-band-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  @media (min-width: 768px) {
    .hero-photo-band-inner {
      overflow: hidden;
    }
    .hero-photo-band-item {
      flex: 1 1 0;
      aspect-ratio: 4 / 5;
    }
  }
</style>
```

- [ ] **Step 2: Replace the hero section in `index.astro`**

In `src/pages/index.astro`, replace the current frontmatter (lines 1–5) and hero `<section>` (lines 9–37) so the file starts like this:

```astro
---
import Layout from '../layouts/Layout.astro';
import UpcomingEventBanner from '../components/UpcomingEventBanner.tsx';
import GameCount from '../components/GameCount.tsx';
import HeroPhotoBand from '../components/HeroPhotoBand.astro';
---

<Layout title="Home" description="Bangalore's gaming community — board game sessions at cafes across the city">

  <!-- Hero: dark slab -->
  <section class="hero-dark" style="background: #1A1A1A;">
    <div class="max-w-[1200px] mx-auto px-6 py-16 md:py-24">
      <div class="text-xs md:text-sm font-heading font-semibold tracking-widest" style="color: #FFD166;">
        BANGALORE'S
      </div>
      <h1
        class="font-heading font-bold text-white mt-2"
        style="font-size: clamp(2.8rem, 9vw, 6rem); line-height: 1.0; letter-spacing: -2.5px;"
      >
        Gaming Community.
      </h1>
      <p class="mt-5 text-base md:text-lg text-white/70 max-w-xl">
        3,500+ players. <GameCount client:load />+ games. Sessions every weekend, all over Bangalore.
      </p>
      <div class="mt-8 flex flex-wrap gap-4">
        <a href="/register" class="btn btn-primary no-underline">Register for a session →</a>
        <a
          href="https://chat.whatsapp.com/GL1h4jipksfCW4vm7OtZjp"
          target="_blank"
          rel="noopener noreferrer"
          class="btn no-underline"
          style="background: transparent; color: #FFFFFF; border: 4px solid #FFFFFF;"
        >
          Join the WhatsApp
        </a>
      </div>
    </div>
  </section>

  <!-- Hero photo band: 3 photos edge-to-edge -->
  <HeroPhotoBand />

  <!-- Upcoming event marquee (now full-width, no wrapping section) -->
  <UpcomingEventBanner client:load />
```

Leave everything below the marquee (the rest of the file) alone for now — Tasks 5–7 each replace one of the remaining sections.

Note: the original homepage wrapped `<UpcomingEventBanner>` in a `<section class="max-w-[1200px] ... reveal">`. The new banner provides its own full-width band, so we drop that wrapper entirely. Just use `<UpcomingEventBanner client:load />` as a top-level element.

- [ ] **Step 3: Verify type check + build**

Run:
```bash
npx astro check && npm run build
```
Expected: both succeed.

- [ ] **Step 4: Manually verify in dev**

Run: `npm run dev`. Open `http://localhost:4321/`. Verify:
- Dark hero shows "BANGALORE'S" / "Gaming Community." / inline numbers (with the live game count number rendered).
- Two CTAs render — orange filled, white outlined.
- Photo band sits flush below — 3 photos in a row on desktop, scroll-snap strip on mobile (resize browser to ~400px wide, scroll horizontally to confirm).
- Marquee sits below the band, full width.
- The page below the marquee still has the old "What does BGC do" cards and Guild Path teaser — those stay until later tasks.

Stop dev server.

- [ ] **Step 5: Commit**

```bash
git add src/components/HeroPhotoBand.astro src/pages/index.astro
git commit -m "feat(design): replace homepage hero with dark slab + photo band"
```

---

## Task 5: Replace "What We Do" with editorial stripes

**Goal:** Build the `EditorialStripe` component and use it three times to replace the current 3-emoji-card "What Does BGC Do?" section.

**Files:**
- Create: `src/components/EditorialStripe.astro`
- Modify: `src/pages/index.astro` (delete the old "What Does BGC Do?" section, lines ~44–75 in the post-Task-4 file; insert three `<EditorialStripe>` calls)

- [ ] **Step 1: Create `EditorialStripe.astro`**

The component supports passing the heading either as a plain string prop (`heading="..."`) or as a named slot (`<Fragment slot="heading">...</Fragment>`). Stripe 2 uses the slot so a live `<GameCount client:load />` React island can sit inside the heading.

Write `src/components/EditorialStripe.astro`:

```astro
---
import { Image } from 'astro:assets';
import type { ImageMetadata } from 'astro';

interface Props {
  number: string;
  label: string;
  heading?: string;
  body: string;
  ctaText: string;
  ctaHref: string;
  bgColor: string;
  photo: ImageMetadata;
  photoAlt: string;
  photoSide: 'left' | 'right';
  ctaExternal?: boolean;
}

const { number, label, heading = '', body, ctaText, ctaHref, bgColor, photo, photoAlt, photoSide, ctaExternal = false } = Astro.props;
---

<section
  class="editorial-stripe"
  style={`background: ${bgColor}; border-bottom: 4px solid #1A1A1A;`}
  data-photo-side={photoSide}
>
  <div class="stripe-grid">
    <div class="stripe-photo">
      <Image
        src={photo}
        alt={photoAlt}
        widths={[400, 800, 1200]}
        sizes="(max-width: 768px) 100vw, 50vw"
        loading="lazy"
        class="stripe-img"
      />
    </div>
    <div class="stripe-copy">
      <div class="font-heading font-semibold text-xs md:text-sm tracking-widest opacity-70">
        {number} / {label}
      </div>
      <h2
        class="font-heading font-bold mt-2"
        style="font-size: clamp(1.8rem, 4.5vw, 3rem); line-height: 1.1; letter-spacing: -1px;"
      >
        <slot name="heading">{heading}</slot>
      </h2>
      <p class="mt-4 text-base md:text-lg text-[#1A1A1A]/85 max-w-xl">{body}</p>
      <a
        href={ctaHref}
        class="inline-block mt-6 font-heading font-semibold underline underline-offset-4 text-base"
        target={ctaExternal ? '_blank' : undefined}
        rel={ctaExternal ? 'noopener noreferrer' : undefined}
      >
        {ctaText}
      </a>
    </div>
  </div>
</section>

<style>
  .stripe-grid {
    display: grid;
    grid-template-columns: 1fr;
    grid-template-areas: 'photo' 'copy';
  }
  .stripe-photo { grid-area: photo; aspect-ratio: 4 / 3; border-bottom: 4px solid #1A1A1A; }
  .stripe-copy { grid-area: copy; padding: 2rem 1.5rem; max-width: 1200px; margin: 0 auto; }
  .stripe-img { width: 100%; height: 100%; object-fit: cover; display: block; }

  @media (min-width: 768px) {
    .stripe-grid {
      grid-template-columns: 1fr 1fr;
      max-width: 1200px;
      margin: 0 auto;
      align-items: stretch;
    }
    .stripe-photo {
      aspect-ratio: auto;
      border-bottom: none;
      border-right: 4px solid #1A1A1A;
    }
    .stripe-copy {
      padding: 3rem 2.5rem;
    }
    [data-photo-side='right'] .stripe-photo {
      order: 2;
      border-right: none;
      border-left: 4px solid #1A1A1A;
    }
    [data-photo-side='right'] .stripe-copy {
      order: 1;
    }
  }
</style>
```

Note: `ctaExternal` controls `target="_blank"` on stripe 3's WhatsApp link.

- [ ] **Step 2: Replace the "What Does BGC Do?" section in `index.astro`**

In `src/pages/index.astro`:

Add to the frontmatter:

```astro
import EditorialStripe from '../components/EditorialStripe.astro';
import landing4 from '../assets/landing/4.png';
import landing5 from '../assets/landing/5.png';
import landing6 from '../assets/landing/6.png';
```

Then **delete** the existing "What Does BGC Do?" section (the `<section class="py-16 reveal" style="background: #FAFAF5;">...</section>` block that contains the 3 emoji cards) and replace with:

```astro
<!-- Editorial stripes: what we do -->
<EditorialStripe
  number="01"
  label="SESSIONS"
  heading="We host every weekend at cafes across Bangalore."
  body="Indiranagar, Koramangala, HSR, Whitefield. Show up, sit down, learn a new game, meet new people. Beginners always welcome."
  ctaText="See the calendar →"
  ctaHref="/calendar"
  bgColor="#FFD166"
  photo={landing4}
  photoAlt="Players around a table at a Bangalore cafe"
  photoSide="left"
/>

<EditorialStripe
  number="02"
  label="LIBRARY"
  heading=""
  body="Catan, Scythe, Wingspan, Clocktower, D&D — plus party games, two-player wonders, and weird imports you've never heard of. Browse the full list."
  ctaText="Browse the library →"
  ctaHref="/library"
  bgColor="#4A9B8E"
  photo={landing5}
  photoAlt="Shelves of board games in the BGC library"
  photoSide="right"
>
  <Fragment slot="heading">
    <GameCount client:load />+ board games. From 10-minute fillers to 4-hour epics.
  </Fragment>
</EditorialStripe>

<EditorialStripe
  number="03"
  label="COMMUNITY"
  heading="Not a class. Not a service. A community."
  body="We're 3,500+ players in Bangalore who keep showing up because the people are the point. Drop into the WhatsApp group — say hi."
  ctaText="Join the WhatsApp →"
  ctaHref="https://chat.whatsapp.com/GL1h4jipksfCW4vm7OtZjp"
  bgColor="#C3A6FF"
  photo={landing6}
  photoAlt="BGC community group photo"
  photoSide="left"
  ctaExternal
/>
```

- [ ] **Step 3: Verify type check + build**

Run:
```bash
npx astro check && npm run build
```
Expected: both succeed.

- [ ] **Step 4: Manually verify in dev**

Run: `npm run dev`. Open `http://localhost:4321/`. Verify:
- After the marquee, three full-width stripes appear in this order: yellow (sessions), teal (library), lavender (community).
- On desktop, photo positions alternate left → right → left.
- Stripe 2's heading shows the live game count (e.g., "130+ board games...").
- All three CTA links navigate correctly.
- On mobile (resize to ~400px), each stripe stacks: photo on top, copy below.

Stop dev server.

- [ ] **Step 5: Commit**

```bash
git add src/components/EditorialStripe.astro src/pages/index.astro
git commit -m "feat(design): replace 'What we do' with editorial stripes"
```

---

## Task 6: Restyle Guild Path teaser

**Goal:** Replace the current lavender Guild Path teaser card with the dense black band + tier pills described in the spec.

**Files:**
- Modify: `src/pages/index.astro` (delete the old Guild Path section, insert the new one)

- [ ] **Step 1: Replace the section**

In `src/pages/index.astro`:

Add to the frontmatter (alongside existing imports):

```astro
import { TIERS } from '../lib/guild-tiers';
```

Find the existing Guild Path section (the `<section class="py-16 reveal" ...>` block whose `card-brutal` has `background: #C3A6FF;` — the lavender card with the spades/chess decorations). Delete the entire `<section>` and replace with:

```astro
<!-- Guild Path teaser: black band -->
<section class="py-14 md:py-20" style="background: #1A1A1A;">
  <div class="max-w-[1200px] mx-auto px-6">
    <div class="font-heading font-semibold text-xs md:text-sm tracking-widest" style="color: #FFD166;">
      ▸ FOR THE REGULARS
    </div>
    <h2
      class="font-heading font-bold text-white mt-2"
      style="font-size: clamp(2.2rem, 6vw, 4rem); line-height: 1.05; letter-spacing: -1.5px;"
    >
      Get on the Guild Path.
    </h2>
    <p class="mt-4 text-base md:text-lg text-white/70 max-w-xl">
      Join the ranks. Cheaper sessions, free events, exclusive perks. Three tiers.
    </p>

    <div class="mt-8 flex flex-wrap gap-3">
      {TIERS.map((tier) => (
        <a
          href="/guild-path"
          class="font-heading font-semibold no-underline"
          style={`background: ${tier.color}; color: #1A1A1A; border: 3px solid #1A1A1A; box-shadow: 4px 4px 0 #FFFFFF; padding: 12px 20px; border-radius: 50px; display: inline-flex; align-items: baseline; gap: 8px;`}
        >
          <span style="font-size: 1rem;">{tier.name}</span>
          <span style="font-size: 0.85rem; opacity: 0.7;">{tier.priceLabel}</span>
        </a>
      ))}
    </div>

    <div class="mt-8">
      <a href="/guild-path" class="btn btn-primary no-underline">See all tiers →</a>
    </div>
  </div>
</section>
```

- [ ] **Step 2: Verify type check + build**

```bash
npx astro check && npm run build
```
Expected: both succeed.

- [ ] **Step 3: Manually verify in dev**

Run: `npm run dev`. Visit `http://localhost:4321/`. Verify:
- Guild Path band has black background.
- "▸ FOR THE REGULARS" eyebrow renders yellow.
- Three tier pills appear in the brand colors (teal, yellow, lavender) with white offset shadow.
- Each pill shows tier name + `priceLabel` (`Initiate ₹600`, etc.) and links to `/guild-path`.
- Orange "See all tiers →" button below.

Stop dev server.

- [ ] **Step 4: Commit**

```bash
git add src/pages/index.astro
git commit -m "feat(design): restyle Guild Path teaser as dense black band with tier pills"
```

---

## Task 7: Restyle Community CTA with photo backdrop

**Goal:** Replace the current orange CTA (with corner emoji decorations) with the new orange band that has a photo at low opacity behind the text.

**Files:**
- Modify: `src/pages/index.astro` (replace the final orange "Join Our Community" section)

- [ ] **Step 1: Replace the section**

In `src/pages/index.astro`, find the existing Community CTA section (the final `<section class="py-16 reveal" ...>` containing the `card-brutal` with `background: #F47B20;` and the four corner emoji decorations). Delete it entirely and replace with:

```astro
<!-- Community CTA: orange band with photo backdrop -->
<section class="community-cta" style="background: #F47B20; position: relative; overflow: hidden;">
  <Image
    src={landing2}
    alt=""
    aria-hidden="true"
    widths={[800, 1600]}
    sizes="100vw"
    loading="lazy"
    class="community-cta-bg"
  />
  <div class="max-w-[1200px] mx-auto px-6 py-16 md:py-24 relative" style="z-index: 1;">
    <h2
      class="font-heading font-bold text-white"
      style="font-size: clamp(2.5rem, 7vw, 5rem); line-height: 1.0; letter-spacing: -2px;"
    >
      Come play with us.
    </h2>
    <p class="mt-4 text-base md:text-lg text-white/85 max-w-xl">
      WhatsApp is where the action happens. Instagram is where the photos do.
    </p>
    <div class="mt-8 flex flex-wrap gap-4">
      <a
        href="https://chat.whatsapp.com/GL1h4jipksfCW4vm7OtZjp"
        target="_blank"
        rel="noopener noreferrer"
        class="btn btn-black no-underline"
      >
        WhatsApp Group
      </a>
      <a
        href="https://instagram.com/boardgamecompany"
        target="_blank"
        rel="noopener noreferrer"
        class="btn btn-black no-underline"
      >
        @boardgamecompany on Instagram
      </a>
    </div>
    <p class="mt-6 text-[#1A1A1A]/70 text-sm font-semibold">
      Or just turn up to a session. We don't bite.
    </p>
  </div>
</section>

<style>
  .community-cta-bg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    opacity: 0.18;
    z-index: 0;
    filter: contrast(1.05);
  }
</style>
```

Add to the frontmatter (if not already imported in earlier tasks):

```astro
import landing2 from '../assets/landing/2.png';
```

(`landing2` was imported in Task 5 — confirm it's there. If not, add this import.)

- [ ] **Step 2: Verify type check + build**

```bash
npx astro check && npm run build
```
Expected: both succeed.

- [ ] **Step 3: Manually verify in dev**

Run: `npm run dev`. Visit `http://localhost:4321/`. Scroll to the bottom. Verify:
- Orange band fills width.
- A photo is visible behind the text at low opacity — readable but adds texture.
- Heading "Come play with us." renders large in white.
- Two black pill buttons (WhatsApp + Instagram) work and open in new tabs.
- The "We don't bite." line appears below.

Stop dev server.

- [ ] **Step 4: Commit**

```bash
git add src/pages/index.astro
git commit -m "feat(design): restyle Community CTA with photo backdrop"
```

---

## Task 8: Cleanup pass

**Goal:** Remove dead imports, sanity-check mobile, confirm final state.

**Files:**
- Modify: `src/pages/index.astro` (remove the `landing1` import that was added in Task 2 if no longer used, and the `<Image>` block; also drop any leftover wrappers)

- [ ] **Step 1: Audit `src/pages/index.astro`**

Open the file. Check the frontmatter for unused imports — particularly `landing1` from Task 2. Since the new hero (Task 4) doesn't use a single hero photo (the photo band uses 1, 2, 3 from inside `HeroPhotoBand.astro`), `landing1` is now unused at the page level. Remove it.

The file should now import only what's used. Expected frontmatter:

```astro
import Layout from '../layouts/Layout.astro';
import { Image } from 'astro:assets';  // only if Community CTA still uses <Image> directly
import UpcomingEventBanner from '../components/UpcomingEventBanner.tsx';
import GameCount from '../components/GameCount.tsx';
import HeroPhotoBand from '../components/HeroPhotoBand.astro';
import EditorialStripe from '../components/EditorialStripe.astro';
import { TIERS } from '../lib/guild-tiers';
import landing2 from '../assets/landing/2.png';
import landing4 from '../assets/landing/4.png';
import landing5 from '../assets/landing/5.png';
import landing6 from '../assets/landing/6.png';
```

(`landing3` is used inside `HeroPhotoBand.astro`, not in the page — don't import it here.)

- [ ] **Step 2: Verify type check + build**

```bash
npx astro check && npm run build
```
Expected: both succeed, no warnings about unused imports.

- [ ] **Step 3: Mobile manual review**

Run: `npm run dev`. In a browser, open DevTools and switch to a phone preset (e.g., iPhone 13 — 390×844). Visit `http://localhost:4321/`. Verify:

- Hero takes roughly 60–80% of the viewport on first load.
- Headline doesn't overflow horizontally.
- Photo band scrolls smoothly with snap.
- Marquee is full-width, register button reachable as a tap target.
- Editorial stripes stack image-above-copy.
- Guild Path tier pills wrap onto multiple lines if needed.
- Community CTA buttons stack vertically.
- No horizontal scrollbar anywhere on the page (this is the most common mobile bug — check by scrolling sideways; nothing should move).

Capture a screenshot if anything looks off and adjust.

- [ ] **Step 4: Lighthouse / total page weight check**

In Chrome DevTools, reload with Network throttling set to "Fast 4G". After the page settles (lazy images loaded), check the bottom of the Network panel — total transferred should be well under 2MB, and the initial paint payload (before scrolling) should be under ~800KB.

If total is too high (e.g., one photo is much larger than expected), tune the `quality` prop on the `<Image>` component for that photo. Astro's default is good but high-detail photos may need `quality={70}` to cut size.

- [ ] **Step 5: Final commit**

If anything was changed in steps 1–4:

```bash
git add src/pages/index.astro
git commit -m "chore(design): clean up unused imports on homepage"
```

If nothing changed (the audit found nothing to fix), no commit needed.

- [ ] **Step 6: Push the branch**

```bash
git push origin redesign/neo-brutalist
```

This triggers the Cloudflare Pages preview build. The user will share or approve the preview URL before merging to `main`.

---

## Out of Scope Reminders

These are tracked in the spec; do not attempt during this implementation:
- Personalization for returning Guild members.
- Live Instagram follower count.
- Photo wall / Polaroid section.
- Other pages.

## Verification Cheat Sheet

| What | Command |
|------|---------|
| Type check | `npx astro check` |
| Build | `npm run build` |
| Dev server | `npm run dev` (then open `http://localhost:4321/`) |
| Worker dev | `cd worker && npm run dev` (only needed if testing spots-bar live; otherwise the deployed worker at `bgc-api.boredsid.workers.dev` is fine) |
| Search built HTML | `grep -r "your-string" dist/` |
