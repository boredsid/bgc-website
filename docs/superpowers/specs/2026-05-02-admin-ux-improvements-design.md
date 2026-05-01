# Admin Tool UX Improvements — Design

**Status:** Drafted 2026-05-02
**Scope:** UX redesign of `admin.boardgamecompany.in` across all five existing pages (Dashboard, Events, Games, Registrations, Guild) plus the shell. No new entities, no schema changes.
**Approach:** Foundation-first phasing (Phase 1 ships shared primitives; Phases 2–4 consume them). Mobile-first throughout, installable as a PWA.

## Context

The admin tool was deployed in Phase 0–1 of the original plan (`docs/superpowers/plans/2026-05-01-admin-tool.md`) and now contains all five list pages, drawer-based forms, a dashboard summary, and Cloudflare Access auth. It works, but the UX is generic shadcn-neutral with no brand identity, no PWA shell, dense tables that don't reflow well on phones, no inline validation, no global search, and no bulk actions.

**Users:** four non-technical admins. Two usage modes:
- **Mobile, on the go** — phone-first lookups and quick actions between other tasks. The primary mode.
- **Laptop, from home** — bulk processing of backlog (registrations, guild verifications, exports).

**Guiding principles** (from existing memory + this brainstorm):
- No raw JSON anywhere; structured forms with plain-English labels and validation.
- Confirm destructive actions with clear consequences.
- Minimize data entry: autofill, smart defaults, phone-first flows, single-tap actions, type-ahead, forgiving input parsing.

## Phasing overview

| Phase | Theme | Visible to admins? |
|------|------|------|
| 1 | Design system, shell, PWA, primitives | No (foundation only) |
| 2 | Forms & data entry | Yes — every drawer improves |
| 3 | Mobile on-the-go workflows | Yes — biggest mobile win |
| 4 | Laptop bulk actions | Yes — biggest desktop win |

Each phase ships as one PR via the existing Cloudflare Pages auto-deploy.

---

## Phase 1 — Design system & shell

### Brand reconciliation

Adopt the public site's identity:
- **Palette** (mapped to Tailwind 4 CSS variables in `admin/src/index.css`, mirroring token names from the public `src/styles/global.css`):
  - primary `#F47B20`
  - background `#FFF8F0`
  - secondary `#1A1A1A`
  - accent `#4A9B8E`
  - highlight `#FFD166`
- **Typography**: Space Grotesk (headings), Inter (body), loaded via `<link>` in `admin/index.html` matching the public site.
- **Logo**: replace the `font-semibold "BGC Admin"` text in `Sidebar.tsx` with `bgc-logo.png` (28px) + an "Admin" wordmark beside it.

### Shared primitives (new files in `admin/src/components/`)

- **`StatusBadge.tsx`** — colored pill with semantic variants: `confirmed`, `pending`, `cancelled`, `paid`, `draft`, `published`. Replaces today's plain text status cells. Includes the status word in text (not color-only) for accessibility.
- **`RelativeDate.tsx`** — formats dates as "Sat 8 May, 7:30 pm" or "in 3 days". Uses `<time>` semantics with a `title` attribute for the full ISO timestamp on hover.
- **`PhoneCell.tsx`** — renders `+91 XXXXX XXXXX`; primary tap/click opens WhatsApp via `https://wa.me/91...`; long-press / right-click copies to clipboard. Includes an `aria-label`.
- **`MobileCardList.tsx`** — accepts the same `Column[]` config as `DataTable`, renders rows as cards on `< md` viewports.
- **`Skeleton.tsx`** (already in shadcn) — used wherever `"Loading…"` text appears today; sized to match the mobile-card layout. Appears after a 150ms delay.

### `DataTable` upgrade

`MobileCardList` becomes the **default** render path; `<table>` is what desktop opts into. The component now:
- Accepts `sortable: true` per column with a comparator. Click-to-sort with visual indicator. Sort state persists in URL params (`?sort=date.desc`).
- Truncates long cells with a `title` tooltip showing full content.
- Optional `dense: boolean` halves row padding for high-density desktop tables.
- Optional `selectable: true` exposes a multi-select checkbox column and `selectedIds` state for bulk-action toolbars (consumed in Phase 4).

### Shell (`Layout.tsx`, `TopBar.tsx`, `Sidebar.tsx`, new `BottomTabBar.tsx`)

- **Mobile (`< md`)**: bottom tab bar with the four most-used destinations (Dashboard, Registrations, Guild, Events). Games goes into a "More" sheet. The current hamburger drawer pattern is removed on mobile — bottom tabs are the PWA-native pattern. Safe-area insets respected via `env(safe-area-inset-bottom)`.
- **Desktop (`≥ md`)**: existing left sidebar stays. Each sidebar item gains a count badge for surfacing pending work (e.g. Guild "3" pending, Registrations "5" pending today). Counts come from `/api/admin/summary` (extend the endpoint to include `pending_registration_count` — `pending_guild_count` already exists).
- **TopBar mobile**: page title + search icon. Email/sign-out move to a profile sheet behind a tap on the avatar circle in the bottom tab bar.
- **TopBar desktop**: gains a global search input (Cmd-K / "/" shortcut). Initials in a colored circle next to the email.
- All interactive surfaces have **tap targets ≥ 44px**.

### PWA

- `manifest.webmanifest` at `admin/public/manifest.webmanifest` with `display: standalone`, `theme_color: #F47B20`, `background_color: #FFF8F0`, app name "BGC Admin". Brand icons (192/512/maskable) generated from `bgc-logo.png`.
- Service worker (`admin/public/sw.js`) caches the app shell + last-fetched API responses for offline read. Mutations refuse when offline (no optimistic queueing — too risky for a payment-adjacent tool).
- An "Offline — last updated 12 min ago" banner appears at the top of pages when serving cached data.
- A "You're offline. Connect to save." toast appears on attempted mutations.

### Out of scope for Phase 1

Search behavior itself, bulk actions, validation, custom-question preview, mobile card flows. Phase 1 ships the primitives; later phases consume them.

---

## Phase 2 — Forms & data entry

### `FormDrawer` wrapper

A new wrapper used by every drawer page (`EventDrawer`, `GameDrawer`, `GuildDrawer`, `UserDrawer`, `RegistrationDrawer`, `ManualRegistrationDrawer`):
- **Single-column layout by default**. Two-column rows are opt-in only when both fields are short (capacity + price). The current `grid-cols-2` everywhere is removed.
- **Bottom-up sheet on mobile** (`side="bottom"`, full height with rounded top); **right-side on desktop** (`side="right"`, max-width 640).
- Sticky footer with Cancel / Save respecting safe-area insets.
- Top-of-sheet error banner when the API rejects with field details.

### Field-level validation

- New `admin/src/lib/validation.ts` with per-entity schemas (events, games, guild members, registrations). Pure functions returning `{ field: message }` maps. No new dependency.
- Plain-English messages: "Please enter a name", "Date must be in the future", "Capacity must be at least 1".
- Inline errors render under each `Label` in red text + red ring on the input.
- Save runs validation first; first errored field is scrolled-into-view + focused.
- Save button shows a count when blocked: "Save (2 issues)".

### Input ergonomics

- **Number inputs**: switch from `value={0}` to `value=""` placeholder pattern using `string | number` state. `0` only displays when the user types it. Forgiving parser strips currency symbols and whitespace ("₹100" → 100).
- **Phone inputs**: accept with or without `+91` country code; normalize on save.
- **Date/time**: replace `<input type="datetime-local">` with a custom picker (date drop-down + time drop-down with 30-minute increments). Reasons: native `datetime-local` on iOS Safari is awkward in a PWA and timezone-confusing.
- **Discard guard**: replace `confirm('Discard changes?')` with a styled modal (default `confirm()` looks broken in a standalone PWA).

### Smart defaults / autofill

- **New event** copies date (shifted forward), venue, price, capacity, custom_questions from the most recent published event.
- **Venue name** is an autocomplete fed by distinct values from past events.
- **Manual registration** uses phone-first: type phone → if user exists, autofill name/email + show their guild status badge → else show fresh fields. Defaults to the most recently worked-on event (stored in localStorage).
- **Custom question type-ahead** for free-text option lists where the same options recur across events.

### Custom Questions editor — live preview

- Two-tab UI on mobile (Edit / Preview), side-by-side on `≥ lg`.
- Preview renders questions exactly as they appear on the public registration form. Public-site rendering logic is extracted into a shared `lib/renderCustomQuestions.tsx` consumed by both the public form and the admin preview.
- Adds a "Required for Initiate / Adventurer / Guildmaster" hint per question (since custom questions can be tier-conditional).

---

## Phase 3 — Mobile on-the-go workflows

### Global "Find someone" search

- TopBar search affordance from Phase 1 wires up here.
- Tap → full-screen search overlay (PWA pattern, not a dropdown).
- Single input, phone-first matching: "98765" → phone numbers; "amrit" → names; "@gmail" → emails.
- Results grouped by entity type with counts: "Registrations (3) · Guild members (1) · Past attendees (2)". Tap → relevant detail page.
- Recent searches stored in localStorage, shown when the input is empty.
- Keyboard shortcut `/` or `Cmd-K` on desktop.
- Backed by a new `GET /api/admin/search?q=` endpoint that does a single PostgREST query across `users`, `registrations`, `guild_members` and returns a unified list.

### Registrations — mobile card layout

Each card shows: name (large), phone, event, status badge, total. Right side: WhatsApp icon + 3-dot menu.

- 3-dot menu opens a bottom action sheet: "Mark confirmed", "Mark pending", "Mark cancelled", "Edit details", "Copy phone". Single-tap status change without opening the drawer.
- Status pill is itself tappable → opens the same action sheet pre-scrolled to status options.
- Pull-to-refresh.
- Sticky filter bar; on mobile the filter sheet is bottom-up.

### Guild — pending verification

On `/guild?status=pending` (where the dashboard banner deep-links to), each card surfaces two big buttons inline: ✓ "Mark paid" and ✗ "Mark cancelled". Tapping "Mark paid" prompts only for the start date (defaulting to today); expiry auto-calculated by tier. Long-press / 3-dot menu opens the full drawer for less-common edits.

### Events — mobile card

Card shows: name, relative date, capacity bar, registration count, published/draft badge. Tap → drawer.

- "New event" is a floating action button (FAB) bottom-right above the tab bar. Same FAB pattern across all list pages where creation is the primary action.

### Dashboard reflow on mobile

- Pending-guild banner stays first (already is).
- Upcoming events stack vertically. Each card collapses custom-question summaries into a "View breakdown" button (tap → expands or opens a detail sheet). Without collapse, cards get too tall to scan.
- Past events section starts collapsed (already does).

### Offline behavior

- **Read paths cached**: dashboard, list, and detail data viewable while offline; "Offline — last updated 12 min ago" banner appears.
- **Mutations refuse**: clear "You're offline. Connect to save." toast — no optimistic queueing.

---

## Phase 4 — Laptop bulk actions

`≥ md` only — bulk multi-select doesn't make sense on a phone.

### Multi-select

- Phase 1's `DataTable` `selectable: true` capability wires into Registrations, Guild, and Games.
- Checkbox column on the left when `selectable` is on. Header checkbox toggles all visible rows. Shift-click range select.
- Sticky **`BulkActionBar.tsx`** slides down when ≥ 1 row is selected: "3 selected · [page-specific actions] · Clear".

### Per-page bulk actions

- **Registrations**: Mark confirmed / pending / cancelled, Export CSV, Generate WhatsApp broadcast list (copies comma-separated phones + a templated message to clipboard for paste into WhatsApp Web).
- **Guild members**: Mark paid / cancelled, Export CSV, Send renewal reminder (clipboard pattern as above).
- **Games**: Bulk update "Currently with" (one input applies to all selected — common when someone returns 5 games at once), Export CSV.

### Confirmations

- Bulk destructive actions confirm with a styled modal showing count + sample names: "Cancel 5 registrations? Including Amrit, Suranjana, +3 more."
- Non-destructive bulk changes skip the confirmation but show an undo toast for 8 seconds.

### CSV export

- Server endpoints `GET /api/admin/registrations/export`, `/api/admin/guild-members/export`, `/api/admin/games/export`. Honor active filters when no `ids`; honor selection when `ids` is passed.
- Page-specific columns. Registrations export expands custom-question answers as separate columns.
- File names: `registrations-2026-05-02.csv`, etc.

### Sortable columns

Phase 1 added the capability; Phase 4 enables sort on:
- **Registrations**: date, event, status, total
- **Guild**: expiry, tier, status
- **Games**: title, currently with
- **Events**: date, capacity

### Saved filter views

A "Save this view" link next to the filters. Saved views go into localStorage as named presets, listed in a dropdown next to the filter bar. Per-admin, per-page. Not synced server-side — keeps it lightweight.

### Inline edit on the desktop table

For two high-frequency fields, allow inline edit without opening the drawer:
- **Registrations**: status pill is itself a clickable dropdown trigger (pending/confirmed/cancelled). One click to open, one click to choose.
- **Games**: "Currently with" cell is click-to-edit (turns into an inline text input with the same autocomplete used on the drawer; commits on blur or Enter, cancels on Escape).

Saves with an inline spinner; rolls back + toasts on error.

### Out of scope

Scheduled reports, email integration, custom report builder.

---

## Cross-cutting concerns (apply to all phases)

### Loading states

Every `"Loading…"` becomes a `Skeleton` shaped like the real content (card skeletons on mobile, table-row skeletons on desktop, form-field skeletons in drawers). 150ms delay before showing.

### Empty states

Each list defines its own:
- **Registrations (no filter)**: illustration + "No registrations yet · Add manual registration".
- **Registrations (filtered)**: "No registrations match these filters · Clear filters".
- **Guild (pending)**: "Nothing waiting — you're caught up."
- **Games**: "No games yet · Add a game".

### Error states

- API errors render as a top-of-page red banner with the plain-English message + a Retry button (not a vanishing toast). Toasts stay for save confirmations and undo prompts.
- Validation errors stay inline (Phase 2).
- Worker 401s (Cloudflare Access expired) trigger a full-page interstitial with a "Sign in again" button.

### Accessibility

- Every icon-only interactive element has an `aria-label`.
- Focus rings stay visible.
- Bottom sheets and drawers trap focus and restore it on close.
- Status badges include the status word in text (not color-only).

### Telemetry

A thin `admin/src/lib/log.ts` posts uncaught errors to a new `POST /api/admin/log` endpoint. Worker stores the last 200 client errors. Cheaper than Sentry, enough to spot regressions when 4 admins hit problems they don't report.

### Testing

- Vitest + Testing Library component tests for each new primitive: `StatusBadge`, `RelativeDate`, `PhoneCell`, `MobileCardList`, `FormDrawer`, validation functions, `BulkActionBar`. Pattern: existing `CustomQuestionsEditor.test.tsx`.
- No E2E — Cloudflare Access in front makes the setup cost not worth it. Manual checklist instead, run on phone (iOS Safari + Android Chrome) and desktop (Chrome) before each phase ships.
- Visual diff: before/after screenshots of every list and drawer at 375px and 1280px widths attached to each phase PR.

### Rollout

- Phase 1 is invisible to admins until consumed. No feature flag; safe to ship directly.
- Phases 2/3/4 ship as one PR each via the existing Cloudflare Pages auto-deploy. Manual verification by Siddhant before merging to `main`.
- No DB migrations expected. Worker gains five new endpoints, all additive:
  - `GET /api/admin/search`
  - `GET /api/admin/registrations/export`
  - `GET /api/admin/guild-members/export`
  - `GET /api/admin/games/export`
  - `POST /api/admin/log`
  Existing `/api/admin/summary` extends to include `pending_registration_count`.

## File map summary

**New files:**
- `admin/src/components/StatusBadge.tsx`
- `admin/src/components/RelativeDate.tsx`
- `admin/src/components/PhoneCell.tsx`
- `admin/src/components/MobileCardList.tsx`
- `admin/src/components/BottomTabBar.tsx`
- `admin/src/components/FormDrawer.tsx`
- `admin/src/components/BulkActionBar.tsx`
- `admin/src/lib/validation.ts`
- `admin/src/lib/log.ts`
- `admin/src/lib/renderCustomQuestions.tsx` (extracted from public site)
- `admin/public/manifest.webmanifest`
- `admin/public/sw.js`
- Per-phase Vitest files alongside the new components.

**Modified:**
- `admin/src/index.css` — palette tokens, fonts.
- `admin/index.html` — font links, manifest link, theme-color meta.
- `admin/src/components/Layout.tsx`, `Sidebar.tsx`, `TopBar.tsx`, `DataTable.tsx`, `DashboardCard.tsx`, `CustomQuestionsEditor.tsx`.
- All five list pages and all six drawers under `admin/src/pages/`.
- `worker/src/` — five new endpoints + `pending_registration_count` in summary.
- `src/components/RegistrationForm.tsx` (public site) — refactor question rendering into `lib/renderCustomQuestions.tsx` for shared use.

## Open questions

None blocking. The implementation plan can pick up directly.
