# BGC Website Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Board Game Company website — a static Astro site with React islands for interactive features, backed by Supabase and Cloudflare Workers.

**Architecture:** Astro generates static HTML pages. React islands handle client-side interactivity (game library filters, event lists, registration forms). Supabase provides the database with RLS for public reads. A Cloudflare Worker handles sensitive operations (phone lookup, membership check, registration writes) using the Supabase service role key. UPI payments via QR codes and deep links.

**Tech Stack:** Astro 5, React 19, TypeScript, Tailwind CSS 4, Supabase JS client, Cloudflare Pages + Workers (Wrangler), Space Grotesk + Inter fonts.

**Design Spec:** `docs/superpowers/specs/2026-04-13-bgc-website-design.md`

---

## File Structure

```
bgc-website/
├── astro.config.mjs
├── package.json
├── tsconfig.json
├── tailwind.css                    # Tailwind v4 entry (uses CSS-based config)
├── public/
│   ├── bgc-logo.png
│   └── payment-app-icons/
│       ├── gpay.png
│       ├── phonepe.png
│       └── paytm.png
├── src/
│   ├── layouts/
│   │   └── Layout.astro            # Base HTML layout with head, nav, footer
│   ├── components/
│   │   ├── Nav.astro               # Top navigation bar
│   │   ├── MobileMenu.tsx          # React island — hamburger menu toggle
│   │   ├── Footer.astro            # Site footer
│   │   ├── UpcomingEventBanner.tsx  # React island — next event on landing page
│   │   ├── GameLibrary.tsx         # React island — browse/filter games
│   │   ├── EventList.tsx           # React island — upcoming events list
│   │   ├── RegistrationForm.tsx    # React island — full registration flow
│   │   ├── CustomQuestion.tsx      # React component — renders one custom question
│   │   └── PaymentSheet.tsx        # React component — UPI payment bottom sheet
│   ├── lib/
│   │   ├── supabase.ts             # Browser Supabase client (anon key)
│   │   └── types.ts                # Shared TypeScript types
│   ├── styles/
│   │   └── global.css              # CSS custom properties, font imports
│   └── pages/
│       ├── index.astro             # Landing page
│       ├── library.astro           # Game library page
│       ├── guild-path.astro        # Membership tiers page (fully static)
│       ├── calendar.astro          # Events calendar page
│       └── register.astro          # Registration page
├── worker/
│   ├── src/
│   │   ├── index.ts                # Worker entry — router + CORS
│   │   ├── lookup-phone.ts         # POST /api/lookup-phone handler
│   │   ├── register.ts             # POST /api/register handler
│   │   ├── event-spots.ts          # GET /api/event-spots/:id handler
│   │   ├── supabase.ts             # Server-side Supabase client (service key)
│   │   └── validation.ts           # Input sanitization + validation helpers
│   ├── package.json
│   ├── wrangler.toml               # Worker config
│   └── tsconfig.json
└── supabase/
    └── migrations/
        └── 001_initial_schema.sql  # Tables, indexes, RLS policies
```

---

## Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `astro.config.mjs`
- Create: `tsconfig.json`
- Create: `tailwind.css`
- Create: `.gitignore`
- Move: `bgc-logo.png` → `public/bgc-logo.png`

- [ ] **Step 1: Initialize Astro project**

```bash
cd /Users/siddhantnarula/Projects/bgc-website
npm create astro@latest . -- --template minimal --no-install --no-git --typescript strict
```

- [ ] **Step 2: Install dependencies**

```bash
npm install @astrojs/react @astrojs/tailwind react react-dom @supabase/supabase-js
npm install -D @types/react @types/react-dom @tailwindcss/vite tailwindcss
```

- [ ] **Step 3: Configure Astro**

Replace `astro.config.mjs` with:

```js
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  integrations: [react()],
  vite: {
    plugins: [tailwindcss()],
  },
});
```

- [ ] **Step 4: Create Tailwind CSS entry file**

Create `src/styles/global.css`:

```css
@import "tailwindcss";

@theme {
  --color-bg: #FFF8F0;
  --color-primary: #F47B20;
  --color-primary-dark: #D96A15;
  --color-secondary: #1A1A1A;
  --color-accent: #4A9B8E;
  --color-highlight: #FFD166;
  --color-white: #FFFFFF;
  --color-muted: #777777;
  --color-border: #F0DCC8;
  --color-error: #DC2626;

  --font-heading: 'Space Grotesk', sans-serif;
  --font-body: 'Inter', sans-serif;
}
```

- [ ] **Step 5: Move logo to public directory**

```bash
mkdir -p public
mv bgc-logo.png public/bgc-logo.png
```

- [ ] **Step 6: Create .gitignore**

Create `.gitignore`:

```
node_modules/
dist/
.astro/
.superpowers/
.env
.env.local
worker/node_modules/
worker/dist/
.wrangler/
```

- [ ] **Step 7: Initialize git and commit**

```bash
git init
git add -A
git commit -m "feat: scaffold Astro project with React, Tailwind, and Supabase"
```

---

## Task 2: Shared Types and Supabase Client

**Files:**
- Create: `src/lib/types.ts`
- Create: `src/lib/supabase.ts`
- Create: `.env.example`

- [ ] **Step 1: Define shared TypeScript types**

Create `src/lib/types.ts`:

```ts
export interface Game {
  id: string;
  title: string;
  player_count: string;
  max_players: number;
  avg_rating: number;
  weight: number;
  complexity: string;
  play_time: string;
  max_play_time: number;
  length: string;
}

export interface Event {
  id: string;
  name: string;
  description: string;
  date: string;
  venue_name: string;
  venue_area: string;
  price: number;
  capacity: number;
  custom_questions: CustomQuestion[] | null;
  is_published: boolean;
  created_at: string;
}

export interface CustomQuestion {
  id: string;
  label: string;
  type: 'select' | 'radio' | 'text' | 'checkbox';
  required: boolean;
  options?: CustomQuestionOption[];
}

export interface CustomQuestionOption {
  value: string;
  capacity?: number;
}

export interface EventSpots {
  capacity: number;
  registered: number;
  remaining: number;
  option_counts: Record<string, Record<string, number>>;
}

export interface PhoneLookupResponse {
  user: { found: boolean; name: string | null; email: string | null };
  membership: { isMember: boolean; tier: string | null; discount: string | null };
}

export interface RegisterRequest {
  event_id: string;
  name: string;
  phone: string;
  email: string;
  seats: number;
  custom_answers: Record<string, string | boolean>;
  payment_status: 'pending' | 'confirmed';
}

export interface RegisterResponse {
  success: boolean;
  registration_id?: string;
  error?: string;
}
```

- [ ] **Step 2: Create Supabase client**

Create `src/lib/supabase.ts`:

```ts
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
```

- [ ] **Step 3: Create env example file**

Create `.env.example`:

```
PUBLIC_SUPABASE_URL=https://your-project.supabase.co
PUBLIC_SUPABASE_ANON_KEY=your-anon-key
PUBLIC_WORKER_URL=http://localhost:8787
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/types.ts src/lib/supabase.ts .env.example
git commit -m "feat: add shared types and Supabase client"
```

---

## Task 3: Supabase Schema Migration

**Files:**
- Create: `supabase/migrations/001_initial_schema.sql`

- [ ] **Step 1: Write the migration SQL**

Create `supabase/migrations/001_initial_schema.sql`:

```sql
-- Enable UUID generation
create extension if not exists "uuid-ossp";

-- ============================================
-- USERS
-- ============================================
create table users (
  id uuid primary key default uuid_generate_v4(),
  phone text not null,
  name text,
  email text,
  first_registered_at timestamptz not null default now(),
  last_registered_at timestamptz not null default now()
);

create unique index users_phone_idx on users (phone);

alter table users enable row level security;
-- No public access — Worker only

-- ============================================
-- GAMES
-- ============================================
create table games (
  id uuid primary key default uuid_generate_v4(),
  title text not null,
  player_count text,
  max_players int,
  avg_rating decimal,
  weight decimal,
  complexity text,
  play_time text,
  max_play_time int,
  length text,
  owned_by text,
  currently_with text
);

alter table games enable row level security;

create policy "Games are publicly readable"
  on games for select
  to anon
  using (true);

-- ============================================
-- EVENTS
-- ============================================
create table events (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  description text,
  date timestamptz not null,
  venue_name text,
  venue_area text,
  price int not null default 0,
  capacity int not null default 0,
  custom_questions jsonb,
  is_published boolean not null default false,
  created_at timestamptz not null default now()
);

alter table events enable row level security;

create policy "Published events are publicly readable"
  on events for select
  to anon
  using (is_published = true);

-- ============================================
-- GUILD MEMBERS
-- ============================================
create table guild_members (
  id uuid primary key default uuid_generate_v4(),
  name text,
  phone text not null,
  email text,
  tier text not null check (tier in ('initiate', 'adventurer', 'guildmaster')),
  starts_at date not null,
  expires_at date not null,
  events_attended int not null default 0,
  created_at timestamptz not null default now()
);

create unique index guild_members_phone_idx on guild_members (phone);

alter table guild_members enable row level security;
-- No public access — Worker only

-- ============================================
-- REGISTRATIONS
-- ============================================
create table registrations (
  id uuid primary key default uuid_generate_v4(),
  event_id uuid not null references events(id),
  name text not null,
  phone text not null,
  email text,
  seats int not null default 1,
  total_amount int not null default 0,
  discount_applied text,
  custom_answers jsonb,
  payment_status text not null default 'pending' check (payment_status in ('pending', 'confirmed')),
  created_at timestamptz not null default now()
);

create index registrations_event_id_idx on registrations (event_id);

alter table registrations enable row level security;
-- No public access — Worker only
```

- [ ] **Step 2: Commit**

```bash
git add supabase/
git commit -m "feat: add Supabase schema migration with RLS policies"
```

- [ ] **Step 3: Apply migration to Supabase**

Run this in the Supabase SQL editor (Dashboard → SQL Editor → paste and run), or via the Supabase CLI if set up:

```bash
# If using Supabase CLI:
# supabase db push
```

---

## Task 4: Layout, Nav, and Footer

**Files:**
- Create: `src/layouts/Layout.astro`
- Create: `src/components/Nav.astro`
- Create: `src/components/MobileMenu.tsx`
- Create: `src/components/Footer.astro`

- [ ] **Step 1: Create the base layout**

Create `src/layouts/Layout.astro`:

```astro
---
interface Props {
  title: string;
  description?: string;
}

const { title, description = "Bangalore's Favorite Board Gaming Community" } = Astro.props;
---

<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="description" content={description} />
    <title>{title} — Board Game Company</title>
    <link rel="icon" type="image/png" href="/bgc-logo.png" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@400;500;600;700&display=swap"
      rel="stylesheet"
    />
  </head>
  <body class="bg-bg font-body text-secondary min-h-screen flex flex-col">
    <Nav />
    <main class="flex-1">
      <slot />
    </main>
    <Footer />
  </body>
</html>

<script>
  import "../styles/global.css";
</script>
```

Wait — Astro imports CSS differently. The CSS import should be in the frontmatter or via a `<style>` tag. Let me fix:

Create `src/layouts/Layout.astro`:

```astro
---
import Nav from '../components/Nav.astro';
import Footer from '../components/Footer.astro';
import '../styles/global.css';

interface Props {
  title: string;
  description?: string;
}

const { title, description = "Bangalore's Favorite Board Gaming Community" } = Astro.props;
---

<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="description" content={description} />
    <title>{title} — Board Game Company</title>
    <link rel="icon" type="image/png" href="/bgc-logo.png" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@400;500;600;700&display=swap"
      rel="stylesheet"
    />
  </head>
  <body class="bg-bg font-body text-secondary min-h-screen flex flex-col">
    <Nav />
    <main class="flex-1">
      <slot />
    </main>
    <Footer />
  </body>
</html>
```

- [ ] **Step 2: Create the navigation bar**

Create `src/components/Nav.astro`:

```astro
---
import MobileMenu from './MobileMenu.tsx';

const navLinks = [
  { label: 'Home', href: '/' },
  { label: 'Library', href: '/library' },
  { label: 'Guild Path', href: '/guild-path' },
  { label: 'Calendar', href: '/calendar' },
  { label: 'Register', href: '/register' },
];
---

<nav class="fixed top-0 left-0 right-0 z-50 bg-white/95 backdrop-blur-sm border-b border-border">
  <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
    <div class="flex items-center justify-between h-16">
      <!-- Logo -->
      <a href="/" class="flex items-center gap-2 no-underline">
        <img src="/bgc-logo.png" alt="BGC" class="h-9 w-9 rounded-full" />
        <span class="font-heading font-bold text-lg text-secondary hidden sm:inline">
          Board Game Company
        </span>
      </a>

      <!-- Desktop Links -->
      <div class="hidden md:flex items-center gap-6">
        {navLinks.map(link => (
          <a
            href={link.href}
            class="text-secondary/70 hover:text-primary font-medium text-sm transition-colors no-underline"
          >
            {link.label}
          </a>
        ))}
        <a
          href="https://instagram.com/boardgamecompany"
          target="_blank"
          rel="noopener noreferrer"
          class="bg-secondary text-white px-4 py-2 rounded-full font-heading font-semibold text-sm hover:bg-secondary/80 transition-colors no-underline"
        >
          Join Us
        </a>
      </div>

      <!-- Mobile Hamburger -->
      <MobileMenu client:load navLinks={navLinks} />
    </div>
  </div>
</nav>
```

- [ ] **Step 3: Create the mobile menu React island**

Create `src/components/MobileMenu.tsx`:

```tsx
import { useState } from 'react';

interface Props {
  navLinks: { label: string; href: string }[];
}

export default function MobileMenu({ navLinks }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <div className="md:hidden">
      <button
        onClick={() => setOpen(!open)}
        className="flex flex-col gap-1.5 p-2"
        aria-label="Toggle menu"
      >
        <span
          className={`block w-6 h-0.5 bg-secondary transition-transform ${open ? 'rotate-45 translate-y-2' : ''}`}
        />
        <span
          className={`block w-6 h-0.5 bg-secondary transition-opacity ${open ? 'opacity-0' : ''}`}
        />
        <span
          className={`block w-6 h-0.5 bg-secondary transition-transform ${open ? '-rotate-45 -translate-y-2' : ''}`}
        />
      </button>

      {open && (
        <div className="absolute top-16 left-0 right-0 bg-white border-b border-border shadow-lg">
          <div className="flex flex-col p-4 gap-3">
            {navLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="text-secondary/70 hover:text-primary font-medium text-sm py-2 no-underline"
                onClick={() => setOpen(false)}
              >
                {link.label}
              </a>
            ))}
            <a
              href="https://instagram.com/boardgamecompany"
              target="_blank"
              rel="noopener noreferrer"
              className="bg-secondary text-white px-4 py-2 rounded-full font-heading font-semibold text-sm text-center no-underline mt-2"
            >
              Join Us
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Create the footer**

Create `src/components/Footer.astro`:

```astro
---
const quickLinks = [
  { label: 'Home', href: '/' },
  { label: 'Library', href: '/library' },
  { label: 'Guild Path', href: '/guild-path' },
  { label: 'Calendar', href: '/calendar' },
  { label: 'Register', href: '/register' },
];
---

<footer class="bg-secondary text-white/80 mt-16">
  <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
    <div class="grid grid-cols-1 md:grid-cols-4 gap-8">
      <!-- Brand -->
      <div class="md:col-span-1">
        <div class="flex items-center gap-2 mb-3">
          <img src="/bgc-logo.png" alt="BGC" class="h-10 w-10 rounded-full" />
          <span class="font-heading font-bold text-white text-lg">BGC</span>
        </div>
        <p class="text-sm text-white/60">Bringing people together over board games.</p>
        <p class="text-sm text-white/40 mt-2">Based in Bangalore, India</p>
      </div>

      <!-- Quick Links -->
      <div>
        <h4 class="font-heading font-semibold text-white mb-3 text-sm uppercase tracking-wide">Pages</h4>
        <div class="flex flex-col gap-2">
          {quickLinks.map(link => (
            <a href={link.href} class="text-sm text-white/60 hover:text-primary transition-colors no-underline">
              {link.label}
            </a>
          ))}
        </div>
      </div>

      <!-- Contact -->
      <div>
        <h4 class="font-heading font-semibold text-white mb-3 text-sm uppercase tracking-wide">Contact</h4>
        <div class="flex flex-col gap-2 text-sm">
          <a href="https://instagram.com/boardgamecompany" target="_blank" rel="noopener noreferrer" class="text-white/60 hover:text-primary transition-colors no-underline">
            Instagram @boardgamecompany
          </a>
          <a href="https://wa.me/919982200768" target="_blank" rel="noopener noreferrer" class="text-white/60 hover:text-primary transition-colors no-underline">
            WhatsApp +91 99822 00768
          </a>
          <a href="mailto:hello@boardgamecompany.in" class="text-white/60 hover:text-primary transition-colors no-underline">
            hello@boardgamecompany.in
          </a>
        </div>
      </div>

      <!-- Associated Events -->
      <div>
        <h4 class="font-heading font-semibold text-white mb-3 text-sm uppercase tracking-wide">Our Events</h4>
        <div class="flex flex-col gap-2 text-sm">
          <a href="https://replaycon.in" target="_blank" rel="noopener noreferrer" class="text-white/60 hover:text-primary transition-colors no-underline">
            REPLAY Convention
          </a>
          <a href="https://ttrpgcon.in" target="_blank" rel="noopener noreferrer" class="text-white/60 hover:text-primary transition-colors no-underline">
            TTRPGcon
          </a>
        </div>
      </div>
    </div>

    <div class="border-t border-white/10 mt-8 pt-6 text-center text-xs text-white/40">
      &copy; {new Date().getFullYear()} Board Game Company. All rights reserved.
    </div>
  </div>
</footer>
```

- [ ] **Step 5: Verify the layout renders**

Create a minimal `src/pages/index.astro` to test:

```astro
---
import Layout from '../layouts/Layout.astro';
---

<Layout title="Home">
  <div class="pt-24 px-4 text-center">
    <h1 class="font-heading text-4xl font-bold">Board Game Company</h1>
    <p class="mt-2 text-muted">Site under construction</p>
  </div>
</Layout>
```

Run: `npm run dev`
Expected: Site loads at localhost:4321 with nav bar, placeholder content, and footer.

- [ ] **Step 6: Commit**

```bash
git add src/layouts/ src/components/Nav.astro src/components/MobileMenu.tsx src/components/Footer.astro src/pages/index.astro
git commit -m "feat: add base layout with nav bar and footer"
```

---

## Task 5: Landing Page

**Files:**
- Modify: `src/pages/index.astro`
- Create: `src/components/UpcomingEventBanner.tsx`

- [ ] **Step 1: Build the full landing page (static sections)**

Replace `src/pages/index.astro`:

```astro
---
import Layout from '../layouts/Layout.astro';
import UpcomingEventBanner from '../components/UpcomingEventBanner.tsx';
---

<Layout title="Home" description="Bangalore's Favorite Board Gaming Community — board game sessions at cafes across the city">

  <!-- Hero -->
  <section class="pt-24 pb-12 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
    <div class="flex flex-col lg:flex-row items-center gap-10 lg:gap-16">
      <div class="flex-1 text-center lg:text-left">
        <h1 class="font-heading text-4xl sm:text-5xl lg:text-6xl font-bold leading-tight">
          Welcome to<br />
          <span class="text-primary">Board Game Company!</span>
        </h1>
        <p class="mt-4 text-muted text-lg max-w-lg mx-auto lg:mx-0">
          Our mission is to create a community that brings people together over board games. Currently hosting in Bangalore.
        </p>
        <div class="mt-6 flex flex-wrap gap-3 justify-center lg:justify-start">
          <a
            href="/calendar"
            class="bg-primary text-white px-6 py-3 rounded-full font-heading font-semibold hover:bg-primary-dark transition-colors no-underline"
          >
            Register for a Session
          </a>
          <a
            href="https://instagram.com/boardgamecompany"
            target="_blank"
            rel="noopener noreferrer"
            class="bg-secondary text-white px-6 py-3 rounded-full font-heading font-semibold hover:bg-secondary/80 transition-colors no-underline"
          >
            Follow Us
          </a>
        </div>
      </div>
      <div class="flex-1 max-w-md lg:max-w-lg">
        <!-- Photo collage placeholder — replace with actual community photos -->
        <div class="grid grid-cols-3 gap-2 rounded-2xl overflow-hidden">
          <div class="bg-primary/10 aspect-square rounded-lg"></div>
          <div class="bg-primary/20 aspect-square rounded-lg"></div>
          <div class="bg-primary/10 aspect-square rounded-lg"></div>
          <div class="bg-primary/20 aspect-square rounded-lg"></div>
          <div class="bg-primary/10 aspect-square rounded-lg"></div>
          <div class="bg-primary/20 aspect-square rounded-lg"></div>
        </div>
      </div>
    </div>
  </section>

  <!-- Upcoming Event Banner -->
  <section class="px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto pb-12">
    <UpcomingEventBanner client:load />
  </section>

  <!-- What We Do -->
  <section class="px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto py-12">
    <h2 class="font-heading text-3xl font-bold text-center mb-8">What We Do</h2>
    <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
      <div class="bg-white rounded-2xl p-6 border border-border text-center">
        <div class="text-4xl mb-3">🎲</div>
        <h3 class="font-heading font-bold text-lg mb-2">Game Sessions</h3>
        <p class="text-muted text-sm">
          We host board game sessions at cafes and restaurants across Bangalore. Come play, meet new people, and have fun.
        </p>
      </div>
      <div class="bg-white rounded-2xl p-6 border border-border text-center">
        <div class="text-4xl mb-3">📚</div>
        <h3 class="font-heading font-bold text-lg mb-2">130+ Games</h3>
        <p class="text-muted text-sm">
          From quick party games to deep strategy epics — our library has something for everyone.
        </p>
      </div>
      <div class="bg-white rounded-2xl p-6 border border-border text-center">
        <div class="text-4xl mb-3">🤝</div>
        <h3 class="font-heading font-bold text-lg mb-2">Growing Community</h3>
        <p class="text-muted text-sm">
          Join a welcoming group of board game enthusiasts who love sharing great games.
        </p>
      </div>
    </div>
  </section>

  <!-- Guild Path Teaser -->
  <section class="px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto py-12">
    <div class="bg-white rounded-2xl border border-border p-8 md:p-12 flex flex-col md:flex-row items-center gap-6">
      <div class="flex-1">
        <h2 class="font-heading text-3xl font-bold mb-2">Guild Path</h2>
        <p class="text-muted">
          Track your progress and level up through the BGC ranks. Get discounts, free events, and exclusive perks.
        </p>
      </div>
      <a
        href="/guild-path"
        class="bg-accent text-white px-6 py-3 rounded-full font-heading font-semibold hover:bg-accent/80 transition-colors no-underline whitespace-nowrap"
      >
        Explore Guild Path
      </a>
    </div>
  </section>

  <!-- Associated Events -->
  <section class="px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto py-12">
    <h2 class="font-heading text-2xl font-bold text-center mb-6">We Also Run</h2>
    <div class="flex flex-wrap justify-center gap-6">
      <a
        href="https://replaycon.in"
        target="_blank"
        rel="noopener noreferrer"
        class="bg-white rounded-2xl border border-border px-8 py-6 font-heading font-bold text-xl hover:border-primary transition-colors no-underline text-secondary"
      >
        REPLAY Convention
      </a>
      <a
        href="https://ttrpgcon.in"
        target="_blank"
        rel="noopener noreferrer"
        class="bg-white rounded-2xl border border-border px-8 py-6 font-heading font-bold text-xl hover:border-primary transition-colors no-underline text-secondary"
      >
        TTRPGcon
      </a>
    </div>
  </section>

</Layout>
```

- [ ] **Step 2: Create the Upcoming Event Banner React island**

Create `src/components/UpcomingEventBanner.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Event } from '../lib/types';

export default function UpcomingEventBanner() {
  const [event, setEvent] = useState<Event | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchNext() {
      const { data } = await supabase
        .from('events')
        .select('*')
        .gte('date', new Date().toISOString())
        .order('date', { ascending: true })
        .limit(1)
        .single();

      setEvent(data);
      setLoading(false);
    }
    fetchNext();
  }, []);

  if (loading || !event) return null;

  const eventDate = new Date(event.date);
  const dateStr = eventDate.toLocaleDateString('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  const timeStr = eventDate.toLocaleTimeString('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  return (
    <div className="bg-highlight/30 border border-highlight rounded-2xl p-6 flex flex-col sm:flex-row items-start sm:items-center gap-4">
      <div className="flex-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-primary mb-1">
          Next Event
        </p>
        <h3 className="font-heading font-bold text-xl">{event.name}</h3>
        <p className="text-muted text-sm mt-1">
          {dateStr} at {timeStr} &middot; {event.venue_name}, {event.venue_area} &middot; ₹{event.price}
        </p>
      </div>
      <a
        href={`/register?event=${event.id}`}
        className="bg-primary text-white px-5 py-2.5 rounded-full font-heading font-semibold text-sm hover:bg-primary-dark transition-colors no-underline whitespace-nowrap"
      >
        Register
      </a>
    </div>
  );
}
```

- [ ] **Step 3: Verify landing page in browser**

Run: `npm run dev`
Expected: Landing page renders with hero, what-we-do cards, guild path teaser, and associated events. The upcoming event banner will only show if there's an event in Supabase (fine to be hidden for now).

- [ ] **Step 4: Commit**

```bash
git add src/pages/index.astro src/components/UpcomingEventBanner.tsx
git commit -m "feat: build landing page with hero, sections, and upcoming event banner"
```

---

## Task 6: Board Game Library Page

**Files:**
- Create: `src/pages/library.astro`
- Create: `src/components/GameLibrary.tsx`

- [ ] **Step 1: Create the library Astro page**

Create `src/pages/library.astro`:

```astro
---
import Layout from '../layouts/Layout.astro';
import GameLibrary from '../components/GameLibrary.tsx';
---

<Layout title="Library" description="Browse our collection of 130+ board games">
  <section class="pt-24 pb-12 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
    <div class="text-center mb-8">
      <h1 class="font-heading text-4xl font-bold">Our Library</h1>
      <p class="mt-2 text-muted text-lg">Browse our collection of 130+ board games</p>
    </div>
    <GameLibrary client:load />
  </section>
</Layout>
```

- [ ] **Step 2: Create the GameLibrary React island**

Create `src/components/GameLibrary.tsx`:

```tsx
import { useEffect, useState, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import type { Game } from '../lib/types';

const COMPLEXITY_COLORS: Record<string, string> = {
  Light: 'bg-green-100 text-green-800',
  Medium: 'bg-yellow-100 text-yellow-800',
  Heavy: 'bg-red-100 text-red-800',
};

export default function GameLibrary() {
  const [games, setGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [playerFilter, setPlayerFilter] = useState('');
  const [complexityFilter, setComplexityFilter] = useState('');
  const [lengthFilter, setLengthFilter] = useState('');

  useEffect(() => {
    async function fetchGames() {
      const { data } = await supabase
        .from('games')
        .select('id, title, player_count, max_players, avg_rating, weight, complexity, play_time, max_play_time, length')
        .order('title');

      setGames(data || []);
      setLoading(false);
    }
    fetchGames();
  }, []);

  const filtered = useMemo(() => {
    return games.filter((game) => {
      if (search && !game.title.toLowerCase().includes(search.toLowerCase())) {
        return false;
      }
      if (playerFilter) {
        const count = parseInt(playerFilter, 10);
        if (game.max_players < count) return false;
      }
      if (complexityFilter && game.complexity !== complexityFilter) {
        return false;
      }
      if (lengthFilter && game.length !== lengthFilter) {
        return false;
      }
      return true;
    });
  }, [games, search, playerFilter, complexityFilter, lengthFilter]);

  const hasFilters = search || playerFilter || complexityFilter || lengthFilter;

  function clearFilters() {
    setSearch('');
    setPlayerFilter('');
    setComplexityFilter('');
    setLengthFilter('');
  }

  if (loading) {
    return (
      <div className="text-center py-12 text-muted">Loading games...</div>
    );
  }

  return (
    <div>
      {/* Filter Bar */}
      <div className="sticky top-16 z-40 bg-bg/95 backdrop-blur-sm py-4 -mx-4 px-4 border-b border-border mb-6">
        <div className="flex flex-wrap gap-3 items-center">
          <input
            type="text"
            placeholder="Search games..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 min-w-[200px] px-4 py-2 rounded-xl border border-border bg-white text-sm focus:outline-none focus:border-primary"
          />
          <select
            value={playerFilter}
            onChange={(e) => setPlayerFilter(e.target.value)}
            className="px-3 py-2 rounded-xl border border-border bg-white text-sm focus:outline-none focus:border-primary"
          >
            <option value="">Players</option>
            <option value="2">2+</option>
            <option value="4">4+</option>
            <option value="6">6+</option>
            <option value="8">8+</option>
          </select>
          <select
            value={complexityFilter}
            onChange={(e) => setComplexityFilter(e.target.value)}
            className="px-3 py-2 rounded-xl border border-border bg-white text-sm focus:outline-none focus:border-primary"
          >
            <option value="">Complexity</option>
            <option value="Light">Light</option>
            <option value="Medium">Medium</option>
            <option value="Heavy">Heavy</option>
          </select>
          <select
            value={lengthFilter}
            onChange={(e) => setLengthFilter(e.target.value)}
            className="px-3 py-2 rounded-xl border border-border bg-white text-sm focus:outline-none focus:border-primary"
          >
            <option value="">Play Time</option>
            <option value="Quick">Quick (&lt;30 min)</option>
            <option value="Medium">Medium (30-60 min)</option>
            <option value="Long">Long (60+ min)</option>
          </select>
          {hasFilters && (
            <button
              onClick={clearFilters}
              className="text-sm text-primary hover:underline"
            >
              Clear all
            </button>
          )}
        </div>
        <p className="text-xs text-muted mt-2">
          Showing {filtered.length} of {games.length} games
        </p>
      </div>

      {/* Game Grid */}
      {filtered.length === 0 ? (
        <div className="text-center py-12 text-muted">
          No games match your filters. Try adjusting your search.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map((game) => (
            <div
              key={game.id}
              className="bg-white rounded-xl border border-border p-4 hover:border-primary/50 transition-colors"
            >
              <h3 className="font-heading font-bold text-base mb-2 leading-tight">
                {game.title}
              </h3>
              <div className="flex flex-wrap gap-2 text-xs text-muted">
                <span>👥 {game.player_count}</span>
                <span>⏱ {game.play_time} min</span>
                {game.avg_rating && <span>⭐ {game.avg_rating.toFixed(1)}</span>}
              </div>
              {game.complexity && (
                <span
                  className={`inline-block mt-2 px-2 py-0.5 rounded-full text-xs font-medium ${COMPLEXITY_COLORS[game.complexity] || 'bg-gray-100 text-gray-800'}`}
                >
                  {game.complexity}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verify in browser**

Run: `npm run dev`, navigate to `/library`.
Expected: Page renders with filter bar and game grid. If Supabase has games, they appear. If not, shows "Loading..." then empty state.

- [ ] **Step 4: Commit**

```bash
git add src/pages/library.astro src/components/GameLibrary.tsx
git commit -m "feat: add board game library page with search and filters"
```

---

## Task 7: Guild Path Page

**Files:**
- Create: `src/pages/guild-path.astro`

- [ ] **Step 1: Create the fully static Guild Path page**

Create `src/pages/guild-path.astro`:

```astro
---
import Layout from '../layouts/Layout.astro';

const tiers = [
  {
    name: 'Initiate',
    price: '₹600',
    period: '3 months',
    color: 'bg-accent',
    textColor: 'text-white',
    badge: null,
    benefits: [
      'Flat 20% off every event',
      'Flat 10% off for one tag along',
      'Early access to all events',
      'Exclusive Guild Path only events',
      'Valid for 3 months',
    ],
    note: 'Free if you\'ve attended 10+ events in the last year',
  },
  {
    name: 'Adventurer',
    price: '₹2,000',
    period: '3 months',
    color: 'bg-primary',
    textColor: 'text-white',
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
    name: 'Guildmaster',
    price: '₹8,000',
    period: '12 months',
    color: 'bg-secondary',
    textColor: 'text-white',
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
---

<Layout title="Guild Path" description="Our loyalty and membership plans — level up your BGC experience">
  <section class="pt-24 pb-12 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
    <div class="text-center mb-10">
      <h1 class="font-heading text-4xl font-bold">Guild Path</h1>
      <p class="mt-2 text-muted text-lg">Our loyalty and membership plans</p>
    </div>

    <!-- Tier Cards -->
    <div class="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto">
      {tiers.map((tier) => (
        <div class={`${tier.color} ${tier.textColor} rounded-2xl p-6 flex flex-col relative`}>
          {tier.badge && (
            <span class="absolute top-4 right-4 bg-highlight text-secondary text-xs font-bold px-3 py-1 rounded-full">
              {tier.badge}
            </span>
          )}
          <h3 class="font-heading text-2xl font-bold mb-4">{tier.name}</h3>
          <p class="font-heading font-bold text-sm uppercase tracking-wide mb-3 opacity-80">Benefits</p>
          <ul class="flex-1 space-y-2 mb-6">
            {tier.benefits.map((benefit) => (
              <li class="flex items-start gap-2 text-sm">
                <span class="mt-0.5 opacity-60">•</span>
                <span>{benefit}</span>
              </li>
            ))}
          </ul>
          {tier.note && (
            <div class="bg-white/20 rounded-lg px-3 py-2 text-xs mb-4">
              {tier.note}
            </div>
          )}
          <div class="border-t border-white/20 pt-4">
            <span class="font-heading text-3xl font-bold">{tier.price}</span>
            <span class="text-sm opacity-70 ml-1">/ {tier.period}</span>
          </div>
        </div>
      ))}
    </div>

    <!-- Fine Print -->
    <p class="text-center text-muted text-sm mt-8 max-w-2xl mx-auto">
      All tiers are applicable for a maximum ticket price of ₹1,000 per event and are inclusive of cover charges.
    </p>

    <!-- CTA -->
    <div class="text-center mt-10">
      <a
        href="https://wa.me/919982200768?text=Hi!%20I'm%20interested%20in%20the%20Guild%20Path%20membership."
        target="_blank"
        rel="noopener noreferrer"
        class="bg-primary text-white px-8 py-3 rounded-full font-heading font-semibold text-lg hover:bg-primary-dark transition-colors no-underline inline-block"
      >
        Interested? Get in touch
      </a>
    </div>
  </section>
</Layout>
```

- [ ] **Step 2: Verify in browser**

Run: `npm run dev`, navigate to `/guild-path`.
Expected: Three tier cards with correct colors (sage, orange, black), benefits, pricing, badges, fine print, and WhatsApp CTA.

- [ ] **Step 3: Commit**

```bash
git add src/pages/guild-path.astro
git commit -m "feat: add Guild Path membership tiers page"
```

---

## Task 8: Events Calendar Page

**Files:**
- Create: `src/pages/calendar.astro`
- Create: `src/components/EventList.tsx`

- [ ] **Step 1: Create the calendar Astro page**

Create `src/pages/calendar.astro`:

```astro
---
import Layout from '../layouts/Layout.astro';
import EventList from '../components/EventList.tsx';
---

<Layout title="Calendar" description="Find your next board gaming session in Bangalore">
  <section class="pt-24 pb-12 px-4 sm:px-6 lg:px-8 max-w-3xl mx-auto">
    <div class="text-center mb-8">
      <h1 class="font-heading text-4xl font-bold">Upcoming Events</h1>
      <p class="mt-2 text-muted text-lg">Find your next session</p>
    </div>
    <EventList client:load />
  </section>
</Layout>
```

- [ ] **Step 2: Create the EventList React island**

Create `src/components/EventList.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Event } from '../lib/types';

const WORKER_URL = import.meta.env.PUBLIC_WORKER_URL;

interface EventWithSpots extends Event {
  remaining: number | null;
}

export default function EventList() {
  const [events, setEvents] = useState<EventWithSpots[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchEvents() {
      const { data } = await supabase
        .from('events')
        .select('*')
        .gte('date', new Date().toISOString())
        .order('date', { ascending: true });

      if (!data || data.length === 0) {
        setEvents([]);
        setLoading(false);
        return;
      }

      // Fetch spots for each event
      const eventsWithSpots = await Promise.all(
        data.map(async (event: Event) => {
          try {
            const res = await fetch(`${WORKER_URL}/api/event-spots/${event.id}`);
            const spots = await res.json();
            return { ...event, remaining: spots.remaining };
          } catch {
            return { ...event, remaining: null };
          }
        })
      );

      setEvents(eventsWithSpots);
      setLoading(false);
    }
    fetchEvents();
  }, []);

  if (loading) {
    return <div className="text-center py-12 text-muted">Loading events...</div>;
  }

  if (events.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-muted text-lg mb-4">No upcoming events right now.</p>
        <a
          href="https://instagram.com/boardgamecompany"
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:underline font-medium"
        >
          Follow us on Instagram to stay updated!
        </a>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {events.map((event) => {
        const eventDate = new Date(event.date);
        const day = eventDate.getDate();
        const month = eventDate.toLocaleDateString('en-IN', { month: 'short' }).toUpperCase();
        const weekday = eventDate.toLocaleDateString('en-IN', { weekday: 'long' });
        const time = eventDate.toLocaleTimeString('en-IN', {
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
        });
        const soldOut = event.remaining !== null && event.remaining <= 0;

        return (
          <div
            key={event.id}
            className="bg-white rounded-2xl border border-border p-5 flex gap-5 items-start"
          >
            {/* Date block */}
            <div className="text-center min-w-[60px]">
              <div className="text-xs font-bold text-primary uppercase">{month}</div>
              <div className="font-heading text-3xl font-bold leading-tight">{day}</div>
              <div className="text-xs text-muted">{weekday}</div>
            </div>

            {/* Details */}
            <div className="flex-1">
              <h3 className="font-heading font-bold text-lg">{event.name}</h3>
              <p className="text-sm text-muted mt-1">
                {time} &middot; {event.venue_name}, {event.venue_area}
              </p>
              {event.description && (
                <p className="text-sm text-muted mt-2">{event.description}</p>
              )}
              <div className="flex items-center gap-3 mt-3">
                <span className="font-heading font-bold text-lg">₹{event.price}</span>
                {event.remaining !== null && !soldOut && (
                  <span className="text-xs text-muted">
                    {event.remaining} spot{event.remaining !== 1 ? 's' : ''} left
                  </span>
                )}
              </div>
            </div>

            {/* Action */}
            <div className="flex-shrink-0 self-center">
              {soldOut ? (
                <span className="bg-gray-200 text-gray-500 px-4 py-2 rounded-full text-sm font-semibold">
                  Sold Out
                </span>
              ) : (
                <a
                  href={`/register?event=${event.id}`}
                  className="bg-primary text-white px-5 py-2.5 rounded-full font-heading font-semibold text-sm hover:bg-primary-dark transition-colors no-underline"
                >
                  Register
                </a>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 3: Verify in browser**

Run: `npm run dev`, navigate to `/calendar`.
Expected: Shows loading then either event cards or "No upcoming events" message.

- [ ] **Step 4: Commit**

```bash
git add src/pages/calendar.astro src/components/EventList.tsx
git commit -m "feat: add events calendar page with spots remaining"
```

---

## Task 9: Cloudflare Worker Setup and Router

**Files:**
- Create: `worker/package.json`
- Create: `worker/tsconfig.json`
- Create: `worker/wrangler.toml`
- Create: `worker/src/index.ts`
- Create: `worker/src/supabase.ts`

- [ ] **Step 1: Initialize the Worker project**

```bash
mkdir -p /Users/siddhantnarula/Projects/bgc-website/worker/src
```

Create `worker/package.json`:

```json
{
  "name": "bgc-worker",
  "private": true,
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.49.0"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20250410.0",
    "wrangler": "^4.0.0",
    "typescript": "^5.7.0"
  }
}
```

Create `worker/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "types": ["@cloudflare/workers-types"],
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*.ts"]
}
```

Create `worker/wrangler.toml`:

```toml
name = "bgc-api"
main = "src/index.ts"
compatibility_date = "2025-04-01"

[vars]
SUPABASE_URL = ""

# Set secrets via: wrangler secret put SUPABASE_SERVICE_KEY
```

- [ ] **Step 2: Create the server-side Supabase client**

Create `worker/src/supabase.ts`:

```ts
import { createClient } from '@supabase/supabase-js';

export function getSupabase(env: { SUPABASE_URL: string; SUPABASE_SERVICE_KEY: string }) {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);
}
```

- [ ] **Step 3: Create the Worker router with CORS**

Create `worker/src/index.ts`:

```ts
import { handleLookupPhone } from './lookup-phone';
import { handleRegister } from './register';
import { handleEventSpots } from './event-spots';

export interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
}

function corsHeaders(origin: string | null): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
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
        response = await handleRegister(request, env);
      } else if (url.pathname.startsWith('/api/event-spots/') && request.method === 'GET') {
        const eventId = url.pathname.split('/api/event-spots/')[1];
        response = await handleEventSpots(eventId, env);
      } else {
        response = new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
      }

      // Add CORS headers to response
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

- [ ] **Step 4: Install Worker dependencies**

```bash
cd /Users/siddhantnarula/Projects/bgc-website/worker && npm install
```

- [ ] **Step 5: Commit**

```bash
cd /Users/siddhantnarula/Projects/bgc-website
git add worker/package.json worker/tsconfig.json worker/wrangler.toml worker/src/index.ts worker/src/supabase.ts
git commit -m "feat: scaffold Cloudflare Worker with router and CORS"
```

---

## Task 10: Worker — Lookup Phone Endpoint

**Files:**
- Create: `worker/src/lookup-phone.ts`
- Create: `worker/src/validation.ts`

- [ ] **Step 1: Create validation helpers**

Create `worker/src/validation.ts`:

```ts
export function sanitizePhone(phone: string): string | null {
  const cleaned = phone.replace(/[\s\-\(\)]/g, '');
  // Indian mobile: 10 digits or +91 prefix
  const match = cleaned.match(/^(?:\+?91)?(\d{10})$/);
  return match ? match[1] : null;
}

export function sanitizeEmail(email: string): string | null {
  const trimmed = email.trim().toLowerCase();
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
  return valid ? trimmed : null;
}

export function sanitizeName(name: string): string | null {
  const trimmed = name.trim();
  return trimmed.length >= 1 && trimmed.length <= 200 ? trimmed : null;
}

export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
```

- [ ] **Step 2: Create the lookup-phone handler**

Create `worker/src/lookup-phone.ts`:

```ts
import type { Env } from './index';
import { getSupabase } from './supabase';
import { sanitizePhone, jsonResponse } from './validation';

export async function handleLookupPhone(request: Request, env: Env): Promise<Response> {
  const body = await request.json<{ phone: string }>();
  const phone = sanitizePhone(body.phone || '');

  if (!phone) {
    return jsonResponse({ error: 'Invalid phone number' }, 400);
  }

  const supabase = getSupabase(env);

  // Parallel lookups: user + guild membership
  const [userResult, memberResult] = await Promise.all([
    supabase
      .from('users')
      .select('name, email')
      .eq('phone', phone)
      .maybeSingle(),
    supabase
      .from('guild_members')
      .select('tier, expires_at')
      .eq('phone', phone)
      .gte('expires_at', new Date().toISOString().split('T')[0])
      .maybeSingle(),
  ]);

  const user = userResult.data;
  const member = memberResult.data;

  let discount: string | null = null;
  if (member) {
    if (member.tier === 'adventurer' || member.tier === 'guildmaster') {
      discount = 'free';
    } else if (member.tier === 'initiate') {
      discount = '20';
    }
  }

  return jsonResponse({
    user: {
      found: !!user,
      name: user?.name || null,
      email: user?.email || null,
    },
    membership: {
      isMember: !!member,
      tier: member?.tier || null,
      discount,
    },
  });
}
```

- [ ] **Step 3: Verify Worker runs locally**

```bash
cd /Users/siddhantnarula/Projects/bgc-website/worker
npx wrangler dev
```

Test with curl (will return error since no Supabase configured, but verifies routing):
```bash
curl -X POST http://localhost:8787/api/lookup-phone -H "Content-Type: application/json" -d '{"phone":"9876543210"}'
```

- [ ] **Step 4: Commit**

```bash
cd /Users/siddhantnarula/Projects/bgc-website
git add worker/src/lookup-phone.ts worker/src/validation.ts
git commit -m "feat: add phone lookup endpoint with user and membership check"
```

---

## Task 11: Worker — Event Spots Endpoint

**Files:**
- Create: `worker/src/event-spots.ts`

- [ ] **Step 1: Create the event-spots handler**

Create `worker/src/event-spots.ts`:

```ts
import type { Env } from './index';
import { getSupabase } from './supabase';
import { jsonResponse } from './validation';

export async function handleEventSpots(eventId: string, env: Env): Promise<Response> {
  if (!eventId) {
    return jsonResponse({ error: 'Missing event ID' }, 400);
  }

  const supabase = getSupabase(env);

  // Fetch event capacity and all registrations in parallel
  const [eventResult, regsResult] = await Promise.all([
    supabase
      .from('events')
      .select('capacity, custom_questions')
      .eq('id', eventId)
      .single(),
    supabase
      .from('registrations')
      .select('seats, custom_answers')
      .eq('event_id', eventId)
      .eq('payment_status', 'confirmed'),
  ]);

  if (!eventResult.data) {
    return jsonResponse({ error: 'Event not found' }, 404);
  }

  const capacity = eventResult.data.capacity;
  const registrations = regsResult.data || [];

  const registered = registrations.reduce((sum, r) => sum + r.seats, 0);
  const remaining = Math.max(0, capacity - registered);

  // Count per-option selections for capacity-limited custom questions
  const optionCounts: Record<string, Record<string, number>> = {};
  const customQuestions = eventResult.data.custom_questions as Array<{
    id: string;
    options?: Array<{ value: string; capacity?: number }>;
  }> | null;

  if (customQuestions) {
    for (const q of customQuestions) {
      const hasCapacity = q.options?.some((o) => o.capacity !== undefined);
      if (!hasCapacity) continue;

      optionCounts[q.id] = {};
      for (const reg of registrations) {
        const answers = reg.custom_answers as Record<string, string> | null;
        if (answers && answers[q.id]) {
          const val = answers[q.id];
          optionCounts[q.id][val] = (optionCounts[q.id][val] || 0) + reg.seats;
        }
      }
    }
  }

  return jsonResponse({ capacity, registered, remaining, option_counts: optionCounts });
}
```

- [ ] **Step 2: Commit**

```bash
git add worker/src/event-spots.ts
git commit -m "feat: add event spots endpoint with per-option capacity counts"
```

---

## Task 12: Worker — Register Endpoint

**Files:**
- Create: `worker/src/register.ts`

- [ ] **Step 1: Create the registration handler**

Create `worker/src/register.ts`:

```ts
import type { Env } from './index';
import { getSupabase } from './supabase';
import { sanitizePhone, sanitizeEmail, sanitizeName, jsonResponse } from './validation';

export async function handleRegister(request: Request, env: Env): Promise<Response> {
  const body = await request.json<{
    event_id: string;
    name: string;
    phone: string;
    email: string;
    seats: number;
    custom_answers: Record<string, string | boolean>;
    payment_status: 'pending' | 'confirmed';
  }>();

  // Validate inputs
  const phone = sanitizePhone(body.phone || '');
  if (!phone) return jsonResponse({ error: 'Invalid phone number' }, 400);

  const name = sanitizeName(body.name || '');
  if (!name) return jsonResponse({ error: 'Invalid name' }, 400);

  const email = sanitizeEmail(body.email || '');
  if (!email) return jsonResponse({ error: 'Invalid email' }, 400);

  const seats = Math.floor(body.seats);
  if (seats < 1 || seats > 20) return jsonResponse({ error: 'Invalid seat count' }, 400);

  if (!body.event_id) return jsonResponse({ error: 'Missing event ID' }, 400);
  if (!['pending', 'confirmed'].includes(body.payment_status)) {
    return jsonResponse({ error: 'Invalid payment status' }, 400);
  }

  const supabase = getSupabase(env);

  // Fetch event
  const { data: event } = await supabase
    .from('events')
    .select('*')
    .eq('id', body.event_id)
    .eq('is_published', true)
    .single();

  if (!event) return jsonResponse({ error: 'Event not found' }, 404);

  // Check spots remaining
  const { data: regs } = await supabase
    .from('registrations')
    .select('seats')
    .eq('event_id', body.event_id)
    .eq('payment_status', 'confirmed');

  const registered = (regs || []).reduce((sum, r) => sum + r.seats, 0);
  const remaining = event.capacity - registered;

  if (seats > remaining) {
    return jsonResponse({ error: `Only ${remaining} spots remaining` }, 400);
  }

  // Validate custom questions
  const customQuestions = (event.custom_questions || []) as Array<{
    id: string;
    label: string;
    type: string;
    required: boolean;
    options?: Array<{ value: string; capacity?: number }>;
  }>;

  const customAnswers = body.custom_answers || {};

  for (const q of customQuestions) {
    const answer = customAnswers[q.id];
    if (q.required && (answer === undefined || answer === null || answer === '')) {
      return jsonResponse({ error: `"${q.label}" is required` }, 400);
    }

    // Check per-option capacity
    if (answer && q.options) {
      const option = q.options.find((o) => o.value === answer);
      if (q.type !== 'checkbox' && q.type !== 'text' && !option) {
        return jsonResponse({ error: `Invalid option for "${q.label}"` }, 400);
      }
      if (option?.capacity !== undefined) {
        const { data: allRegs } = await supabase
          .from('registrations')
          .select('seats, custom_answers')
          .eq('event_id', body.event_id)
          .eq('payment_status', 'confirmed');

        const optionCount = (allRegs || []).reduce((sum, r) => {
          const a = r.custom_answers as Record<string, string> | null;
          return a && a[q.id] === answer ? sum + r.seats : sum;
        }, 0);

        if (optionCount + seats > option.capacity) {
          return jsonResponse({ error: `"${option.value}" is full` }, 400);
        }
      }
    }
  }

  // Check Guild Path membership and calculate total
  const { data: member } = await supabase
    .from('guild_members')
    .select('tier, expires_at')
    .eq('phone', phone)
    .gte('expires_at', new Date().toISOString().split('T')[0])
    .maybeSingle();

  let totalAmount = event.price * seats;
  let discountApplied: string | null = null;

  if (member) {
    if (member.tier === 'adventurer' || member.tier === 'guildmaster') {
      totalAmount = 0;
      discountApplied = member.tier;
    } else if (member.tier === 'initiate') {
      totalAmount = Math.round(totalAmount * 0.8);
      discountApplied = 'initiate';
    }
  }

  // Insert registration
  const { data: registration, error: regError } = await supabase
    .from('registrations')
    .insert({
      event_id: body.event_id,
      name,
      phone,
      email,
      seats,
      total_amount: totalAmount,
      discount_applied: discountApplied,
      custom_answers: customAnswers,
      payment_status: body.payment_status,
    })
    .select('id')
    .single();

  if (regError) {
    return jsonResponse({ error: 'Registration failed' }, 500);
  }

  // Upsert user record
  const { data: existingUser } = await supabase
    .from('users')
    .select('id')
    .eq('phone', phone)
    .maybeSingle();

  if (existingUser) {
    await supabase
      .from('users')
      .update({ name, email, last_registered_at: new Date().toISOString() })
      .eq('phone', phone);
  } else {
    await supabase
      .from('users')
      .insert({ phone, name, email });
  }

  return jsonResponse({ success: true, registration_id: registration.id });
}
```

- [ ] **Step 2: Commit**

```bash
git add worker/src/register.ts
git commit -m "feat: add registration endpoint with validation, discounts, and user upsert"
```

---

## Task 13: Registration Page — Form and Custom Questions

**Files:**
- Create: `src/pages/register.astro`
- Create: `src/components/RegistrationForm.tsx`
- Create: `src/components/CustomQuestion.tsx`

- [ ] **Step 1: Create the register Astro page**

Create `src/pages/register.astro`:

```astro
---
import Layout from '../layouts/Layout.astro';
import RegistrationForm from '../components/RegistrationForm.tsx';
---

<Layout title="Register" description="Register for an upcoming Board Game Company event">
  <section class="pt-24 pb-12 px-4 sm:px-6 lg:px-8 max-w-xl mx-auto">
    <RegistrationForm client:load />
  </section>
</Layout>
```

- [ ] **Step 2: Create the CustomQuestion component**

Create `src/components/CustomQuestion.tsx`:

```tsx
import type { CustomQuestion as CQ } from '../lib/types';

interface Props {
  question: CQ;
  value: string | boolean;
  onChange: (value: string | boolean) => void;
  optionCounts?: Record<string, number>;
}

export default function CustomQuestion({ question, value, onChange, optionCounts }: Props) {
  const { id, label, type, required, options } = question;

  function isOptionFull(optValue: string, capacity?: number): boolean {
    if (capacity === undefined || !optionCounts) return false;
    return (optionCounts[optValue] || 0) >= capacity;
  }

  return (
    <div className="mb-5">
      <label className="block font-semibold text-xs uppercase tracking-wide text-secondary/70 mb-2">
        {label} {required && <span className="text-error">*</span>}
      </label>

      {type === 'text' && (
        <input
          type="text"
          value={value as string}
          onChange={(e) => onChange(e.target.value)}
          className="w-full px-4 py-2.5 rounded-xl border border-border bg-white text-sm focus:outline-none focus:border-primary"
          required={required}
        />
      )}

      {type === 'select' && options && (
        <select
          value={value as string}
          onChange={(e) => onChange(e.target.value)}
          className="w-full px-4 py-2.5 rounded-xl border border-border bg-white text-sm focus:outline-none focus:border-primary"
          required={required}
        >
          <option value="">Select...</option>
          {options.map((opt) => {
            const full = isOptionFull(opt.value, opt.capacity);
            return (
              <option key={opt.value} value={opt.value} disabled={full}>
                {opt.value}{full ? ' (Full)' : ''}
              </option>
            );
          })}
        </select>
      )}

      {type === 'radio' && options && (
        <div className="flex flex-col gap-2">
          {options.map((opt) => {
            const full = isOptionFull(opt.value, opt.capacity);
            return (
              <label
                key={opt.value}
                className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                  value === opt.value
                    ? 'border-primary bg-primary/5'
                    : 'border-border'
                } ${full ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <input
                  type="radio"
                  name={id}
                  value={opt.value}
                  checked={value === opt.value}
                  onChange={() => onChange(opt.value)}
                  disabled={full}
                  className="accent-primary"
                />
                <span className="text-sm">
                  {opt.value}
                  {opt.capacity !== undefined && (
                    <span className="text-muted ml-1">
                      {full ? '(Full)' : `(${opt.capacity - (optionCounts?.[opt.value] || 0)} spots)`}
                    </span>
                  )}
                </span>
              </label>
            );
          })}
        </div>
      )}

      {type === 'checkbox' && (
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={value as boolean}
            onChange={(e) => onChange(e.target.checked)}
            className="accent-primary w-4 h-4"
          />
          <span className="text-sm">{label}</span>
        </label>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Create the RegistrationForm React island**

Create `src/components/RegistrationForm.tsx`:

```tsx
import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { Event, PhoneLookupResponse, EventSpots } from '../lib/types';
import CustomQuestion from './CustomQuestion';
import PaymentSheet from './PaymentSheet';

const WORKER_URL = import.meta.env.PUBLIC_WORKER_URL;

type Step = 'form' | 'payment' | 'success';

export default function RegistrationForm() {
  const [eventId, setEventId] = useState<string | null>(null);
  const [event, setEvent] = useState<Event | null>(null);
  const [spots, setSpots] = useState<EventSpots | null>(null);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState<Step>('form');

  // Form fields
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [seats, setSeats] = useState(1);
  const [customAnswers, setCustomAnswers] = useState<Record<string, string | boolean>>({});
  const [membership, setMembership] = useState<PhoneLookupResponse['membership'] | null>(null);
  const [phoneLookedUp, setPhoneLookedUp] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [registrationId, setRegistrationId] = useState<string | null>(null);

  // Parse event ID from URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('event');
    setEventId(id);
  }, []);

  // Fetch event details + spots
  useEffect(() => {
    if (!eventId) {
      setLoading(false);
      return;
    }

    async function fetchEvent() {
      const [eventRes, spotsRes] = await Promise.all([
        supabase.from('events').select('*').eq('id', eventId).single(),
        fetch(`${WORKER_URL}/api/event-spots/${eventId}`).then((r) => r.json()),
      ]);

      setEvent(eventRes.data);
      setSpots(spotsRes);
      setLoading(false);
    }
    fetchEvent();
  }, [eventId]);

  // Phone lookup with debounce
  const lookupPhone = useCallback(async (phoneValue: string) => {
    const cleaned = phoneValue.replace(/[\s\-\(\)]/g, '');
    const match = cleaned.match(/^(?:\+?91)?(\d{10})$/);
    if (!match) {
      setPhoneLookedUp(false);
      setMembership(null);
      return;
    }

    try {
      const res = await fetch(`${WORKER_URL}/api/lookup-phone`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: match[1] }),
      });
      const data: PhoneLookupResponse = await res.json();

      if (data.user.found) {
        if (data.user.name && !name) setName(data.user.name);
        if (data.user.email && !email) setEmail(data.user.email);
      }
      setMembership(data.membership);
      setPhoneLookedUp(true);
    } catch {
      setPhoneLookedUp(false);
    }
  }, [name, email]);

  if (loading) {
    return <div className="text-center py-12 text-muted">Loading...</div>;
  }

  if (!eventId || !event) {
    return (
      <div className="text-center py-12">
        <h1 className="font-heading text-2xl font-bold mb-2">Event Not Found</h1>
        <p className="text-muted">
          This event doesn't exist or is no longer available.
        </p>
        <a href="/calendar" className="text-primary hover:underline mt-4 inline-block">
          View upcoming events
        </a>
      </div>
    );
  }

  const soldOut = spots && spots.remaining <= 0;
  const maxSeats = spots ? Math.min(spots.remaining, 10) : 10;

  // Calculate total
  let total = event.price * seats;
  let discountLabel = '';
  if (membership?.isMember) {
    if (membership.discount === 'free') {
      total = 0;
      discountLabel = `${membership.tier} member — free!`;
    } else if (membership.discount === '20') {
      total = Math.round(total * 0.8);
      discountLabel = 'Initiate member — 20% off';
    }
  }

  const eventDate = new Date(event.date);

  function handleCustomAnswer(questionId: string, value: string | boolean) {
    setCustomAnswers((prev) => ({ ...prev, [questionId]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (total === 0) {
      await submitRegistration('confirmed');
    } else {
      setStep('payment');
    }
  }

  async function submitRegistration(paymentStatus: 'pending' | 'confirmed') {
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch(`${WORKER_URL}/api/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_id: eventId,
          name,
          phone,
          email,
          seats,
          custom_answers: customAnswers,
          payment_status: paymentStatus,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Registration failed');
        setStep('form');
        setSubmitting(false);
        return;
      }

      setRegistrationId(data.registration_id);
      setStep('success');
    } catch {
      setError('Something went wrong. Please try again.');
      setStep('form');
    }
    setSubmitting(false);
  }

  // Success screen
  if (step === 'success') {
    return (
      <div className="bg-white rounded-2xl border border-border p-8 text-center">
        <div className="text-5xl mb-4">🎉</div>
        <h1 className="font-heading text-2xl font-bold mb-2">You're registered!</h1>
        <p className="text-muted mb-4">
          See you at <strong>{event.name}</strong> on{' '}
          {eventDate.toLocaleDateString('en-IN', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
          })}
          .
        </p>
        <p className="text-sm text-muted">
          {event.venue_name}, {event.venue_area}
        </p>
        <a
          href="/calendar"
          className="inline-block mt-6 text-primary hover:underline font-medium"
        >
          Back to events
        </a>
      </div>
    );
  }

  // Payment sheet
  if (step === 'payment') {
    return (
      <PaymentSheet
        amount={total}
        payerName={name}
        onConfirm={() => submitRegistration('confirmed')}
        onClose={() => setStep('form')}
        submitting={submitting}
      />
    );
  }

  // Registration form
  return (
    <div className="bg-white rounded-2xl border border-border p-6 sm:p-8">
      {/* Event header */}
      <div className="mb-6 pb-6 border-b border-border">
        <h1 className="font-heading text-2xl font-bold">{event.name}</h1>
        <p className="text-muted text-sm mt-1">
          {eventDate.toLocaleDateString('en-IN', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
          })}{' '}
          at{' '}
          {eventDate.toLocaleTimeString('en-IN', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true,
          })}{' '}
          &middot; {event.venue_name}, {event.venue_area}
        </p>
        <div className="flex items-center gap-3 mt-2">
          <span className="font-heading font-bold text-lg">₹{event.price} / person</span>
          {spots && (
            <span className="text-xs text-muted">
              {spots.remaining} spot{spots.remaining !== 1 ? 's' : ''} remaining
            </span>
          )}
        </div>
      </div>

      {soldOut ? (
        <div className="text-center py-8">
          <p className="font-heading font-bold text-xl text-muted">Sold Out</p>
          <p className="text-sm text-muted mt-2">This event is fully booked.</p>
        </div>
      ) : (
        <form onSubmit={handleSubmit}>
          {/* Phone */}
          <div className="mb-5">
            <label className="block font-semibold text-xs uppercase tracking-wide text-secondary/70 mb-2">
              Phone Number
            </label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              onBlur={() => lookupPhone(phone)}
              placeholder="10-digit mobile number"
              required
              className="w-full px-4 py-2.5 rounded-xl border border-border bg-white text-sm focus:outline-none focus:border-primary"
            />
          </div>

          {/* Membership banner */}
          {phoneLookedUp && membership?.isMember && (
            <div className="bg-highlight/30 border border-highlight rounded-xl px-4 py-3 mb-5 text-sm font-medium">
              ✨ {discountLabel}
            </div>
          )}

          {/* Name */}
          <div className="mb-5">
            <label className="block font-semibold text-xs uppercase tracking-wide text-secondary/70 mb-2">
              Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your full name"
              required
              className="w-full px-4 py-2.5 rounded-xl border border-border bg-white text-sm focus:outline-none focus:border-primary"
            />
          </div>

          {/* Email */}
          <div className="mb-5">
            <label className="block font-semibold text-xs uppercase tracking-wide text-secondary/70 mb-2">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com"
              required
              className="w-full px-4 py-2.5 rounded-xl border border-border bg-white text-sm focus:outline-none focus:border-primary"
            />
          </div>

          {/* Seats */}
          <div className="mb-5">
            <label className="block font-semibold text-xs uppercase tracking-wide text-secondary/70 mb-2">
              Number of Seats
            </label>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setSeats(Math.max(1, seats - 1))}
                className="w-10 h-10 rounded-xl border border-border bg-white font-bold text-lg hover:border-primary transition-colors"
              >
                −
              </button>
              <span className="font-heading font-bold text-xl w-8 text-center">{seats}</span>
              <button
                type="button"
                onClick={() => setSeats(Math.min(maxSeats, seats + 1))}
                className="w-10 h-10 rounded-xl border border-border bg-white font-bold text-lg hover:border-primary transition-colors"
              >
                +
              </button>
            </div>
          </div>

          {/* Custom questions */}
          {event.custom_questions?.map((q) => (
            <CustomQuestion
              key={q.id}
              question={q}
              value={customAnswers[q.id] ?? (q.type === 'checkbox' ? false : '')}
              onChange={(val) => handleCustomAnswer(q.id, val)}
              optionCounts={spots?.option_counts?.[q.id]}
            />
          ))}

          {/* Total */}
          <div className="flex items-center justify-between py-4 border-t border-border mt-6 mb-4">
            <span className="font-semibold text-muted">Total</span>
            <div className="text-right">
              {membership?.isMember && membership.discount && event.price * seats !== total && (
                <span className="text-muted line-through text-sm mr-2">
                  ₹{event.price * seats}
                </span>
              )}
              <span className="font-heading font-bold text-2xl">₹{total}</span>
            </div>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-4 text-sm text-red-700">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-primary text-white py-3 rounded-full font-heading font-semibold text-lg hover:bg-primary-dark transition-colors disabled:opacity-50"
          >
            {submitting
              ? 'Submitting...'
              : total === 0
                ? 'Get my spot'
                : 'Proceed to Pay'}
          </button>
          {total > 0 && (
            <p className="text-center text-xs text-muted mt-2">
              You'll be able to pay via UPI in the next step
            </p>
          )}
        </form>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add src/pages/register.astro src/components/RegistrationForm.tsx src/components/CustomQuestion.tsx
git commit -m "feat: add registration page with phone lookup, custom questions, and discount"
```

---

## Task 14: Payment Sheet Component

**Files:**
- Create: `src/components/PaymentSheet.tsx`

- [ ] **Step 1: Create the UPI payment bottom sheet**

Create `src/components/PaymentSheet.tsx`:

```tsx
interface Props {
  amount: number;
  payerName: string;
  onConfirm: () => void;
  onClose: () => void;
  submitting: boolean;
}

const UPI_ID = 'REPLACE_WITH_BGC_UPI_ID';
const RECIPIENT_NAME = 'Board Game Company';

function buildUpiUrl(scheme: string, path: string, amount: number, payerName: string): string {
  const pn = encodeURIComponent(RECIPIENT_NAME);
  const tn = encodeURIComponent(payerName);
  return `${scheme}://${path}pay?pa=${UPI_ID}&pn=${pn}&am=${amount}&cu=INR&tn=${tn}`;
}

export default function PaymentSheet({ amount, payerName, onConfirm, onClose, submitting }: Props) {
  const genericUpi = `upi://pay?pa=${UPI_ID}&pn=${encodeURIComponent(RECIPIENT_NAME)}&am=${amount}&cu=INR&tn=${encodeURIComponent(payerName)}`;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=360x360&data=${encodeURIComponent(genericUpi)}`;

  const gpayUrl = buildUpiUrl('tez', 'upi/', amount, payerName);
  const phonepeUrl = buildUpiUrl('phonepe', '', amount, payerName);
  const paytmUrl = `paytmmp://pay?pa=${UPI_ID}&pn=${encodeURIComponent(recipientName)}&am=${amount}&cu=INR&tn=${encodeURIComponent(payerName)}`;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-50"
        onClick={onClose}
      />

      {/* Sheet */}
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-white rounded-t-3xl max-w-xl mx-auto animate-slide-up">
        <div className="p-6">
          {/* Handle */}
          <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mb-4" />

          {/* Header */}
          <div className="text-center mb-6">
            <h2 className="font-heading font-bold text-xl">Complete Payment</h2>
            <p className="font-heading font-bold text-3xl text-primary mt-1">₹{amount}</p>
            <p className="text-sm text-muted">{recipientName}</p>
          </div>

          <hr className="border-border mb-6" />

          {/* QR Code */}
          <div className="text-center mb-6">
            <p className="text-sm text-muted mb-3">Scan with any UPI app</p>
            <div className="inline-block bg-white p-3 rounded-xl border border-border">
              <img src={qrUrl} alt="UPI QR Code" className="w-48 h-48" />
            </div>
          </div>

          <hr className="border-border mb-6" />

          {/* UPI App Buttons */}
          <div className="mb-6">
            <p className="text-sm text-muted text-center mb-3">Or pay directly with</p>
            <div className="flex justify-center gap-4">
              <a
                href={gpayUrl}
                className="flex flex-col items-center gap-1 p-3 rounded-xl border border-border hover:border-primary transition-colors no-underline"
              >
                <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center text-lg">G</div>
                <span className="text-xs text-secondary">GPay</span>
              </a>
              <a
                href={phonepeUrl}
                className="flex flex-col items-center gap-1 p-3 rounded-xl border border-border hover:border-primary transition-colors no-underline"
              >
                <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center text-lg">P</div>
                <span className="text-xs text-secondary">PhonePe</span>
              </a>
              <a
                href={paytmUrl}
                className="flex flex-col items-center gap-1 p-3 rounded-xl border border-border hover:border-primary transition-colors no-underline"
              >
                <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center text-lg">₹</div>
                <span className="text-xs text-secondary">Paytm</span>
              </a>
            </div>
          </div>

          {/* Confirm Button */}
          <button
            onClick={onConfirm}
            disabled={submitting}
            className="w-full bg-primary text-white py-3 rounded-full font-heading font-semibold text-lg hover:bg-primary-dark transition-colors disabled:opacity-50"
          >
            {submitting ? 'Submitting...' : "I've completed the payment"}
          </button>
        </div>
      </div>

      <style>{`
        @keyframes slide-up {
          from { transform: translateY(100%); }
          to { transform: translateY(0); }
        }
        .animate-slide-up {
          animation: slide-up 0.3s ease-out;
        }
      `}</style>
    </>
  );
}
```

**Important:** Replace `REPLACE_WITH_BGC_UPI_ID` with the actual BGC UPI ID before deploying. This should ideally come from an environment variable — for now it's a placeholder constant the user must fill in.

- [ ] **Step 2: Verify registration flow in browser**

Run: `npm run dev`, navigate to `/register?event=<some-uuid>`.
Expected: Shows "Event Not Found" if no valid event. With a valid event in Supabase, shows the full form with phone-first flow, custom questions, total bar, and payment sheet.

- [ ] **Step 3: Commit**

```bash
git add src/components/PaymentSheet.tsx
git commit -m "feat: add UPI payment sheet with QR code and app deep links"
```

---

## Task 15: Add Payment App Icons and Final Polish

**Files:**
- Create: `public/payment-app-icons/` directory
- Modify: `src/components/PaymentSheet.tsx` (add icons if available)
- Modify: `src/styles/global.css` (any final tweaks)

- [ ] **Step 1: Create payment icon placeholder directory**

```bash
mkdir -p /Users/siddhantnarula/Projects/bgc-website/public/payment-app-icons
```

Note: Add actual GPay, PhonePe, and Paytm icon PNGs to this directory. These can be copied from the REPLAY website:

```bash
cp /Users/siddhantnarula/Projects/replay-website/payment-app-icons/* /Users/siddhantnarula/Projects/bgc-website/public/payment-app-icons/
```

- [ ] **Step 2: Update PaymentSheet to use icon images**

In `src/components/PaymentSheet.tsx`, replace the placeholder icon divs with actual images:

Replace the UPI App Buttons section's inner content. Change each button's icon div:

For GPay:
```tsx
<img src="/payment-app-icons/gpay.png" alt="Google Pay" className="w-10 h-10 rounded-full" />
```

For PhonePe:
```tsx
<img src="/payment-app-icons/phonepe.png" alt="PhonePe" className="w-10 h-10 rounded-full" />
```

For Paytm:
```tsx
<img src="/payment-app-icons/paytm.jpg" alt="Paytm" className="w-10 h-10 rounded-full" />
```

- [ ] **Step 3: Add the slide-up animation to global CSS**

Add to `src/styles/global.css`:

```css
@keyframes slide-up {
  from { transform: translateY(100%); }
  to { transform: translateY(0); }
}

.animate-slide-up {
  animation: slide-up 0.3s ease-out;
}
```

Then remove the inline `<style>` block from `PaymentSheet.tsx`.

- [ ] **Step 4: Commit**

```bash
git add public/payment-app-icons/ src/components/PaymentSheet.tsx src/styles/global.css
git commit -m "feat: add payment app icons and polish animations"
```

---

## Task 16: Cloudflare Pages Deployment Config

**Files:**
- Modify: `package.json` (add build script if needed)
- Create: `.github/workflows/deploy.yml` (optional — CF Pages auto-deploys from GitHub)

- [ ] **Step 1: Verify Astro build works**

```bash
cd /Users/siddhantnarula/Projects/bgc-website
npm run build
```

Expected: Build succeeds, output in `dist/` directory.

- [ ] **Step 2: Create .env.local with your Supabase credentials**

Create `.env.local` (this file is gitignored):

```
PUBLIC_SUPABASE_URL=https://your-project.supabase.co
PUBLIC_SUPABASE_ANON_KEY=your-anon-key
PUBLIC_WORKER_URL=https://bgc-api.your-subdomain.workers.dev
```

- [ ] **Step 3: Configure Cloudflare Pages**

In the Cloudflare Dashboard:
1. Go to Workers & Pages → Create → Pages → Connect to Git
2. Select the `bgc-website` repository
3. Build settings:
   - Framework preset: Astro
   - Build command: `npm run build`
   - Build output directory: `dist`
4. Environment variables:
   - `PUBLIC_SUPABASE_URL` = your Supabase URL
   - `PUBLIC_SUPABASE_ANON_KEY` = your anon key
   - `PUBLIC_WORKER_URL` = your Worker URL

- [ ] **Step 4: Deploy the Worker**

```bash
cd /Users/siddhantnarula/Projects/bgc-website/worker
npx wrangler secret put SUPABASE_SERVICE_KEY
# Enter your Supabase service role key when prompted

# Update wrangler.toml with your SUPABASE_URL
# Then deploy:
npx wrangler deploy
```

- [ ] **Step 5: Commit any remaining changes**

```bash
cd /Users/siddhantnarula/Projects/bgc-website
git add -A
git commit -m "feat: finalize build and deployment configuration"
```

---

## Task 17: End-to-End Smoke Test

**Files:** None (testing only)

- [ ] **Step 1: Seed test data in Supabase**

Run in Supabase SQL Editor:

```sql
-- Insert a test game
insert into games (title, player_count, max_players, avg_rating, weight, complexity, play_time, max_play_time, length)
values ('Catan', '3-4', 4, 7.1, 2.32, 'Medium', '60-120', 120, 'Medium');

-- Insert a test event
insert into events (name, description, date, venue_name, venue_area, price, capacity, is_published)
values (
  'Saturday Game Night',
  'Join us for an evening of board games!',
  now() + interval '7 days',
  'Dialogues Cafe',
  'Koramangala',
  500,
  20,
  true
);
```

- [ ] **Step 2: Test each page**

Run `npm run dev` and verify:

1. **`/`** — Hero renders, upcoming event banner shows the test event, all sections visible
2. **`/library`** — Game grid shows "Catan", filters work
3. **`/guild-path`** — Three tier cards render correctly
4. **`/calendar`** — Test event appears with correct details and spots count
5. **`/register?event=<id>`** — Form loads with event details, phone lookup works, can complete registration

- [ ] **Step 3: Test Worker endpoints**

```bash
# Test lookup (should return not found for new number)
curl -X POST http://localhost:8787/api/lookup-phone \
  -H "Content-Type: application/json" \
  -d '{"phone":"9876543210"}'

# Test event spots
curl http://localhost:8787/api/event-spots/<event-uuid>
```

- [ ] **Step 4: Test full registration flow**

1. Go to `/register?event=<id>`
2. Enter phone → verify no auto-fill (new user)
3. Fill name, email, 1 seat
4. Submit → payment sheet appears with QR code
5. Click "I've completed the payment"
6. Verify success screen shows
7. Check Supabase: registration row created, user row created

- [ ] **Step 5: Test returning user flow**

1. Go to `/register?event=<id>` again
2. Enter the same phone → verify name and email auto-fill
3. Complete registration again
4. Check Supabase: second registration, user `last_registered_at` updated
