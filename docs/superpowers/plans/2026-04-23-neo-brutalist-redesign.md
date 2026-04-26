# Neo-Brutalist Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Visually redesign all 5 pages of the BGC website to a neo-brutalist aesthetic (thick black borders, offset block shadows, multi-color cards, pill badges) inspired by bgc.naveenb.com, keeping BGC's orange as the primary accent.

**Architecture:** Add CSS tokens and reusable component classes to `src/styles/global.css`. Rewrite each page/component's markup to use those classes. No changes to Supabase schema, RLS, Worker endpoints, or data-fetching logic — purely a visual restyle.

**Tech Stack:** Astro 5, React 18 islands, Tailwind CSS 4 (CSS-based `@theme`), Space Grotesk + Inter.

**Reference CSS:** `https://bgc.naveenb.com/assets/*.css` — already analyzed. Key tokens and patterns are embedded in the spec and in Task 1 below.

**Note on "tests":** This is a visual redesign. There are no unit tests to write — verification at every task is **"start the dev server, open the page in a browser, check the listed things render correctly, and confirm existing functionality still works."** Treat each browser check as the test.

---

## File Structure

**Modified — styles & layout:**
- `src/styles/global.css` — new tokens, primitives, utility classes, reveal animation
- `src/layouts/Layout.astro` — body bg, reveal-on-scroll snippet

**Modified — chrome:**
- `src/components/Nav.astro`
- `src/components/MobileMenu.tsx`
- `src/components/Footer.astro`

**Modified — pages & content components:**
- `src/pages/index.astro`, `src/components/UpcomingEventBanner.tsx`
- `src/pages/library.astro`, `src/components/GameLibrary.tsx` (splits out a new `GameModal` inside the same file)
- `src/pages/calendar.astro`, `src/components/EventList.tsx`
- `src/pages/guild-path.astro`, `src/components/GuildPurchase.tsx`, `src/components/PaymentSheet.tsx`
- `src/pages/register.astro`, `src/components/RegistrationForm.tsx`, `src/components/CustomQuestion.tsx`

**Created:** none. All work is edits to existing files.

---

## Task 1: Design System Foundation

**Files:**
- Modify: `src/styles/global.css` (full rewrite)

- [ ] **Step 1: Replace `src/styles/global.css` with the new token system + primitives**

```css
@import "tailwindcss";

@theme {
  /* Palette */
  --color-primary: #F47B20;
  --color-primary-dark: #D96A15;
  --color-pink: #FF6B6B;
  --color-blue: #4ECDC4;
  --color-green: #A8E6CF;
  --color-purple: #C3A6FF;
  --color-highlight: #FFD166;
  --color-cream: #FFF8E7;
  --color-cream-dark: #FAFAF5;
  --color-black: #1A1A1A;
  --color-white: #FFFFFF;
  --color-error: #DC2626;

  /* Legacy aliases (kept for transitional references; remove in cleanup task) */
  --color-bg: #FFF8E7;
  --color-secondary: #1A1A1A;
  --color-accent: #4ECDC4;
  --color-muted: #6B6B6B;
  --color-border: #1A1A1A;

  --font-heading: 'Space Grotesk', sans-serif;
  --font-body: 'Inter', sans-serif;
}

:root {
  --border: 3px solid #1A1A1A;
  --border-thick: 4px solid #1A1A1A;
  --shadow-sm: 4px 4px 0 #1A1A1A;
  --shadow-md: 6px 6px 0 #1A1A1A;
  --shadow-lg: 8px 8px 0 #1A1A1A;
  --shadow-xl: 12px 12px 0 #1A1A1A;
  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 16px;
  --radius-xl: 20px;
}

html {
  scroll-behavior: smooth;
  scroll-padding-top: 80px;
}

body {
  background: #FFF8E7;
  color: #1A1A1A;
  font-family: var(--font-body);
  line-height: 1.6;
  overflow-x: hidden;
}

h1, h2, h3, h4 {
  font-family: var(--font-heading);
  font-weight: 700;
  line-height: 1.1;
  letter-spacing: -0.02em;
}

/* ---------- Buttons ---------- */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 14px 28px;
  font-family: var(--font-heading);
  font-size: 1rem;
  font-weight: 600;
  border: var(--border-thick);
  border-radius: var(--radius-md);
  cursor: pointer;
  white-space: nowrap;
  text-decoration: none;
  transition: transform 0.15s, box-shadow 0.15s, background 0.15s;
}
.btn:hover { box-shadow: var(--shadow-md); transform: translate(-2px, -2px); }
.btn:active { box-shadow: none; transform: translate(2px, 2px); }

.btn-primary { background: #F47B20; color: #FFFFFF; box-shadow: var(--shadow-sm); }
.btn-primary:hover { background: #FF8F3E; box-shadow: var(--shadow-lg); }

.btn-secondary { background: #FFFFFF; color: #1A1A1A; box-shadow: var(--shadow-sm); }
.btn-secondary:hover { background: #FF6B6B; color: #1A1A1A; box-shadow: var(--shadow-lg); }

.btn-black { background: #1A1A1A; color: #FFFFFF; box-shadow: var(--shadow-sm); }
.btn-black:hover { box-shadow: var(--shadow-md); }

.btn-nav { padding: 10px 20px; font-size: 0.9rem; background: #F47B20; color: #FFFFFF; box-shadow: 3px 3px 0 #1A1A1A; }

.btn-sm { padding: 8px 18px; font-size: 0.85rem; }

/* ---------- Cards ---------- */
.card-brutal {
  border: var(--border-thick);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-md);
  background: #FFFFFF;
  transition: transform 0.25s, box-shadow 0.25s;
}
.card-brutal:hover { box-shadow: var(--shadow-lg); transform: translate(-3px, -3px); }

.card-brutal-lg { box-shadow: var(--shadow-lg); }
.card-brutal-lg:hover { box-shadow: var(--shadow-xl); transform: translate(-4px, -4px); }

/* ---------- Pills / badges ---------- */
.pill {
  display: inline-block;
  padding: 6px 14px;
  font-family: var(--font-heading);
  font-size: 0.8rem;
  font-weight: 600;
  border: var(--border);
  border-radius: 50px;
  background: #FFFFFF;
  color: #1A1A1A;
}
.pill-accent { background: #F47B20; color: #FFFFFF; box-shadow: 3px 3px 0 #1A1A1A; }
.pill-black { background: #1A1A1A; color: #FFFFFF; border-color: #1A1A1A; }
.pill-yellow { background: #FFD166; color: #1A1A1A; box-shadow: 3px 3px 0 #1A1A1A; }

.section-tag {
  display: inline-block;
  padding: 6px 16px;
  margin-bottom: 16px;
  font-family: var(--font-heading);
  font-size: 0.8rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  background: #F47B20;
  color: #FFFFFF;
  border: var(--border);
  box-shadow: 3px 3px 0 #1A1A1A;
  border-radius: 50px;
}

/* ---------- Inputs ---------- */
.input-brutal {
  width: 100%;
  padding: 12px 18px;
  font-family: var(--font-body);
  font-size: 1rem;
  background: #FFFFFF;
  color: #1A1A1A;
  border: var(--border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
  outline: none;
  transition: box-shadow 0.15s;
}
.input-brutal:focus { box-shadow: var(--shadow-md); }
.input-brutal::placeholder { color: #1A1A1A; opacity: 0.45; }

.label-brutal {
  display: block;
  margin-bottom: 6px;
  font-family: var(--font-heading);
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #1A1A1A;
  opacity: 0.7;
}

/* ---------- Section tags bg variants (for color palette tokens) ---------- */
.bg-cream { background: #FFF8E7; }
.bg-cream-dark { background: #FAFAF5; }
.bg-black-ui { background: #1A1A1A; color: #FFFFFF; }

/* ---------- Reveal on scroll ---------- */
.reveal { opacity: 0; transform: translateY(30px); transition: opacity 0.6s, transform 0.6s; }
.reveal.visible { opacity: 1; transform: translateY(0); }

/* ---------- Animations ---------- */
@keyframes fadeInUp {
  from { opacity: 0; transform: translateY(20px); }
  to { opacity: 1; transform: translateY(0); }
}
.animate-fade-in-up { animation: fadeInUp 0.8s both; }
.animate-fade-in-up-delayed { animation: fadeInUp 0.8s 0.2s both; }

@keyframes slide-up {
  from { transform: translateY(100%); }
  to { transform: translateY(0); }
}
.animate-slide-up { animation: slide-up 0.3s ease-out; }

@keyframes modal-slide-up {
  from { opacity: 0; transform: translateY(24px); }
  to { opacity: 1; transform: translateY(0); }
}
.animate-modal { animation: modal-slide-up 0.25s; }

@keyframes fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
.animate-fade-in { animation: fade-in 0.2s; }

/* ---------- Focus ring (a11y) ---------- */
.btn:focus-visible,
.input-brutal:focus-visible,
.pill:focus-visible {
  outline: 3px solid #F47B20;
  outline-offset: 3px;
}
```

- [ ] **Step 2: Verify the build succeeds**

Run: `npm run build`
Expected: build completes with no CSS-related errors. Tailwind picks up the new `@theme` tokens.

- [ ] **Step 3: Start the dev server and open the home page**

Run: `npm run dev` (leave running in another terminal)
Open: `http://localhost:4321/`
Expected: page still renders (possibly looks broken/unstyled in places, since pages still use old classes). No console errors. The body background should now be the new cream `#FFF8E7`.

- [ ] **Step 4: Commit**

```bash
git add src/styles/global.css
git commit -m "feat(design): add neo-brutalist design system tokens and primitives"
```

---

## Task 2: Navigation & Mobile Menu

**Files:**
- Modify: `src/components/Nav.astro` (full rewrite)
- Modify: `src/components/MobileMenu.tsx` (full rewrite)

- [ ] **Step 1: Replace `src/components/Nav.astro`**

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

<nav id="site-nav" class="fixed top-0 left-0 right-0 z-50 bg-cream" style="border-bottom: var(--border); transition: box-shadow 0.3s;">
  <div class="max-w-[1200px] mx-auto px-6">
    <div class="flex items-center justify-between h-[72px]">
      <a href="/" class="flex items-center gap-3 no-underline z-[60]">
        <img src="/bgc-logo.png" alt="BGC" class="h-10 w-10 rounded-full object-cover" />
        <span class="font-heading font-bold text-xl whitespace-nowrap hidden sm:inline">
          Board Game Company
        </span>
      </a>

      <ul class="hidden md:flex items-center gap-8 list-none m-0 p-0">
        {navLinks.map(link => (
          <li>
            <a
              href={link.href}
              class="nav-link font-heading font-semibold text-base no-underline relative py-1"
            >
              {link.label}
            </a>
          </li>
        ))}
        <li>
          <a href="/register" class="btn btn-nav no-underline">Register</a>
        </li>
      </ul>

      <MobileMenu client:load navLinks={navLinks} />
    </div>
  </div>
</nav>

<style>
  .nav-link::after {
    content: '';
    position: absolute;
    bottom: -4px;
    left: 0;
    width: 0;
    height: 3px;
    background: #F47B20;
    transition: width 0.3s;
  }
  .nav-link:hover::after,
  .nav-link.active::after { width: 100%; }
</style>

<script>
  const nav = document.getElementById('site-nav');
  function onScroll() {
    if (!nav) return;
    if (window.scrollY > 10) {
      nav.style.boxShadow = '0 4px 20px rgba(0,0,0,0.1)';
    } else {
      nav.style.boxShadow = 'none';
    }
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // Active link highlight
  const path = window.location.pathname;
  document.querySelectorAll<HTMLAnchorElement>('.nav-link').forEach(a => {
    if (a.getAttribute('href') === path) a.classList.add('active');
  });
</script>
```

- [ ] **Step 2: Replace `src/components/MobileMenu.tsx`**

```tsx
import { useState, useEffect } from 'react';

interface Props {
  navLinks: { label: string; href: string }[];
}

export default function MobileMenu({ navLinks }: Props) {
  const [open, setOpen] = useState(false);
  const path = typeof window !== 'undefined' ? window.location.pathname : '/';

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  return (
    <div className="md:hidden">
      <button
        onClick={() => setOpen(!open)}
        className="flex flex-col gap-[5px] p-2 bg-transparent border-0 cursor-pointer z-[60] relative"
        aria-label="Toggle menu"
      >
        <span className={`block w-7 h-[3px] bg-[#1A1A1A] rounded-sm transition-transform ${open ? 'rotate-45 translate-y-[6px]' : ''}`} />
        <span className={`block w-7 h-[3px] bg-[#1A1A1A] rounded-sm transition-opacity ${open ? 'opacity-0' : ''}`} />
        <span className={`block w-7 h-[3px] bg-[#1A1A1A] rounded-sm transition-transform ${open ? '-rotate-45 -translate-y-[6px]' : ''}`} />
      </button>

      {/* Overlay */}
      <div
        className={`fixed inset-0 bg-black/60 transition-opacity z-[45] ${open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
        onClick={() => setOpen(false)}
      />

      {/* Drawer */}
      <div
        className={`fixed top-0 right-0 w-full h-screen bg-[#FFF8E7] z-50 transition-transform duration-300 overflow-y-auto ${open ? 'translate-x-0' : 'translate-x-full'}`}
      >
        <div className="flex items-center justify-between h-[72px] px-6" style={{ borderBottom: '3px solid #1A1A1A' }}>
          <a href="/" className="flex items-center gap-3 no-underline">
            <img src="/bgc-logo.png" alt="BGC" className="h-10 w-10 rounded-full object-cover" />
            <span className="font-heading font-bold text-lg">Board Game Company</span>
          </a>
          <button onClick={() => setOpen(false)} aria-label="Close menu" className="p-2 bg-transparent border-0 cursor-pointer">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#1A1A1A" strokeWidth="3" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <ul className="flex flex-col gap-2 p-6 list-none m-0">
          {navLinks.map((link) => {
            const active = link.href === path;
            return (
              <li key={link.href}>
                <a
                  href={link.href}
                  className={`block py-4 px-4 rounded-xl font-heading font-semibold text-xl no-underline text-[#1A1A1A] ${active ? 'bg-[#FAFAF5]' : ''}`}
                  onClick={() => setOpen(false)}
                >
                  {link.label}
                </a>
              </li>
            );
          })}
          <li className="mt-4">
            <a href="/register" className="btn btn-primary w-full text-center no-underline" onClick={() => setOpen(false)}>
              Register Now
            </a>
          </li>
        </ul>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify in browser**

With dev server running: open `http://localhost:4321/`.
Check:
- Navbar has cream background, black bottom border, logo + wordmark on the left, nav links on right, orange "Register" button.
- Scroll down — a subtle drop-shadow appears under the navbar.
- Hover a nav link — orange underline animates in.
- Current page's nav link has an orange underline by default.
- Resize to <768px: hamburger appears. Click it → full-screen drawer slides in from right. Links styled as large pill rows. Close button (X) on the right of the drawer header closes it. Clicking overlay also closes it.

- [ ] **Step 4: Commit**

```bash
git add src/components/Nav.astro src/components/MobileMenu.tsx
git commit -m "feat(design): brutalist nav + mobile drawer"
```

---

## Task 3: Footer

**Files:**
- Modify: `src/components/Footer.astro` (full rewrite)

- [ ] **Step 1: Replace `src/components/Footer.astro`**

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

<footer class="bg-black-ui text-white mt-16">
  <div class="max-w-[1200px] mx-auto px-6 pt-16 pb-8">
    <div class="grid grid-cols-1 md:grid-cols-4 gap-10">
      <div class="md:col-span-1">
        <div class="flex items-center gap-3 mb-4">
          <img src="/bgc-logo.png" alt="BGC" class="h-12 w-12 rounded-full" />
          <span class="font-heading font-bold text-xl">BGC</span>
        </div>
        <p class="text-white/70 text-sm leading-relaxed">
          Bringing people together, one board game at a time.
        </p>
        <p class="text-white/50 text-xs mt-2">Bangalore, India</p>
        <div class="mt-4 p-3 rounded-lg text-sm text-white/70" style="background: rgba(255,255,255,0.08); border-left: 3px solid #F47B20;">
          Partnered with TTRPGcon & REPLAY
        </div>
      </div>

      <div>
        <h4 class="font-heading font-bold text-[#F47B20] text-sm uppercase tracking-wider mb-4">Pages</h4>
        <ul class="flex flex-col gap-2 list-none m-0 p-0">
          {quickLinks.map(link => (
            <li>
              <a href={link.href} class="text-white/70 hover:text-[#F47B20] text-sm no-underline transition-colors">
                {link.label}
              </a>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <h4 class="font-heading font-bold text-[#F47B20] text-sm uppercase tracking-wider mb-4">Contact</h4>
        <ul class="flex flex-col gap-2 list-none m-0 p-0">
          <li>
            <a href="https://instagram.com/boardgamecompany" target="_blank" rel="noopener noreferrer" class="text-white/70 hover:text-[#F47B20] text-sm no-underline transition-colors">
              Instagram
            </a>
          </li>
          <li>
            <a href="https://wa.me/919982200768" target="_blank" rel="noopener noreferrer" class="text-white/70 hover:text-[#F47B20] text-sm no-underline transition-colors">
              WhatsApp
            </a>
          </li>
          <li>
            <a href="mailto:hello@boardgamecompany.in" class="text-white/70 hover:text-[#F47B20] text-sm no-underline transition-colors">
              hello@boardgamecompany.in
            </a>
          </li>
        </ul>
      </div>

      <div>
        <h4 class="font-heading font-bold text-[#F47B20] text-sm uppercase tracking-wider mb-4">Partners</h4>
        <ul class="flex flex-col gap-2 list-none m-0 p-0">
          <li>
            <a href="https://replaycon.in" target="_blank" rel="noopener noreferrer" class="text-white/70 hover:text-[#F47B20] text-sm no-underline transition-colors">
              REPLAY con
            </a>
          </li>
          <li>
            <a href="https://ttrpgcon.in" target="_blank" rel="noopener noreferrer" class="text-white/70 hover:text-[#F47B20] text-sm no-underline transition-colors">
              TTRPGcon
            </a>
          </li>
        </ul>
      </div>
    </div>

    <div class="text-center text-xs text-white/40 pt-6 mt-10" style="border-top: 1px solid rgba(255,255,255,0.1);">
      &copy; 2026 Board Game Company. All rights reserved.
    </div>
  </div>
</footer>
```

- [ ] **Step 2: Verify in browser**

Open `http://localhost:4321/` and scroll to the footer.
Check:
- Black background, white text.
- 4-column grid on desktop: brand/tagline, Pages, Contact, Partners.
- Section headings in orange (`#F47B20`), uppercase, Space Grotesk.
- Link hover turns orange.
- Collab callout under brand has orange left border.
- Resize to <768px: collapses to 1 column.

- [ ] **Step 3: Commit**

```bash
git add src/components/Footer.astro
git commit -m "feat(design): brutalist footer"
```

---

## Task 4: Layout Wrapper

**Files:**
- Modify: `src/layouts/Layout.astro`

- [ ] **Step 1: Replace `src/layouts/Layout.astro`**

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
  <body class="min-h-screen flex flex-col" style="background: #FFF8E7;">
    <Nav />
    <main class="flex-1 pt-[72px]">
      <slot />
    </main>
    <Footer />

    <script>
      const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('visible');
            observer.unobserve(entry.target);
          }
        });
      }, { threshold: 0.1 });
      document.querySelectorAll('.reveal').forEach((el) => observer.observe(el));
    </script>
  </body>
</html>
```

- [ ] **Step 2: Verify in browser**

Open any page — pages no longer render under the fixed nav (the `pt-[72px]` on `<main>` clears it). Nav stays fixed on scroll.

- [ ] **Step 3: Commit**

```bash
git add src/layouts/Layout.astro
git commit -m "feat(design): cream body bg + reveal-on-scroll observer"
```

---

## Task 5: Home Page

**Files:**
- Modify: `src/pages/index.astro` (full rewrite)
- Modify: `src/components/UpcomingEventBanner.tsx` (full rewrite)

- [ ] **Step 1: Replace `src/components/UpcomingEventBanner.tsx`**

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
  const dateStr = eventDate.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
  const timeStr = eventDate.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });

  return (
    <div
      className="flex flex-col sm:flex-row items-stretch rounded-2xl overflow-hidden"
      style={{ border: '4px solid #1A1A1A', boxShadow: '6px 6px 0 #1A1A1A', background: '#FFFFFF' }}
    >
      <div className="sm:w-[12px] h-[6px] sm:h-auto" style={{ background: '#F47B20' }} />
      <div className="flex-1 flex flex-col sm:flex-row items-start sm:items-center gap-4 p-5 sm:p-6">
        <div className="flex-1">
          <span className="pill pill-black mb-2 inline-block">{dateStr.toUpperCase()}</span>
          <h3 className="font-heading font-bold text-xl mt-1">{event.name}</h3>
          <p className="text-[#1A1A1A]/70 text-sm mt-1">
            {timeStr} · {event.venue_name}, {event.venue_area} · ₹{event.price}
          </p>
        </div>
        <a href={`/register?event=${event.id}`} className="btn btn-primary btn-sm no-underline whitespace-nowrap">
          Register →
        </a>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Replace `src/pages/index.astro`**

```astro
---
import Layout from '../layouts/Layout.astro';
import UpcomingEventBanner from '../components/UpcomingEventBanner.tsx';
import GameCount from '../components/GameCount.tsx';
---

<Layout title="Home" description="Bangalore's Favorite Board Gaming Community — board game sessions at cafes across the city">

  <!-- Hero -->
  <section class="py-14" style="background: #FFF8E7;">
    <div class="max-w-[1200px] mx-auto px-6 grid grid-cols-1 lg:grid-cols-2 items-center gap-12">
      <div class="animate-fade-in-up text-center lg:text-left">
        <span class="pill pill-yellow mb-6 inline-block">🎲 Welcome</span>
        <h1 class="font-heading font-bold" style="font-size: clamp(2.8rem, 6vw, 5rem); letter-spacing: -2px; line-height: 1.05;">
          Welcome to<br />
          <span style="color: #F47B20;">Board Game Company!</span>
        </h1>
        <p class="mt-5 text-lg text-[#1A1A1A]/70 max-w-lg mx-auto lg:mx-0">
          Our mission is to create a community that brings people together over board games. Currently hosting events across Bangalore!
        </p>
        <div class="mt-8 flex flex-wrap gap-4 justify-center lg:justify-start">
          <a href="/register" class="btn btn-primary no-underline">Register for a Session</a>
          <a href="https://chat.whatsapp.com/GL1h4jipksfCW4vm7OtZjp" target="_blank" rel="noopener noreferrer" class="btn btn-secondary no-underline">
            Join The Community
          </a>
        </div>
      </div>
      <div class="animate-fade-in-up-delayed">
        <img
          src="/landing-photos/1.png"
          alt="BGC game session"
          class="w-full object-cover rounded-[20px]"
          style="aspect-ratio: 4/3; border: 4px solid #1A1A1A; box-shadow: 8px 8px 0 #1A1A1A;"
        />
      </div>
    </div>
  </section>

  <!-- Upcoming Event -->
  <section class="max-w-[1200px] mx-auto px-6 pb-14 reveal">
    <UpcomingEventBanner client:load />
  </section>

  <!-- What Does BGC Do? -->
  <section class="py-16 reveal" style="background: #FAFAF5;">
    <div class="max-w-[1200px] mx-auto px-6 text-center">
      <span class="section-tag">What We Do</span>
      <h2 class="font-heading font-bold mb-10" style="font-size: clamp(2.2rem, 5vw, 3.5rem); letter-spacing: -1px;">
        What Does BGC Do?
      </h2>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-6 text-left">
        <div class="card-brutal p-9" style="background: #FFD166;">
          <div class="text-5xl mb-4">🎲</div>
          <h3 class="font-heading font-bold text-2xl mb-2">Offline Gaming</h3>
          <p class="text-[#1A1A1A]/85 leading-relaxed">
            Hosting board games, TTRPGs like D&amp;D, party games like Clocktower and more at your local cafe across Bangalore. Come play, meet new people, and have fun!
          </p>
        </div>
        <div class="card-brutal p-9" style="background: #4ECDC4;">
          <div class="text-5xl mb-4">📚</div>
          <h3 class="font-heading font-bold text-2xl mb-2"><GameCount client:load /> Games</h3>
          <p class="text-[#1A1A1A]/85 leading-relaxed">
            From quick party games to deep strategy epics — our library has something for everyone.
          </p>
        </div>
        <div class="card-brutal p-9" style="background: #A8E6CF;">
          <div class="text-5xl mb-4">🤝</div>
          <h3 class="font-heading font-bold text-2xl mb-2">Growing Community</h3>
          <p class="text-[#1A1A1A]/85 leading-relaxed">
            With people joining from all over the city, you're sure to find someone who matches your wavelength!
          </p>
        </div>
      </div>
    </div>
  </section>

  <!-- Guild Path Teaser -->
  <section class="py-16 reveal" style="background: #FFF8E7;">
    <div class="max-w-[1200px] mx-auto px-6">
      <div class="card-brutal p-10 md:p-12 flex flex-col md:flex-row items-center gap-8 relative overflow-hidden" style="background: #C3A6FF; box-shadow: 8px 8px 0 #1A1A1A;">
        <span class="absolute top-5 left-8 text-5xl opacity-[0.15] -rotate-12 pointer-events-none">♠</span>
        <span class="absolute top-8 right-10 text-5xl opacity-[0.15] rotate-[20deg] pointer-events-none">♟</span>
        <span class="absolute bottom-6 left-14 text-5xl opacity-[0.15] rotate-[10deg] pointer-events-none">🎲</span>
        <span class="absolute bottom-5 right-8 text-5xl opacity-[0.15] -rotate-[25deg] pointer-events-none">🎯</span>
        <div class="flex-1 relative z-10">
          <h2 class="font-heading font-bold text-4xl mb-3">Guild Path</h2>
          <p class="text-[#1A1A1A]/85 text-lg max-w-xl">
            Track your progress and level up through the BGC ranks. Get discounts, free events, and exclusive perks.
          </p>
        </div>
        <a href="/guild-path" class="btn btn-black no-underline whitespace-nowrap relative z-10">
          Explore Guild Path →
        </a>
      </div>
    </div>
  </section>

  <!-- Community CTA -->
  <section class="py-16 reveal" style="background: #FAFAF5;">
    <div class="max-w-[1200px] mx-auto px-6">
      <div class="card-brutal p-12 md:p-20 text-center relative overflow-hidden" style="background: #F47B20; box-shadow: 8px 8px 0 #1A1A1A;">
        <span class="absolute top-6 left-8 text-6xl opacity-[0.15] -rotate-12 pointer-events-none">🎲</span>
        <span class="absolute top-8 right-10 text-6xl opacity-[0.15] rotate-[20deg] pointer-events-none">🎯</span>
        <span class="absolute bottom-8 left-14 text-6xl opacity-[0.15] rotate-[10deg] pointer-events-none">♠</span>
        <span class="absolute bottom-6 right-8 text-6xl opacity-[0.15] -rotate-[25deg] pointer-events-none">♟</span>
        <h2 class="font-heading font-bold text-white" style="font-size: clamp(2.5rem, 5vw, 4rem); letter-spacing: -1px;">
          Join Our Community
        </h2>
        <p class="text-white/90 text-lg max-w-xl mx-auto mt-5 mb-10 relative z-10">
          The best way to play more games is to know more people who play. Slide into our DMs or drop into the WhatsApp group — come say hi!
        </p>
        <div class="flex flex-wrap justify-center gap-4 relative z-10">
          <a href="https://chat.whatsapp.com/GL1h4jipksfCW4vm7OtZjp" target="_blank" rel="noopener noreferrer" class="btn btn-black no-underline">
            WhatsApp Group
          </a>
          <a href="https://instagram.com/boardgamecompany" target="_blank" rel="noopener noreferrer" class="btn btn-black no-underline">
            Instagram
          </a>
        </div>
      </div>
    </div>
  </section>

</Layout>
```

- [ ] **Step 3: Verify in browser**

Open `http://localhost:4321/`.
Check:
- **Hero:** Yellow "🎲 Welcome" pill above the big headline. "Board Game Company!" in orange on its own line. Two buttons below (orange primary, white secondary). Right side: single photo `/landing-photos/1.png` with thick black border and offset shadow.
- **Upcoming event banner:** Appears below hero if there's a future event. Thick black border, orange left strip, black date pill, orange "Register →" button.
- **What We Do:** Orange "WHAT WE DO" tag pill, "What Does BGC Do?" title, 3 colored cards (yellow / teal / green) each with thick border, offset shadow, emoji, heading, body.
- **Guild Path teaser:** Purple card with decorative emoji in corners, "Guild Path" heading, black "Explore Guild Path →" button.
- **Community CTA:** Big orange card with decorative emoji in 4 corners, "Join Our Community" headline in white, two black pill buttons.
- Hover any card — it translates up-left and shadow grows.
- Page has reveal-on-scroll fade for sections below the fold.
- GameCount still fetches and displays a number.

- [ ] **Step 4: Commit**

```bash
git add src/pages/index.astro src/components/UpcomingEventBanner.tsx
git commit -m "feat(design): brutalist home page"
```

---

## Task 6: Library Page + Game Modal

**Files:**
- Modify: `src/pages/library.astro` (full rewrite)
- Modify: `src/components/GameLibrary.tsx` (full rewrite — adds inline GameModal component)

- [ ] **Step 1: Replace `src/pages/library.astro`**

```astro
---
import Layout from '../layouts/Layout.astro';
import GameLibrary from '../components/GameLibrary.tsx';
---

<Layout title="Library" description="Browse BGC's collection of board games — search and filter by complexity, players, and play time">
  <section class="py-14" style="background: #FFF8E7;">
    <div class="max-w-[1200px] mx-auto px-6 text-center">
      <span class="section-tag">Games Library</span>
      <h1 class="font-heading font-bold" style="font-size: clamp(2.4rem, 5vw, 3.8rem); letter-spacing: -1px;">
        Our Library
      </h1>
      <p class="text-lg text-[#1A1A1A]/70 mt-3">
        Every game we own, ready to play at the next session.
      </p>
    </div>
  </section>

  <section class="pb-20">
    <div class="max-w-[1200px] mx-auto px-6">
      <GameLibrary client:load />
    </div>
  </section>
</Layout>
```

- [ ] **Step 2: Replace `src/components/GameLibrary.tsx`**

```tsx
import { useEffect, useState, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import type { Game } from '../lib/types';

const COMPLEXITY_BG: Record<string, string> = {
  Light: '#A8E6CF',
  Medium: '#FFD166',
  Heavy: '#FF6B6B',
};

export default function GameLibrary() {
  const [games, setGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [playerFilter, setPlayerFilter] = useState('');
  const [complexityFilter, setComplexityFilter] = useState('');
  const [lengthFilter, setLengthFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [filterBarOpen, setFilterBarOpen] = useState(false);
  const [selectedGame, setSelectedGame] = useState<Game | null>(null);

  useEffect(() => {
    async function fetchGames() {
      const { data, error } = await supabase
        .from('games')
        .select('id, title, player_count, max_players, avg_rating, weight, complexity, play_time, max_play_time, length')
        .order('title');
      if (error) {
        console.error('Supabase error:', error);
        setError(error.message);
      }
      setGames(data || []);
      setLoading(false);
    }
    fetchGames();
  }, []);

  const filtered = useMemo(() => {
    return games.filter((game) => {
      if (search && !game.title.toLowerCase().includes(search.toLowerCase())) return false;
      if (playerFilter) {
        const count = parseInt(playerFilter, 10);
        if (game.max_players < count) return false;
      }
      if (complexityFilter && game.complexity !== complexityFilter) return false;
      if (lengthFilter && game.length !== lengthFilter) return false;
      return true;
    });
  }, [games, search, playerFilter, complexityFilter, lengthFilter]);

  const hasFilters = !!(search || playerFilter || complexityFilter || lengthFilter);

  function clearFilters() {
    setSearch('');
    setPlayerFilter('');
    setComplexityFilter('');
    setLengthFilter('');
  }

  if (loading) {
    return <div className="text-center py-16 text-[#1A1A1A]/60 font-heading">Loading games...</div>;
  }
  if (error) {
    return (
      <div className="text-center py-16">
        <p className="font-heading font-bold text-xl text-[#FF6B6B]">Failed to load games</p>
        <p className="text-sm mt-1 text-[#1A1A1A]/70">{error}</p>
      </div>
    );
  }

  return (
    <div>
      {/* Stats pill */}
      <div className="mb-4">
        <span className="pill pill-yellow">🎲 {games.length} games</span>
      </div>

      {/* Controls row */}
      <div className="flex flex-wrap gap-3 items-center mb-3">
        <input
          type="text"
          placeholder="Search games..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input-brutal flex-1 min-w-[200px]"
        />
        <button
          onClick={() => setFilterBarOpen(!filterBarOpen)}
          className="btn btn-secondary btn-sm md:hidden"
        >
          Filters {filterBarOpen ? '▲' : '▼'}
        </button>
      </div>

      {/* Filter bar */}
      <div
        className={`${filterBarOpen ? 'flex' : 'hidden'} md:flex flex-wrap gap-5 items-end mb-5 p-4 rounded-xl`}
        style={{ background: '#FAFAF5', border: '2px solid #1A1A1A' }}
      >
        <FilterGroup label="Complexity" value={complexityFilter} onChange={setComplexityFilter} options={['Light', 'Medium', 'Heavy']} />
        <FilterGroup label="Players" value={playerFilter} onChange={setPlayerFilter} options={['2', '4', '6', '8']} valueLabel={(v) => `${v}+`} />
        <FilterGroup label="Play Time" value={lengthFilter} onChange={setLengthFilter} options={['Quick', 'Medium', 'Long']} />
        {hasFilters && (
          <button onClick={clearFilters} className="font-heading font-semibold text-sm text-[#FF6B6B] bg-transparent border-0 cursor-pointer ml-auto py-2">
            Clear all
          </button>
        )}
      </div>

      {/* Stats */}
      <p className="text-sm text-[#1A1A1A]/60 mb-5 font-heading">
        Showing {filtered.length} of {games.length}
      </p>

      {/* Grid */}
      {filtered.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-6xl mb-4">🔍</div>
          <p className="font-heading text-lg text-[#1A1A1A]/60">No games match your filters.</p>
        </div>
      ) : (
        <div className="grid gap-5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
          {filtered.map((game) => (
            <GameCard key={game.id} game={game} onOpen={() => setSelectedGame(game)} />
          ))}
        </div>
      )}

      {selectedGame && <GameModal game={selectedGame} onClose={() => setSelectedGame(null)} />}
    </div>
  );
}

function FilterGroup({
  label, value, onChange, options, valueLabel,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  valueLabel?: (v: string) => string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="label-brutal">{label}</span>
      <div className="flex flex-wrap gap-1.5">
        {options.map((opt) => {
          const active = value === opt;
          return (
            <button
              key={opt}
              onClick={() => onChange(active ? '' : opt)}
              className={`font-heading font-semibold rounded-lg px-3 py-1.5 text-xs cursor-pointer transition-colors`}
              style={{
                border: '2px solid #1A1A1A',
                background: active ? '#1A1A1A' : '#FFFFFF',
                color: active ? '#FFFFFF' : '#1A1A1A',
              }}
            >
              {valueLabel ? valueLabel(opt) : opt}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function GameCard({ game, onOpen }: { game: Game; onOpen: () => void }) {
  const letter = game.title[0]?.toUpperCase() ?? '?';
  const complexityBg = game.complexity ? COMPLEXITY_BG[game.complexity] : '#FAFAF5';
  return (
    <button
      onClick={onOpen}
      className="card-brutal flex flex-col overflow-hidden text-left p-0 cursor-pointer"
      style={{ background: '#FFFFFF' }}
    >
      <div className="relative flex items-center justify-center h-[100px]" style={{ background: complexityBg, borderBottom: '3px solid #1A1A1A' }}>
        <span className="font-heading font-bold opacity-20" style={{ fontSize: '3.5rem' }}>{letter}</span>
        {game.avg_rating !== null && game.avg_rating !== undefined && (
          <span className="absolute top-2.5 left-2.5 pill pill-black" style={{ padding: '3px 10px', fontSize: '0.75rem' }}>
            ⭐ {Number(game.avg_rating).toFixed(1)}
          </span>
        )}
        {game.complexity && (
          <span className="absolute top-2.5 right-2.5 pill" style={{ padding: '3px 10px', fontSize: '0.7rem', background: '#FFFFFF', border: '2px solid #1A1A1A' }}>
            {game.complexity}
          </span>
        )}
      </div>
      <div className="flex-1 flex flex-col px-5 pt-4 pb-5">
        <h3 className="font-heading font-bold text-base mb-2 leading-tight">{game.title}</h3>
        <div className="flex flex-wrap gap-1.5 mt-auto">
          <span className="pill" style={{ padding: '4px 10px', fontSize: '0.75rem', background: '#FFF8E7', border: '2px solid #1A1A1A' }}>
            👥 {game.player_count}
          </span>
          <span className="pill" style={{ padding: '4px 10px', fontSize: '0.75rem', background: '#FFF8E7', border: '2px solid #1A1A1A' }}>
            ⏱ {game.play_time}m
          </span>
        </div>
      </div>
    </button>
  );
}

function GameModal({ game, onClose }: { game: Game; onClose: () => void }) {
  const letter = game.title[0]?.toUpperCase() ?? '?';
  const complexityBg = game.complexity ? COMPLEXITY_BG[game.complexity] : '#FAFAF5';

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[3000] flex items-center justify-center p-6 animate-fade-in"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={onClose}
    >
      <div
        className="animate-modal rounded-2xl overflow-hidden w-full max-w-[480px] max-h-[85vh] overflow-y-auto"
        style={{ background: '#FFFFFF', border: '4px solid #1A1A1A', boxShadow: '12px 12px 0 #1A1A1A' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative flex items-center justify-center h-[120px]" style={{ background: complexityBg, borderBottom: '3px solid #1A1A1A' }}>
          <span className="font-heading font-bold opacity-20" style={{ fontSize: '4rem' }}>{letter}</span>
          <button
            onClick={onClose}
            aria-label="Close"
            className="absolute top-3 right-3 w-8 h-8 flex items-center justify-center rounded-lg cursor-pointer font-bold"
            style={{ background: '#FFF8E7', border: '2px solid #1A1A1A' }}
          >
            ✕
          </button>
        </div>
        <div className="p-6">
          <h2 className="font-heading font-bold text-2xl mb-3" style={{ letterSpacing: '-0.5px' }}>{game.title}</h2>
          <div className="flex flex-wrap gap-2 mb-4">
            {game.avg_rating !== null && game.avg_rating !== undefined && (
              <span className="pill pill-black" style={{ padding: '4px 12px', fontSize: '0.8rem' }}>
                ⭐ {Number(game.avg_rating).toFixed(1)}
              </span>
            )}
            {game.complexity && (
              <span className="pill" style={{ padding: '4px 12px', fontSize: '0.8rem', background: '#FFFFFF', border: '2px solid #1A1A1A' }}>
                {game.complexity}
              </span>
            )}
          </div>
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))' }}>
            <DetailCard label="Players" value={game.player_count || '—'} />
            <DetailCard label="Duration" value={game.play_time ? `${game.play_time}${game.max_play_time && game.max_play_time !== game.play_time ? `–${game.max_play_time}` : ''} min` : '—'} />
            {game.weight !== null && game.weight !== undefined && (
              <DetailCard label="Weight" value={Number(game.weight).toFixed(1)} />
            )}
            {game.length && <DetailCard label="Length" value={game.length} />}
          </div>
        </div>
      </div>
    </div>
  );
}

function DetailCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="text-center rounded-xl p-3" style={{ background: '#FFF8E7', border: '2px solid #1A1A1A' }}>
      <div className="label-brutal mb-1">{label}</div>
      <div className="font-heading font-bold text-base">{value}</div>
    </div>
  );
}
```

- [ ] **Step 3: Verify in browser**

Open `http://localhost:4321/library`.
Check:
- Header: "GAMES LIBRARY" tag pill, "Our Library" title, subtitle.
- Yellow "🎲 N games" stats pill below subtitle.
- Search input: white, black border, offset shadow. Type — grid filters live.
- Filter bar: 3 groups (Complexity / Players / Play Time), each a horizontal row of small pill buttons with 2px black border. Click a filter → button fills black/white. Click again → deselects.
- Pink "Clear all" button appears only when filters are active.
- On mobile (<768px): filter bar collapses behind a "Filters ▼" toggle.
- Grid renders games as cards. Card header colored by complexity (green/yellow/pink), big letter watermark, rating pill top-left, complexity pill top-right. Body has title + 2 meta pills (players / duration).
- Click a card → modal opens with fade-in, slides up. Modal shows title, badges, detail grid (Players / Duration / Weight / Length).
- Close modal via ✕ button, clicking overlay, or pressing Escape.
- No internal fields (`owned_by`, `currently_with`) appear anywhere.

- [ ] **Step 4: Commit**

```bash
git add src/pages/library.astro src/components/GameLibrary.tsx
git commit -m "feat(design): brutalist library with colored cards and game modal"
```

---

## Task 7: Calendar Page

**Files:**
- Modify: `src/pages/calendar.astro` (full rewrite)
- Modify: `src/components/EventList.tsx` (full rewrite)

- [ ] **Step 1: Replace `src/pages/calendar.astro`**

```astro
---
import Layout from '../layouts/Layout.astro';
import EventList from '../components/EventList.tsx';
---

<Layout title="Calendar" description="Upcoming BGC sessions — board game nights, TTRPGs, and tournaments in Bangalore">
  <section class="py-14" style="background: #FFF8E7;">
    <div class="max-w-[1200px] mx-auto px-6 text-center">
      <span class="section-tag">What's Happening</span>
      <h1 class="font-heading font-bold" style="font-size: clamp(2.4rem, 5vw, 3.8rem); letter-spacing: -1px;">
        Upcoming Sessions
      </h1>
      <p class="text-lg text-[#1A1A1A]/70 mt-3">
        Pick a date, bring a friend, and roll some dice.
      </p>
    </div>
  </section>

  <section class="pb-20">
    <div class="max-w-[1200px] mx-auto px-6">
      <EventList client:load />
    </div>
  </section>
</Layout>
```

- [ ] **Step 2: Replace `src/components/EventList.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Event } from '../lib/types';

const WORKER_URL = import.meta.env.PUBLIC_WORKER_URL;

interface EventWithSpots extends Event {
  remaining: number | null;
}

function monthKey(date: Date) {
  return date.toLocaleDateString('en-IN', { year: 'numeric', month: 'long' });
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

  if (loading) return <div className="text-center py-16 text-[#1A1A1A]/60 font-heading">Loading sessions...</div>;

  if (events.length === 0) {
    return (
      <div className="text-center py-20">
        <div className="text-6xl mb-4">🎲</div>
        <p className="font-heading text-lg text-[#1A1A1A]/70 mb-4">No upcoming sessions yet — check back soon!</p>
        <a href="https://instagram.com/boardgamecompany" target="_blank" rel="noopener noreferrer" className="font-heading font-semibold text-[#F47B20] no-underline">
          Follow us on Instagram →
        </a>
      </div>
    );
  }

  const grouped = new Map<string, EventWithSpots[]>();
  for (const e of events) {
    const key = monthKey(new Date(e.date));
    const arr = grouped.get(key) ?? [];
    arr.push(e);
    grouped.set(key, arr);
  }

  return (
    <div className="flex flex-col gap-12">
      {Array.from(grouped.entries()).map(([month, monthEvents]) => (
        <section key={month}>
          <div className="mb-6">
            <span className="pill pill-accent inline-block" style={{ fontSize: '1.1rem', padding: '10px 22px', border: '4px solid #1A1A1A', boxShadow: '4px 4px 0 #1A1A1A' }}>
              {month}
            </span>
          </div>
          <div className="grid gap-5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
            {monthEvents.map((event) => (
              <EventCard key={event.id} event={event} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function EventCard({ event }: { event: EventWithSpots }) {
  const eventDate = new Date(event.date);
  const dateStr = eventDate.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
  const time = eventDate.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
  const soldOut = event.remaining !== null && event.remaining <= 0;
  const featured = (event as any).is_featured === true;

  return (
    <div
      className={`card-brutal flex flex-col overflow-hidden ${featured ? 'md:col-span-full' : ''}`}
      style={{ background: '#FFFFFF' }}
    >
      <div
        className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5"
        style={{ background: featured ? '#FFD166' : '#FFFFFF', borderBottom: '4px solid #1A1A1A' }}
      >
        <span className="font-heading font-bold text-base">{dateStr}</span>
        {featured && <span className="pill pill-black" style={{ fontSize: '0.7rem', padding: '6px 12px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Featured</span>}
      </div>
      <div className="flex-1 flex flex-col gap-2.5 px-5 pt-5 pb-5">
        <h3 className="font-heading font-bold text-lg leading-tight">{event.name}</h3>
        <p className="text-sm text-[#1A1A1A]/70 leading-snug">
          📍 {event.venue_name}, {event.venue_area}
        </p>
        <p className="text-sm text-[#1A1A1A]/70">🕐 {time}</p>
        {event.description && (
          <p className="text-sm text-[#1A1A1A]/70 leading-relaxed">{event.description}</p>
        )}
        <div className="flex items-center gap-3 mt-2">
          <span className="font-heading font-bold text-xl">₹{event.price}</span>
          {event.remaining !== null && !soldOut && (
            <span className="text-xs text-[#1A1A1A]/60">
              {event.remaining} spot{event.remaining !== 1 ? 's' : ''} left
            </span>
          )}
        </div>
        <div className="mt-3">
          {soldOut ? (
            <span className="pill" style={{ background: '#E5E5E5', color: '#1A1A1A', border: '2px solid #1A1A1A' }}>Sold Out</span>
          ) : (
            <a href={`/register?event=${event.id}`} className="btn btn-primary btn-sm no-underline">Register →</a>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify in browser**

Open `http://localhost:4321/calendar`.
Check:
- Header: "WHAT'S HAPPENING" tag pill, "Upcoming Sessions" title, subtitle.
- Events grouped by month. Each group header is a big orange pill with thick border + offset shadow (e.g. "May 2026").
- Event cards in a responsive grid: white bg, 4px black border, `md` offset shadow.
- Card top strip: date on the left in Space Grotesk, "FEATURED" black pill on the right if the event is featured.
- Card body: event name, 📍 location, 🕐 time, description (if present), price, "Register →" orange button.
- Featured card (if any) spans full width and has yellow header strip.
- Hover card → translates up-left, shadow grows.
- No upcoming events: emoji + message + Instagram link.
- Registration button links to `/register?event=<id>`.

- [ ] **Step 4: Commit**

```bash
git add src/pages/calendar.astro src/components/EventList.tsx
git commit -m "feat(design): brutalist calendar with month-grouped event cards"
```

---

## Task 8: Guild Path Page + Purchase Flow

**Files:**
- Read first: `src/pages/guild-path.astro`, `src/components/GuildPurchase.tsx`, `src/components/PaymentSheet.tsx` — understand current structure before restyling.
- Modify: `src/pages/guild-path.astro`
- Modify: `src/components/GuildPurchase.tsx`
- Modify: `src/components/PaymentSheet.tsx`

- [ ] **Step 1: Read all three files**

Use the Read tool on each. Note:
- What tiers exist (data-driven vs. hardcoded)
- Each step of the purchase flow (phone → tier → form → payment)
- Current Tailwind classes used on inputs, buttons, cards
- Any tier-specific logic that must be preserved

- [ ] **Step 2: Restyle `src/pages/guild-path.astro`**

Preserve the page structure and any data fetching. Apply the following visual pattern:

```astro
---
import Layout from '../layouts/Layout.astro';
import GuildPurchase from '../components/GuildPurchase.tsx';
// keep any existing imports for tier data / benefits
---

<Layout title="Guild Path" description="Become a BGC Guild member — discounts, free events, and community perks">
  <section class="py-14" style="background: #FFF8E7;">
    <div class="max-w-[1200px] mx-auto px-6 text-center">
      <span class="section-tag">Membership</span>
      <h1 class="font-heading font-bold" style="font-size: clamp(2.4rem, 5vw, 3.8rem); letter-spacing: -1px;">
        Guild Path
      </h1>
      <p class="text-lg text-[#1A1A1A]/70 mt-3 max-w-2xl mx-auto">
        Level up, unlock perks, play more. Join the BGC Guild and get discounts, priority access, and exclusive events.
      </p>
    </div>
  </section>

  <!-- TIER DISPLAY: Keep whatever tier data-source the current page uses.
       Wrap each tier in this pattern (rotate bg colors: #4ECDC4 / #FFD166 / #C3A6FF): -->
  <!--
  <div class="card-brutal p-8" style="background: #4ECDC4;">
    <span class="pill pill-black mb-3 inline-block">TIER NAME</span>
    <h3 class="font-heading font-bold text-3xl mb-2">Tier Title</h3>
    <div class="flex items-baseline gap-1 mb-4">
      <span class="font-heading font-bold text-4xl">₹PRICE</span>
      <span class="text-sm text-[#1A1A1A]/70">/ year</span>
    </div>
    <ul class="space-y-2 mb-6">
      <li class="flex gap-2"><span>✓</span><span>Perk one</span></li>
    </ul>
    <button class="btn btn-black w-full">Choose this tier</button>
  </div>
  -->

  <section class="py-16">
    <div class="max-w-[1200px] mx-auto px-6">
      <GuildPurchase client:load />
    </div>
  </section>

  <!-- Benefits / FAQ section - reuse existing content, wrap each item in a card-brutal -->

  <!-- Community CTA - reuse the orange block pattern from index.astro -->
  <section class="py-16" style="background: #FAFAF5;">
    <div class="max-w-[1200px] mx-auto px-6">
      <div class="card-brutal p-12 md:p-16 text-center relative overflow-hidden" style="background: #F47B20; box-shadow: 8px 8px 0 #1A1A1A;">
        <h2 class="font-heading font-bold text-white" style="font-size: clamp(2rem, 4vw, 3rem); letter-spacing: -1px;">
          Not ready yet?
        </h2>
        <p class="text-white/90 text-lg max-w-xl mx-auto mt-4 mb-8">
          Join our WhatsApp group and try a session first — no commitment, just great games.
        </p>
        <a href="https://chat.whatsapp.com/GL1h4jipksfCW4vm7OtZjp" target="_blank" rel="noopener noreferrer" class="btn btn-black no-underline">
          Join WhatsApp →
        </a>
      </div>
    </div>
  </section>
</Layout>
```

Replace the tier display section above the `GuildPurchase` component with the tier pattern shown in the comment, rotating bg colors across tiers. Preserve any dynamic tier data / pricing / perks arrays from the current file.

- [ ] **Step 3: Restyle `src/components/GuildPurchase.tsx`**

Keep all state, network calls, and step logic exactly as-is. Only change the JSX class names and inline styles. Apply these replacements across the file:

- Every `<input>` → add `className="input-brutal"` (or merge with existing positioning classes)
- Every `<label>` for a form field → add `className="label-brutal"`
- Primary action buttons (Submit, Next, Pay) → `className="btn btn-primary"` (drop existing bg-primary classes)
- Secondary / back buttons → `className="btn btn-secondary"`
- Container cards (e.g. the phone-lookup card, tier selection card, form card) → wrap with `className="card-brutal p-8"` and inline `style={{ background: '#FFFFFF' }}`
- Tier selection cards → same `card-brutal p-6` pattern; selected state gets `style={{ background: '#F47B20', color: '#FFFFFF' }}` and thicker border (`border: '5px solid #1A1A1A'`)
- Error messages → wrap in `<div className="card-brutal p-4 mb-4" style={{ background: '#FF6B6B' }}><p className="font-heading font-semibold">…</p></div>`
- Success messages → same wrapper with `background: '#A8E6CF'` and a ✓ emoji

**Do not change:** data fetching, phone lookup endpoint, tier IDs, discount calculation, or the flow order.

- [ ] **Step 4: Restyle `src/components/PaymentSheet.tsx`**

- Backdrop: `className="fixed inset-0 z-[3000] flex items-center justify-center p-6" style={{ background: 'rgba(0,0,0,0.5)' }}`
- Sheet: `className="card-brutal p-8 max-w-md w-full overflow-y-auto" style={{ background: '#FFF8E7', maxHeight: '90vh', boxShadow: '12px 12px 0 #1A1A1A' }}`
- Close button: `w-8 h-8` rounded-lg, `style={{ background: '#FFFFFF', border: '2px solid #1A1A1A' }}`, shows "✕"
- QR code wrapper: `style={{ padding: '16px', background: '#FFFFFF', border: '4px solid #1A1A1A', boxShadow: '6px 6px 0 #1A1A1A', borderRadius: '16px' }}`
- UPI app buttons (GPay / PhonePe / Paytm): each `className="btn btn-secondary flex-1 no-underline"` with the existing deep-link href.
- UPI ID display: `className="pill pill-yellow text-center"` (so it looks copy-worthy)

**Do not change:** the UPI ID string, deep-link URLs, or any payment logic.

- [ ] **Step 5: Verify in browser**

Open `http://localhost:4321/guild-path`.
Check:
- Header: "MEMBERSHIP" tag pill, "Guild Path" title, subtitle.
- Tier cards: teal / yellow / purple backgrounds (rotating), thick borders, offset shadows, perks with ✓ marks, "Choose this tier" black buttons.
- Hover a tier card → translates up-left.
- `GuildPurchase` renders below: phone lookup input is `input-brutal` (thick border, offset shadow grows on focus).
- Walk through the purchase flow end-to-end with a test phone number. Tier selection, form, and payment sheet all follow the brutalist look. Payment sheet opens as a modal, QR code has thick border, UPI buttons are pill-shaped.
- Community CTA at bottom matches home page style.

- [ ] **Step 6: Commit**

```bash
git add src/pages/guild-path.astro src/components/GuildPurchase.tsx src/components/PaymentSheet.tsx
git commit -m "feat(design): brutalist guild-path tiers and purchase flow"
```

---

## Task 9: Register Page + Forms

**Files:**
- Read first: `src/pages/register.astro`, `src/components/RegistrationForm.tsx`, `src/components/CustomQuestion.tsx` — understand current flow.
- Modify: `src/pages/register.astro`
- Modify: `src/components/RegistrationForm.tsx`
- Modify: `src/components/CustomQuestion.tsx`

- [ ] **Step 1: Read all three files**

Note: event selection UI (if any), phone lookup behavior, guild discount logic, custom-question rendering by type, success/error states, payment-sheet trigger.

- [ ] **Step 2: Restyle `src/pages/register.astro`**

```astro
---
import Layout from '../layouts/Layout.astro';
import RegistrationForm from '../components/RegistrationForm.tsx';
---

<Layout title="Register" description="Register for a BGC session">
  <section class="py-14" style="background: #FFF8E7;">
    <div class="max-w-[1200px] mx-auto px-6 text-center">
      <span class="section-tag">Register</span>
      <h1 class="font-heading font-bold" style="font-size: clamp(2.4rem, 5vw, 3.8rem); letter-spacing: -1px;">
        Register for a Session
      </h1>
      <p class="text-lg text-[#1A1A1A]/70 mt-3 max-w-xl mx-auto">
        Fill in your details — we'll confirm your spot.
      </p>
    </div>
  </section>

  <section class="pb-20">
    <div class="max-w-[720px] mx-auto px-6">
      <div class="overflow-hidden rounded-2xl" style="background: #FFFFFF; border: 4px solid #1A1A1A; box-shadow: 8px 8px 0 #1A1A1A;">
        <div style="height: 12px; background: #F47B20; border-bottom: 3px solid #1A1A1A;"></div>
        <div class="p-6 md:p-10">
          <RegistrationForm client:load />
        </div>
      </div>
    </div>
  </section>
</Layout>
```

- [ ] **Step 3: Restyle `src/components/RegistrationForm.tsx`**

Keep all state, network calls, lookup-phone, and register flow intact. Replacements:

- Every `<input type="text|tel|email|number">` → `className="input-brutal"`
- Every `<label>` → `className="label-brutal"`
- Textarea → `className="input-brutal"` with `style={{ minHeight: '100px' }}`
- Submit button → `className="btn btn-primary w-full"` (full-width on mobile)
- Back/cancel buttons → `className="btn btn-secondary"`
- Error block at the top of the form: `<div className="rounded-xl p-4 mb-5" style={{ background: '#FF6B6B', border: '3px solid #1A1A1A', boxShadow: '4px 4px 0 #1A1A1A', color: '#1A1A1A', fontWeight: 600 }}>…</div>`
- Welcome-back pill (after phone lookup): `<span className="pill" style={{ background: '#A8E6CF', color: '#1A1A1A' }}>✓ Welcome back, {name}!</span>`
- Guild member pill: `<span className="pill" style={{ background: '#C3A6FF', color: '#1A1A1A' }}>👑 {tierName} — {discount}% off</span>`
- Event-selection cards (if they exist on this page) → use the same `EventCard` pattern as calendar but add a "selected" style: `style={{ background: '#F47B20', color: '#FFFFFF', border: '5px solid #1A1A1A' }}`
- Seats stepper: two square buttons `className="w-10 h-10 rounded-lg font-heading font-bold cursor-pointer" style={{ background: '#FFFFFF', border: '2px solid #1A1A1A', boxShadow: '3px 3px 0 #1A1A1A' }}` with a number in between.
- Price summary card: `className="card-brutal p-6 mt-6" style={{ background: '#FFD166' }}` with line items and a big total.
- Success state: replaces the form with `<div className="card-brutal p-10 text-center" style={{ background: '#A8E6CF' }}><div className="text-6xl mb-4">✅</div><h2 className="font-heading font-bold text-3xl mb-2">You're in! 🎲</h2><p>…details…</p></div>` — then the existing PaymentSheet trigger.

**Do not change:** `POST /api/lookup-phone`, `POST /api/register`, `GET /api/event-spots`, `custom_questions` flow, discount math.

- [ ] **Step 4: Restyle `src/components/CustomQuestion.tsx`**

For each question type, apply:
- **Text / textarea:** `className="input-brutal"`, label uses `className="label-brutal"`.
- **Radio group:** render each option as a pill-button (not a native radio):
  ```tsx
  <button
    type="button"
    onClick={() => setValue(opt)}
    className="font-heading font-semibold rounded-lg px-4 py-2 cursor-pointer"
    style={{
      border: '2px solid #1A1A1A',
      background: value === opt ? '#1A1A1A' : '#FFFFFF',
      color: value === opt ? '#FFFFFF' : '#1A1A1A',
    }}
  >{opt}</button>
  ```
- **Checkbox group:** same pill pattern; toggle values on click.
- **Select (dropdown):** `<select>` styled as `className="input-brutal font-heading font-semibold"`.
- Question label above each group: `className="label-brutal"`.

**Do not change:** the question-type switching logic, value propagation to the parent form, or the `custom_questions` JSONB shape.

- [ ] **Step 5: Verify in browser**

Open `http://localhost:4321/register` (and also `http://localhost:4321/register?event=<real-event-id>` if there's a real event).
Check:
- Header: "REGISTER" tag pill, title, subtitle.
- Form wrapper: white card, 4px border, 8px offset shadow, orange accent strip at top.
- Phone field: `input-brutal` style. Type a known phone, blur → existing user autofills name/email, green welcome pill appears. Guild member → purple pill with tier/discount.
- Custom questions (if the selected event has them): render as radio/checkbox pill-buttons or `input-brutal` inputs.
- Seats stepper: two square +/- buttons with offset shadow.
- Price summary card: yellow bg, shows line items and a big total.
- Submit → success state: green card with ✅ emoji and "You're in! 🎲". Payment sheet trigger works.
- Error (e.g. submit without a name): pink card with error message at the top of the form.

- [ ] **Step 6: Commit**

```bash
git add src/pages/register.astro src/components/RegistrationForm.tsx src/components/CustomQuestion.tsx
git commit -m "feat(design): brutalist register form with pill inputs and stepper"
```

---

## Task 10: Final Verification & Cleanup

**Files:**
- Possibly modify: `src/styles/global.css` (remove transitional/legacy aliases if nothing still references them)
- Possibly modify: any page still using removed Tailwind classes (`text-muted`, `border-border`, etc. that weren't replaced)

- [ ] **Step 1: Grep for legacy classes**

Run:
```bash
rg -n "text-muted|border-border|bg-bg\b|text-secondary/|hover:bg-primary-dark|bg-accent|hover:bg-accent|hover:bg-secondary" src/
```

Expected: very few or no matches. For each match found, replace with the brutalist equivalent:
- `text-muted` → inline `className="text-[#1A1A1A]/70"` or `style={{ opacity: 0.7 }}`
- `border-border` → `style={{ border: '3px solid #1A1A1A' }}`
- `bg-bg` → `style={{ background: '#FFF8E7' }}`
- `bg-accent` (where it meant teal) → `style={{ background: '#4ECDC4' }}`
- Any `rounded-full` on a button → drop, replaced by `.btn` variants

- [ ] **Step 2: Remove legacy aliases from `src/styles/global.css`**

Once grep is clean, delete these lines from the `@theme` block:
```
  --color-bg: #FFF8E7;
  --color-secondary: #1A1A1A;
  --color-accent: #4ECDC4;
  --color-muted: #6B6B6B;
  --color-border: #1A1A1A;
```

- [ ] **Step 3: Build cleanly**

Run: `npm run build`
Expected: success with no unknown-class warnings.

- [ ] **Step 4: Walk through every page**

With `npm run dev` running, open each URL and exercise the primary flow:

- `http://localhost:4321/` — hero, upcoming event, what-we-do cards hover, guild teaser, community CTA. Resize to 480/768/968/1200px.
- `http://localhost:4321/library` — search, filter chips, click a card → modal → close via ✕, overlay, Escape.
- `http://localhost:4321/calendar` — month groups, event cards, "Register →" link goes to `/register?event=<id>`.
- `http://localhost:4321/guild-path` — tier display, click "Choose this tier" → walk the phone lookup → tier → form → payment sheet (cancel at payment).
- `http://localhost:4321/register` and `http://localhost:4321/register?event=<id>` — event selection (if shown), phone lookup populating name/email, custom questions (if event has them), submit → success → payment sheet (cancel at payment).

Also:
- Mobile menu at 768px, all links navigate.
- Console: no errors on any page.
- Network: Supabase reads succeed on home/library/calendar; Worker calls succeed on guild-path/register.

- [ ] **Step 5: Commit cleanup**

```bash
git add -A
git commit -m "chore(design): remove legacy color aliases and Tailwind classes"
```

- [ ] **Step 6: Push**

```bash
git push
```

Cloudflare Pages auto-deploys from `main`. Worker changes: none in this plan, so no `wrangler deploy` needed.

---

## Self-Review Notes

- **Spec coverage:** All 7 spec sections (Design System, Navigation & Layout, Home, Library, Calendar, Guild Path, Register, Cross-Cutting) map to tasks 1–10. Cross-cutting concerns are folded into individual tasks plus the final cleanup.
- **Color tokens:** Primary = `#F47B20` (orange, BGC brand). Yellow `#FFD166` used as secondary highlight only (on cards, pills). Both match the approved spec.
- **What we intentionally don't test:** Cross-browser behavior beyond Chromium — BGC's users skew mobile-Safari / Chrome Android; a quick real-device check after deploy is advised but not gated by this plan.
- **Preserved functionality (unchanged):** Supabase schema, RLS, all three Worker endpoints, UPI payment logic, `custom_questions` JSONB, `GameCount` data flow, hero image assets.
- **Manual data dependencies:** Task 5 assumes `/public/landing-photos/1.png` is a good hero photo; swap to a different photo by filename if preferred.
