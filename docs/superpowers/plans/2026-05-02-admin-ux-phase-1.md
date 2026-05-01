# Admin UX Improvements — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the foundational design system and primitives for the BGC admin tool — brand reconciliation (palette + fonts + logo), PWA shell upgrades (mobile bottom tabs, theme color), shared primitives (`StatusBadge`, `RelativeDate`, `PhoneCell`, `MobileCardList`, `BottomTabBar`, `Skeleton`, `Loading`), `DataTable` upgrade (sortable / dense / selectable / mobile delegation), and one Worker endpoint extension. No visible workflow changes for admins yet — primitives only.

**Architecture:** All work lives in `admin/src/components/`, `admin/src/index.css`, `admin/index.html`, `admin/public/manifest.webmanifest`, and one Worker file (`worker/src/admin/summary.ts`). New primitives consume Tailwind 4 brand tokens defined in `index.css`. The admin keeps a clean, productivity-tool aesthetic (no neo-brutalist borders/shadows from the public site — admin is dense data work).

**Tech Stack:** React 19, Tailwind 4 (CSS `@theme` config), shadcn/ui (Radix primitives + class-variance-authority), Vitest + Testing Library, react-router-dom 7, Cloudflare Workers (Phase 1 touches one endpoint).

**Spec reference:** `docs/superpowers/specs/2026-05-02-admin-ux-improvements-design.md` — Phase 1 section.

---

## File Structure

**New files:**
- `admin/src/components/StatusBadge.tsx`
- `admin/src/components/StatusBadge.test.tsx`
- `admin/src/components/RelativeDate.tsx`
- `admin/src/components/RelativeDate.test.tsx`
- `admin/src/components/PhoneCell.tsx`
- `admin/src/components/PhoneCell.test.tsx`
- `admin/src/components/MobileCardList.tsx`
- `admin/src/components/MobileCardList.test.tsx`
- `admin/src/components/BottomTabBar.tsx`
- `admin/src/components/BottomTabBar.test.tsx`
- `admin/src/components/Loading.tsx`
- `admin/src/components/Loading.test.tsx`
- `admin/src/components/ui/skeleton.tsx`
- `admin/public/bgc-logo.png` (copied from `public/bgc-logo.png`)

**Modified files:**
- `admin/src/index.css` — replace neutral palette with BGC brand tokens, set fonts.
- `admin/index.html` — Google Fonts links, updated `theme-color`.
- `admin/public/manifest.webmanifest` — brand colors, icon entries.
- `admin/src/components/Sidebar.tsx` — logo + count badges.
- `admin/src/components/TopBar.tsx` — search affordance, simplified mobile.
- `admin/src/components/Layout.tsx` — bottom tab bar on mobile, summary fetch.
- `admin/src/components/DataTable.tsx` — sortable / dense / selectable / mobile delegation.
- `worker/src/admin/summary.ts` — add `pending_registration_count`.
- `worker/src/admin/summary.test.ts` — assert new field.

---

## Conventions used in this plan

- All commands assume CWD `/Users/siddhantnarula/Projects/bgc-website` unless a `cd` is shown.
- Tests run with `cd admin && npm test -- <pattern>` (or `cd worker && npm test -- <pattern>` for Worker tests).
- Each task ends with a single `git add <files>` + `git commit` step. Commit messages follow the existing convention: `feat(admin):` / `fix(admin):` / `refactor(admin):`.

---

## Task 1: Brand palette tokens

**Files:**
- Modify: `admin/src/index.css`

- [ ] **Step 1: Replace the neutral palette in `index.css`**

Replace the entire `@theme { ... }` block (lines 3–24) and the `body` rule (line 27) with:

```css
@theme {
  /* BGC palette */
  --color-primary: #F47B20;
  --color-primary-foreground: #FFFFFF;
  --color-primary-hover: #D96A15;
  --color-secondary: #1A1A1A;
  --color-secondary-foreground: #FFFFFF;
  --color-accent: #4A9B8E;
  --color-accent-foreground: #FFFFFF;
  --color-highlight: #FFD166;
  --color-highlight-foreground: #1A1A1A;
  --color-error: #DC2626;
  --color-error-foreground: #FFFFFF;

  /* Surfaces */
  --color-background: #FFF8F0;
  --color-foreground: #1A1A1A;
  --color-card: #FFFFFF;
  --color-card-foreground: #1A1A1A;
  --color-popover: #FFFFFF;
  --color-popover-foreground: #1A1A1A;
  --color-muted: #F5EFE5;
  --color-muted-foreground: #6B6357;
  --color-border: #E8DECF;
  --color-input: #E8DECF;
  --color-ring: #F47B20;
  --color-destructive: #DC2626;
  --color-destructive-foreground: #FFFFFF;

  /* Status badge surfaces */
  --color-status-confirmed: #DCFCE7;
  --color-status-confirmed-foreground: #14532D;
  --color-status-pending: #FEF3C7;
  --color-status-pending-foreground: #78350F;
  --color-status-cancelled: #FEE2E2;
  --color-status-cancelled-foreground: #7F1D1D;
  --color-status-paid: #DBEAFE;
  --color-status-paid-foreground: #1E3A8A;
  --color-status-draft: #F1F5F9;
  --color-status-draft-foreground: #334155;
  --color-status-published: #DCFCE7;
  --color-status-published-foreground: #14532D;

  --radius: 0.5rem;

  --font-heading: 'Space Grotesk', system-ui, sans-serif;
  --font-body: 'Inter', system-ui, sans-serif;
}

html, body, #root { height: 100%; }
body {
  font-family: var(--font-body);
  background: var(--color-background);
  color: var(--color-foreground);
}
h1, h2, h3, h4, h5, h6 { font-family: var(--font-heading); }
```

- [ ] **Step 2: Run dev build to confirm CSS parses**

```bash
cd admin && npm run build
```

Expected: build succeeds (no Tailwind errors).

- [ ] **Step 3: Commit**

```bash
git add admin/src/index.css
git commit -m "feat(admin): adopt BGC brand palette tokens"
```

---

## Task 2: Load brand fonts

**Files:**
- Modify: `admin/index.html`

- [ ] **Step 1: Add font preconnect + stylesheet links inside `<head>`**

Insert these lines just before the existing `<title>` tag in `admin/index.html`:

```html
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      rel="stylesheet"
      href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@400;500;600;700&display=swap"
    />
```

- [ ] **Step 2: Update `theme-color` meta tag**

Replace the existing `<meta name="theme-color" content="#0a0a0a" />` line with:

```html
    <meta name="theme-color" content="#F47B20" />
```

- [ ] **Step 3: Run dev server, verify fonts load**

```bash
cd admin && npm run dev
```

Open `http://localhost:5173`, open DevTools Network tab, confirm `Space+Grotesk` and `Inter` requests return 200. Stop server (Ctrl-C).

- [ ] **Step 4: Commit**

```bash
git add admin/index.html
git commit -m "feat(admin): load Space Grotesk + Inter, brand theme-color"
```

---

## Task 3: Update PWA manifest with brand colors

**Files:**
- Modify: `admin/public/manifest.webmanifest`

- [ ] **Step 1: Replace manifest contents**

Overwrite `admin/public/manifest.webmanifest` with:

```json
{
  "name": "BGC Admin",
  "short_name": "BGC Admin",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#FFF8F0",
  "theme_color": "#F47B20",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

- [ ] **Step 2: Verify with build**

```bash
cd admin && npm run build
```

Expected: build succeeds; `dist/manifest.webmanifest` matches the new content.

- [ ] **Step 3: Commit**

```bash
git add admin/public/manifest.webmanifest
git commit -m "feat(admin): brand PWA manifest with BGC colors"
```

---

## Task 4: Add Skeleton primitive (shadcn pattern)

**Files:**
- Create: `admin/src/components/ui/skeleton.tsx`

- [ ] **Step 1: Create `skeleton.tsx`**

Write `admin/src/components/ui/skeleton.tsx`:

```tsx
import { cn } from '@/lib/utils';

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="skeleton"
      className={cn('animate-pulse rounded-md bg-muted', className)}
      {...props}
    />
  );
}
```

- [ ] **Step 2: Verify it imports cleanly**

```bash
cd admin && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add admin/src/components/ui/skeleton.tsx
git commit -m "feat(admin): add shadcn skeleton primitive"
```

---

## Task 5: `Loading` wrapper that delays skeleton render by 150ms

**Files:**
- Create: `admin/src/components/Loading.tsx`
- Test: `admin/src/components/Loading.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `admin/src/components/Loading.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { Loading } from './Loading';

describe('Loading', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('renders nothing for first 150ms', () => {
    render(<Loading><div data-testid="skel">x</div></Loading>);
    expect(screen.queryByTestId('skel')).toBeNull();
    act(() => { vi.advanceTimersByTime(149); });
    expect(screen.queryByTestId('skel')).toBeNull();
  });

  it('renders children after 150ms', () => {
    render(<Loading><div data-testid="skel">x</div></Loading>);
    act(() => { vi.advanceTimersByTime(150); });
    expect(screen.getByTestId('skel')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test, verify failure**

```bash
cd admin && npm test -- Loading.test
```

Expected: FAIL — `Loading` not found.

- [ ] **Step 3: Implement `Loading.tsx`**

Create `admin/src/components/Loading.tsx`:

```tsx
import { useEffect, useState } from 'react';

interface Props {
  children: React.ReactNode;
  delayMs?: number;
}

export function Loading({ children, delayMs = 150 }: Props) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShow(true), delayMs);
    return () => clearTimeout(t);
  }, [delayMs]);
  if (!show) return null;
  return <>{children}</>;
}
```

- [ ] **Step 4: Run test, verify pass**

```bash
cd admin && npm test -- Loading.test
```

Expected: PASS (2/2).

- [ ] **Step 5: Commit**

```bash
git add admin/src/components/Loading.tsx admin/src/components/Loading.test.tsx
git commit -m "feat(admin): add Loading wrapper with 150ms skeleton delay"
```

---

## Task 6: `StatusBadge` primitive

**Files:**
- Create: `admin/src/components/StatusBadge.tsx`
- Test: `admin/src/components/StatusBadge.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `admin/src/components/StatusBadge.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusBadge } from './StatusBadge';

describe('StatusBadge', () => {
  it('renders the status as visible text (not color-only)', () => {
    render(<StatusBadge status="confirmed" />);
    expect(screen.getByText('Confirmed')).toBeInTheDocument();
  });

  it('applies a status-specific class for each variant', () => {
    const { container } = render(<StatusBadge status="pending" />);
    const span = container.querySelector('span');
    expect(span?.className).toMatch(/status-pending/);
  });

  it('handles all known variants without throwing', () => {
    const variants = ['confirmed', 'pending', 'cancelled', 'paid', 'draft', 'published'] as const;
    for (const v of variants) {
      render(<StatusBadge status={v} />);
    }
    expect(screen.getAllByText(/confirmed|pending|cancelled|paid|draft|published/i).length).toBe(6);
  });
});
```

- [ ] **Step 2: Run test, verify failure**

```bash
cd admin && npm test -- StatusBadge.test
```

Expected: FAIL — `StatusBadge` not found.

- [ ] **Step 3: Implement `StatusBadge.tsx`**

Create `admin/src/components/StatusBadge.tsx`:

```tsx
import { cn } from '@/lib/utils';

export type Status = 'confirmed' | 'pending' | 'cancelled' | 'paid' | 'draft' | 'published';

const styles: Record<Status, string> = {
  confirmed: 'bg-status-confirmed text-status-confirmed-foreground status-confirmed',
  pending: 'bg-status-pending text-status-pending-foreground status-pending',
  cancelled: 'bg-status-cancelled text-status-cancelled-foreground status-cancelled',
  paid: 'bg-status-paid text-status-paid-foreground status-paid',
  draft: 'bg-status-draft text-status-draft-foreground status-draft',
  published: 'bg-status-published text-status-published-foreground status-published',
};

const labels: Record<Status, string> = {
  confirmed: 'Confirmed',
  pending: 'Pending',
  cancelled: 'Cancelled',
  paid: 'Paid',
  draft: 'Draft',
  published: 'Published',
};

interface Props { status: Status; className?: string }

export function StatusBadge({ status, className }: Props) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        styles[status],
        className,
      )}
    >
      {labels[status]}
    </span>
  );
}
```

- [ ] **Step 4: Run test, verify pass**

```bash
cd admin && npm test -- StatusBadge.test
```

Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
git add admin/src/components/StatusBadge.tsx admin/src/components/StatusBadge.test.tsx
git commit -m "feat(admin): add StatusBadge primitive with branded variants"
```

---

## Task 7: `RelativeDate` primitive

**Files:**
- Create: `admin/src/components/RelativeDate.tsx`
- Test: `admin/src/components/RelativeDate.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `admin/src/components/RelativeDate.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RelativeDate } from './RelativeDate';

describe('RelativeDate', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-02T10:00:00+05:30'));
  });
  afterEach(() => vi.useRealTimers());

  it('formats future dates as "in N days"', () => {
    render(<RelativeDate iso="2026-05-05T19:30:00+05:30" />);
    expect(screen.getByText(/in 3 days/i)).toBeInTheDocument();
  });

  it('formats past dates as "N days ago"', () => {
    render(<RelativeDate iso="2026-04-29T19:30:00+05:30" />);
    expect(screen.getByText(/3 days ago/i)).toBeInTheDocument();
  });

  it('formats dates further out absolutely (e.g. "Sat 8 Aug, 7:30 pm")', () => {
    render(<RelativeDate iso="2026-08-08T19:30:00+05:30" />);
    expect(screen.getByText(/8 Aug.*7:30/i)).toBeInTheDocument();
  });

  it('exposes ISO timestamp as title attribute', () => {
    render(<RelativeDate iso="2026-05-05T19:30:00+05:30" />);
    const el = screen.getByText(/in 3 days/i);
    expect(el.tagName.toLowerCase()).toBe('time');
    expect(el.getAttribute('title')).toBe('2026-05-05T19:30:00+05:30');
    expect(el.getAttribute('datetime')).toBe('2026-05-05T19:30:00+05:30');
  });
});
```

- [ ] **Step 2: Run test, verify failure**

```bash
cd admin && npm test -- RelativeDate.test
```

Expected: FAIL — `RelativeDate` not found.

- [ ] **Step 3: Implement `RelativeDate.tsx`**

Create `admin/src/components/RelativeDate.tsx`:

```tsx
interface Props { iso: string; className?: string }

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatTime(d: Date): string {
  let h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? 'pm' : 'am';
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${String(m).padStart(2, '0')} ${ampm}`;
}

export function RelativeDate({ iso, className }: Props) {
  const date = new Date(iso);
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  const diffDays = Math.round(diffMs / 86400000);

  let label: string;
  if (Math.abs(diffDays) <= 6) {
    if (diffDays === 0) label = `Today, ${formatTime(date)}`;
    else if (diffDays === 1) label = `Tomorrow, ${formatTime(date)}`;
    else if (diffDays === -1) label = `Yesterday, ${formatTime(date)}`;
    else if (diffDays > 0) label = `in ${diffDays} days`;
    else label = `${Math.abs(diffDays)} days ago`;
  } else {
    label = `${WEEKDAY[date.getDay()]} ${date.getDate()} ${MONTH[date.getMonth()]}, ${formatTime(date)}`;
  }

  return (
    <time dateTime={iso} title={iso} className={className}>
      {label}
    </time>
  );
}
```

- [ ] **Step 4: Run test, verify pass**

```bash
cd admin && npm test -- RelativeDate.test
```

Expected: PASS (4/4).

- [ ] **Step 5: Commit**

```bash
git add admin/src/components/RelativeDate.tsx admin/src/components/RelativeDate.test.tsx
git commit -m "feat(admin): add RelativeDate with relative + absolute formatting"
```

---

## Task 8: `PhoneCell` primitive

**Files:**
- Create: `admin/src/components/PhoneCell.tsx`
- Test: `admin/src/components/PhoneCell.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `admin/src/components/PhoneCell.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PhoneCell } from './PhoneCell';

describe('PhoneCell', () => {
  it('formats Indian phone numbers as +91 XXXXX XXXXX', () => {
    render(<PhoneCell phone="9876543210" />);
    expect(screen.getByText('+91 98765 43210')).toBeInTheDocument();
  });

  it('preserves a number that already has the +91 prefix', () => {
    render(<PhoneCell phone="+919876543210" />);
    expect(screen.getByText('+91 98765 43210')).toBeInTheDocument();
  });

  it('links to WhatsApp using the digits-only form', () => {
    render(<PhoneCell phone="9876543210" />);
    const link = screen.getByRole('link');
    expect(link.getAttribute('href')).toBe('https://wa.me/919876543210');
  });

  it('has an aria-label describing the action', () => {
    render(<PhoneCell phone="9876543210" />);
    expect(screen.getByRole('link').getAttribute('aria-label')).toMatch(/whatsapp/i);
  });
});
```

- [ ] **Step 2: Run test, verify failure**

```bash
cd admin && npm test -- PhoneCell.test
```

Expected: FAIL — `PhoneCell` not found.

- [ ] **Step 3: Implement `PhoneCell.tsx`**

Create `admin/src/components/PhoneCell.tsx`:

```tsx
import { cn } from '@/lib/utils';

interface Props { phone: string; className?: string }

function digitsOnly(p: string): string {
  return p.replace(/\D/g, '');
}

function format(p: string): string {
  const d = digitsOnly(p);
  // Always 10 trailing digits (Indian mobile); strip a leading 91 if present.
  const rest = d.startsWith('91') && d.length === 12 ? d.slice(2) : d;
  if (rest.length !== 10) return `+91 ${rest}`;
  return `+91 ${rest.slice(0, 5)} ${rest.slice(5)}`;
}

function waNumber(p: string): string {
  const d = digitsOnly(p);
  return d.startsWith('91') ? d : `91${d}`;
}

export function PhoneCell({ phone, className }: Props) {
  return (
    <a
      href={`https://wa.me/${waNumber(phone)}`}
      target="_blank"
      rel="noreferrer noopener"
      aria-label={`Message ${format(phone)} on WhatsApp`}
      className={cn('text-inherit hover:underline', className)}
      onClick={(e) => e.stopPropagation()}
    >
      {format(phone)}
    </a>
  );
}
```

- [ ] **Step 4: Run test, verify pass**

```bash
cd admin && npm test -- PhoneCell.test
```

Expected: PASS (4/4).

- [ ] **Step 5: Commit**

```bash
git add admin/src/components/PhoneCell.tsx admin/src/components/PhoneCell.test.tsx
git commit -m "feat(admin): add PhoneCell primitive with WhatsApp link"
```

---

## Task 9: Copy logo into admin public + use in Sidebar

**Files:**
- Create: `admin/public/bgc-logo.png`
- Modify: `admin/src/components/Sidebar.tsx`

- [ ] **Step 1: Copy logo asset**

```bash
cp public/bgc-logo.png admin/public/bgc-logo.png
ls -la admin/public/bgc-logo.png
```

Expected: file exists, non-zero size.

- [ ] **Step 2: Update Sidebar header**

In `admin/src/components/Sidebar.tsx`, replace the existing header block:

```tsx
      <div className="p-4 font-semibold text-lg">BGC Admin</div>
```

with:

```tsx
      <div className="p-4 flex items-center gap-2">
        <img src="/bgc-logo.png" alt="" className="h-7 w-7" />
        <span className="font-heading font-semibold text-lg">Admin</span>
      </div>
```

(`alt=""` because "Admin" beside it provides the accessible name.)

- [ ] **Step 3: Verify dev server renders the logo**

```bash
cd admin && npm run dev
```

Open `http://localhost:5173`, sidebar shows orange BGC logo + "Admin" wordmark in Space Grotesk. Stop server.

- [ ] **Step 4: Commit**

```bash
git add admin/public/bgc-logo.png admin/src/components/Sidebar.tsx
git commit -m "feat(admin): show BGC logo in sidebar header"
```

---

## Task 10: Sidebar count badges

**Files:**
- Modify: `admin/src/components/Sidebar.tsx`

- [ ] **Step 1: Extend Sidebar to accept counts and render badges**

Replace the entire contents of `admin/src/components/Sidebar.tsx` with:

```tsx
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Calendar, Library, Users, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';

const items = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true, countKey: null as null | string },
  { to: '/events', label: 'Events', icon: Calendar, end: false, countKey: null },
  { to: '/games', label: 'Games', icon: Library, end: false, countKey: null },
  { to: '/registrations', label: 'Registrations', icon: Users, end: false, countKey: 'pending_registration_count' },
  { to: '/guild', label: 'Guild', icon: ShieldCheck, end: false, countKey: 'pending_guild_count' },
];

export interface SidebarCounts {
  pending_registration_count?: number;
  pending_guild_count?: number;
}

interface Props {
  onNavigate?: () => void;
  counts?: SidebarCounts;
}

export default function Sidebar({ onNavigate, counts }: Props) {
  return (
    <aside className="w-56 shrink-0 bg-background border-r flex flex-col h-full">
      <div className="p-4 flex items-center gap-2">
        <img src="/bgc-logo.png" alt="" className="h-7 w-7" />
        <span className="font-heading font-semibold text-lg">Admin</span>
      </div>
      <nav className="flex-1 p-2 space-y-1">
        {items.map((item) => {
          const count = item.countKey ? counts?.[item.countKey as keyof SidebarCounts] : undefined;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={onNavigate}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2 px-3 py-2 rounded-md text-sm',
                  isActive ? 'bg-primary text-primary-foreground' : 'hover:bg-muted',
                )
              }
            >
              <item.icon className="h-4 w-4" />
              <span className="flex-1">{item.label}</span>
              {count && count > 0 ? (
                <span className="inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-highlight text-highlight-foreground text-xs font-semibold">
                  {count}
                </span>
              ) : null}
            </NavLink>
          );
        })}
      </nav>
    </aside>
  );
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd admin && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add admin/src/components/Sidebar.tsx
git commit -m "feat(admin): show pending-count badges on sidebar items"
```

---

## Task 11: `BottomTabBar` primitive

**Files:**
- Create: `admin/src/components/BottomTabBar.tsx`
- Test: `admin/src/components/BottomTabBar.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `admin/src/components/BottomTabBar.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import BottomTabBar from './BottomTabBar';

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <BottomTabBar />
    </MemoryRouter>,
  );
}

describe('BottomTabBar', () => {
  it('renders four primary tabs plus a More button', () => {
    renderAt('/');
    expect(screen.getByRole('link', { name: /dashboard/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /registrations/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /guild/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /events/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /more/i })).toBeInTheDocument();
  });

  it('marks the active tab with aria-current', () => {
    renderAt('/registrations');
    const link = screen.getByRole('link', { name: /registrations/i });
    expect(link.getAttribute('aria-current')).toBe('page');
  });

  it('shows pending counts when provided', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <BottomTabBar counts={{ pending_guild_count: 3 }} />
      </MemoryRouter>,
    );
    expect(screen.getByText('3')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test, verify failure**

```bash
cd admin && npm test -- BottomTabBar.test
```

Expected: FAIL — `BottomTabBar` not found.

- [ ] **Step 3: Implement `BottomTabBar.tsx`**

Create `admin/src/components/BottomTabBar.tsx`:

```tsx
import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Users, ShieldCheck, Calendar, MoreHorizontal, Library, LogOut } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import type { SidebarCounts } from './Sidebar';

const tabs = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true, countKey: null as null | keyof SidebarCounts },
  { to: '/registrations', label: 'Registrations', icon: Users, end: false, countKey: 'pending_registration_count' as const },
  { to: '/guild', label: 'Guild', icon: ShieldCheck, end: false, countKey: 'pending_guild_count' as const },
  { to: '/events', label: 'Events', icon: Calendar, end: false, countKey: null },
];

interface Props { counts?: SidebarCounts }

export default function BottomTabBar({ counts }: Props) {
  const [moreOpen, setMoreOpen] = useState(false);

  return (
    <>
      <nav
        className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-background border-t flex"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        aria-label="Primary"
      >
        {tabs.map((t) => {
          const count = t.countKey ? counts?.[t.countKey] : undefined;
          return (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.end}
              className={({ isActive }) =>
                cn(
                  'flex-1 flex flex-col items-center justify-center gap-0.5 py-2 min-h-11 text-xs',
                  isActive ? 'text-primary' : 'text-muted-foreground',
                )
              }
              aria-label={t.label}
            >
              <span className="relative">
                <t.icon className="h-5 w-5" />
                {count && count > 0 ? (
                  <span className="absolute -top-1.5 -right-2 inline-flex items-center justify-center min-w-4 h-4 px-1 rounded-full bg-highlight text-highlight-foreground text-[10px] font-semibold">
                    {count}
                  </span>
                ) : null}
              </span>
              <span>{t.label}</span>
            </NavLink>
          );
        })}
        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          className="flex-1 flex flex-col items-center justify-center gap-0.5 py-2 min-h-11 text-xs text-muted-foreground"
          aria-label="More"
        >
          <MoreHorizontal className="h-5 w-5" />
          <span>More</span>
        </button>
      </nav>

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent side="bottom" className="h-auto rounded-t-xl">
          <SheetHeader>
            <SheetTitle>More</SheetTitle>
          </SheetHeader>
          <div className="p-2 space-y-1">
            <NavLink
              to="/games"
              onClick={() => setMoreOpen(false)}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 px-3 py-3 rounded-md text-sm min-h-11',
                  isActive ? 'bg-primary text-primary-foreground' : 'hover:bg-muted',
                )
              }
            >
              <Library className="h-5 w-5" />
              Games
            </NavLink>
            <a
              href="/cdn-cgi/access/logout"
              className="flex items-center gap-3 px-3 py-3 rounded-md text-sm min-h-11 hover:bg-muted"
            >
              <LogOut className="h-5 w-5" />
              Sign out
            </a>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
```

Note: react-router v7's `NavLink` automatically applies `aria-current="page"` to the rendered `<a>` when active, which is what the test asserts.

- [ ] **Step 4: Run test, verify pass**

```bash
cd admin && npm test -- BottomTabBar.test
```

Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
git add admin/src/components/BottomTabBar.tsx admin/src/components/BottomTabBar.test.tsx
git commit -m "feat(admin): add BottomTabBar for mobile PWA navigation"
```

---

## Task 12: Wire `BottomTabBar` into Layout, simplify TopBar on mobile

**Files:**
- Modify: `admin/src/components/Layout.tsx`
- Modify: `admin/src/components/TopBar.tsx`

- [ ] **Step 1: Replace `Layout.tsx` to use `BottomTabBar` on mobile**

Overwrite `admin/src/components/Layout.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar, { type SidebarCounts } from './Sidebar';
import BottomTabBar from './BottomTabBar';
import TopBar from './TopBar';
import { fetchAdmin } from '@/lib/api';

interface SummaryResponse {
  pending_guild_count?: number;
  pending_registration_count?: number;
}

export default function Layout() {
  const [counts, setCounts] = useState<SidebarCounts>({});

  useEffect(() => {
    fetchAdmin<SummaryResponse>('/api/admin/summary')
      .then((r) =>
        setCounts({
          pending_guild_count: r.pending_guild_count,
          pending_registration_count: r.pending_registration_count,
        }),
      )
      .catch(() => {});
  }, []);

  return (
    <div className="flex h-full">
      <div className="hidden md:flex">
        <Sidebar counts={counts} />
      </div>
      <div className="flex-1 flex flex-col min-w-0">
        <TopBar />
        <main
          className="flex-1 overflow-auto bg-muted/30 p-4 md:p-6 pb-20 md:pb-6"
          style={{ paddingBottom: 'calc(5rem + env(safe-area-inset-bottom))' }}
        >
          <Outlet />
        </main>
        <BottomTabBar counts={counts} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Simplify `TopBar.tsx`**

Overwrite `admin/src/components/TopBar.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { fetchAdmin } from '@/lib/api';

export default function TopBar() {
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    fetchAdmin<{ email: string }>('/api/admin/whoami')
      .then((r) => setEmail(r.email))
      .catch(() => setEmail(null));
  }, []);

  const initials = email ? email.slice(0, 1).toUpperCase() : '?';

  return (
    <header className="h-14 bg-background border-b flex items-center gap-2 px-4 md:px-6">
      <div className="flex items-center gap-2 min-w-0 md:hidden">
        <img src="/bgc-logo.png" alt="" className="h-6 w-6" />
        <span className="font-heading font-semibold">Admin</span>
      </div>

      <div className="flex-1 hidden md:block max-w-xl">
        <button
          type="button"
          className="w-full flex items-center gap-2 h-9 px-3 rounded-md border bg-muted/40 text-sm text-muted-foreground hover:bg-muted"
          aria-label="Search"
          disabled
          title="Search arrives in Phase 3"
        >
          <Search className="h-4 w-4" />
          <span>Find someone… (Cmd-K)</span>
        </button>
      </div>

      <div className="flex-1 md:hidden" />

      <Button
        variant="ghost"
        size="icon"
        className="md:hidden min-h-11 min-w-11"
        aria-label="Search"
        disabled
      >
        <Search className="h-5 w-5" />
      </Button>

      <div className="flex items-center gap-3 text-sm min-w-0">
        <div className="hidden md:flex items-center gap-2">
          {email && <span className="text-muted-foreground truncate max-w-[180px]">{email}</span>}
          <a href="/cdn-cgi/access/logout" className="hover:underline shrink-0">Sign out</a>
        </div>
        <div
          className="md:hidden h-8 w-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-semibold text-sm"
          aria-label={email || 'Profile'}
          title={email || ''}
        >
          {initials}
        </div>
      </div>
    </header>
  );
}
```

- [ ] **Step 3: Verify dev server**

```bash
cd admin && npm run dev
```

Open `http://localhost:5173` at desktop width: sidebar visible with logo, top bar shows search input + email. Resize to phone width (≤ 768px DevTools): sidebar gone, bottom tab bar visible with 4 tabs + More, top bar shows logo + search icon + initials avatar. Stop server.

- [ ] **Step 4: Commit**

```bash
git add admin/src/components/Layout.tsx admin/src/components/TopBar.tsx
git commit -m "feat(admin): mobile bottom tab bar replaces hamburger drawer"
```

---

## Task 13: `DataTable` — sortable columns

**Files:**
- Modify: `admin/src/components/DataTable.tsx`
- Test: `admin/src/components/DataTable.test.tsx` (new)

- [ ] **Step 1: Write the failing test**

Create `admin/src/components/DataTable.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import DataTable, { Column } from './DataTable';

interface Row { id: string; name: string; n: number }

const rows: Row[] = [
  { id: '1', name: 'Charlie', n: 3 },
  { id: '2', name: 'Alice', n: 1 },
  { id: '3', name: 'Bob', n: 2 },
];

describe('DataTable sorting', () => {
  it('sorts ascending on first click of a sortable header', () => {
    const cols: Column<Row>[] = [
      { key: 'name', header: 'Name', render: (r) => r.name, sortable: true, sortValue: (r) => r.name },
      { key: 'n', header: 'N', render: (r) => String(r.n) },
    ];
    render(<DataTable rows={rows} columns={cols} rowKey={(r) => r.id} />);
    fireEvent.click(screen.getByRole('button', { name: /name/i }));
    const cells = screen.getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell')[0].textContent);
    expect(cells).toEqual(['Alice', 'Bob', 'Charlie']);
  });

  it('toggles to descending on second click', () => {
    const cols: Column<Row>[] = [
      { key: 'n', header: 'N', render: (r) => String(r.n), sortable: true, sortValue: (r) => r.n },
    ];
    render(<DataTable rows={rows} columns={cols} rowKey={(r) => r.id} />);
    fireEvent.click(screen.getByRole('button', { name: /n/i }));
    fireEvent.click(screen.getByRole('button', { name: /n/i }));
    const cells = screen.getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell')[0].textContent);
    expect(cells).toEqual(['3', '2', '1']);
  });
});
```

- [ ] **Step 2: Run test, verify failure**

```bash
cd admin && npm test -- DataTable.test
```

Expected: FAIL — `sortable` not a property of `Column`, header not a button.

- [ ] **Step 3: Update `DataTable.tsx`**

Overwrite `admin/src/components/DataTable.tsx`:

```tsx
import { ReactNode, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  className?: string;
  sortable?: boolean;
  sortValue?: (row: T) => string | number | null | undefined;
}

interface Props<T> {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  emptyMessage?: string;
  dense?: boolean;
}

type SortState = { key: string; dir: 'asc' | 'desc' } | null;

export default function DataTable<T>({
  rows, columns, rowKey, onRowClick, emptyMessage, dense,
}: Props<T>) {
  const [sort, setSort] = useState<SortState>(null);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sortValue) return rows;
    const value = col.sortValue;
    const out = [...rows];
    out.sort((a, b) => {
      const av = value(a);
      const bv = value(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (av < bv) return sort.dir === 'asc' ? -1 : 1;
      if (av > bv) return sort.dir === 'asc' ? 1 : -1;
      return 0;
    });
    return out;
  }, [rows, columns, sort]);

  function toggleSort(key: string) {
    setSort((s) => {
      if (s?.key !== key) return { key, dir: 'asc' };
      if (s.dir === 'asc') return { key, dir: 'desc' };
      return null;
    });
  }

  if (rows.length === 0) {
    return <div className="text-sm text-muted-foreground p-4">{emptyMessage || 'Nothing to show.'}</div>;
  }

  return (
    <div className="rounded-md border bg-background overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((c) => (
              <TableHead key={c.key} className={c.className}>
                {c.sortable ? (
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 hover:underline"
                    onClick={() => toggleSort(c.key)}
                  >
                    {c.header}
                    {sort?.key === c.key
                      ? (sort.dir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)
                      : <ChevronsUpDown className="h-3 w-3 opacity-40" />}
                  </button>
                ) : c.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((row) => (
            <TableRow
              key={rowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={cn(
                onRowClick && 'cursor-pointer hover:bg-muted/50',
                dense && '[&>td]:py-1.5',
              )}
            >
              {columns.map((c) => (
                <TableCell key={c.key} className={cn('truncate max-w-[24rem]', c.className)} title={typeof c.render(row) === 'string' ? (c.render(row) as string) : undefined}>
                  {c.render(row)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
```

- [ ] **Step 4: Run test, verify pass**

```bash
cd admin && npm test -- DataTable.test
```

Expected: PASS (2/2).

- [ ] **Step 5: Verify existing pages still compile**

```bash
cd admin && npx tsc --noEmit
```

Expected: no errors. The `Column` interface gained two optional fields; existing call sites without `sortable`/`sortValue` continue to work.

- [ ] **Step 6: Commit**

```bash
git add admin/src/components/DataTable.tsx admin/src/components/DataTable.test.tsx
git commit -m "feat(admin): DataTable supports sortable columns + dense mode + truncation"
```

---

## Task 14: `DataTable` — selectable rows

**Files:**
- Modify: `admin/src/components/DataTable.tsx`
- Modify: `admin/src/components/DataTable.test.tsx`

- [ ] **Step 1: Add the failing test**

Append to `admin/src/components/DataTable.test.tsx`:

```tsx
describe('DataTable selection', () => {
  it('toggles a single row when its checkbox is clicked', () => {
    const cols: Column<Row>[] = [{ key: 'name', header: 'Name', render: (r) => r.name }];
    let selected: string[] = [];
    render(
      <DataTable
        rows={rows}
        columns={cols}
        rowKey={(r) => r.id}
        selectable
        selectedIds={selected}
        onSelectedIdsChange={(ids) => { selected = ids; }}
      />,
    );
    const checkboxes = screen.getAllByRole('checkbox');
    // [0] is the header "select all", [1..3] are row checkboxes.
    fireEvent.click(checkboxes[2]);
    expect(selected).toEqual(['2']);
  });

  it('selects all rows when the header checkbox is clicked', () => {
    const cols: Column<Row>[] = [{ key: 'name', header: 'Name', render: (r) => r.name }];
    let selected: string[] = [];
    render(
      <DataTable
        rows={rows}
        columns={cols}
        rowKey={(r) => r.id}
        selectable
        selectedIds={selected}
        onSelectedIdsChange={(ids) => { selected = ids; }}
      />,
    );
    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    expect(selected).toEqual(['1', '2', '3']);
  });
});
```

- [ ] **Step 2: Run tests, verify failure**

```bash
cd admin && npm test -- DataTable.test
```

Expected: FAIL — `selectable` / `selectedIds` not supported.

- [ ] **Step 3: Add selectable support**

Edit `admin/src/components/DataTable.tsx`:

3a. Add to the `Props<T>` interface:

```tsx
  selectable?: boolean;
  selectedIds?: string[];
  onSelectedIdsChange?: (ids: string[]) => void;
```

3b. Add this import at the top:

```tsx
import { Checkbox } from '@/components/ui/checkbox';
```

3c. Destructure new props in the component signature:

```tsx
export default function DataTable<T>({
  rows, columns, rowKey, onRowClick, emptyMessage, dense,
  selectable, selectedIds = [], onSelectedIdsChange,
}: Props<T>) {
```

3d. Add this helper inside the component (above `if (rows.length === 0)`):

```tsx
  const allIds = useMemo(() => rows.map(rowKey), [rows, rowKey]);
  const allSelected = selectable && allIds.length > 0 && allIds.every((id) => selectedIds.includes(id));

  function toggleId(id: string) {
    if (!onSelectedIdsChange) return;
    onSelectedIdsChange(
      selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id],
    );
  }

  function toggleAll() {
    if (!onSelectedIdsChange) return;
    onSelectedIdsChange(allSelected ? [] : allIds);
  }
```

3e. In the `<TableRow>` of the header, prepend a select-all column when `selectable` is true:

```tsx
            {selectable && (
              <TableHead className="w-10">
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={toggleAll}
                  aria-label="Select all rows"
                />
              </TableHead>
            )}
```

3f. In the body row map, prepend the row checkbox cell when `selectable` is true (before the column cells):

```tsx
              {selectable && (
                <TableCell className="w-10" onClick={(e) => e.stopPropagation()}>
                  <Checkbox
                    checked={selectedIds.includes(rowKey(row))}
                    onCheckedChange={() => toggleId(rowKey(row))}
                    aria-label="Select row"
                  />
                </TableCell>
              )}
```

- [ ] **Step 4: Run tests, verify pass**

```bash
cd admin && npm test -- DataTable.test
```

Expected: PASS (4/4 across both describes).

- [ ] **Step 5: Commit**

```bash
git add admin/src/components/DataTable.tsx admin/src/components/DataTable.test.tsx
git commit -m "feat(admin): DataTable supports selectable rows for bulk actions"
```

---

## Task 15: `MobileCardList` primitive

**Files:**
- Create: `admin/src/components/MobileCardList.tsx`
- Test: `admin/src/components/MobileCardList.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `admin/src/components/MobileCardList.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import MobileCardList, { CardField } from './MobileCardList';

interface Row { id: string; name: string; phone: string }
const rows: Row[] = [
  { id: '1', name: 'Alice', phone: '+91 98765 43210' },
  { id: '2', name: 'Bob', phone: '+91 98765 43211' },
];

describe('MobileCardList', () => {
  const fields: CardField<Row>[] = [
    { key: 'name', label: 'Name', render: (r) => r.name, primary: true },
    { key: 'phone', label: 'Phone', render: (r) => r.phone },
  ];

  it('renders one card per row, primary field prominent', () => {
    render(<MobileCardList rows={rows} fields={fields} rowKey={(r) => r.id} />);
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(screen.getByText('+91 98765 43210')).toBeInTheDocument();
  });

  it('shows the empty message when rows is empty', () => {
    render(<MobileCardList rows={[]} fields={fields} rowKey={(r) => r.id} emptyMessage="None yet" />);
    expect(screen.getByText('None yet')).toBeInTheDocument();
  });

  it('calls onRowClick when a card is tapped', () => {
    const onRowClick = vi.fn();
    render(<MobileCardList rows={rows} fields={fields} rowKey={(r) => r.id} onRowClick={onRowClick} />);
    fireEvent.click(screen.getByText('Alice'));
    expect(onRowClick).toHaveBeenCalledWith(rows[0]);
  });
});
```

- [ ] **Step 2: Run test, verify failure**

```bash
cd admin && npm test -- MobileCardList.test
```

Expected: FAIL — `MobileCardList` not found.

- [ ] **Step 3: Implement `MobileCardList.tsx`**

Create `admin/src/components/MobileCardList.tsx`:

```tsx
import { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface CardField<T> {
  key: string;
  label?: string;
  render: (row: T) => ReactNode;
  primary?: boolean;
}

interface Props<T> {
  rows: T[];
  fields: CardField<T>[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  emptyMessage?: string;
  trailing?: (row: T) => ReactNode;
}

export default function MobileCardList<T>({
  rows, fields, rowKey, onRowClick, emptyMessage, trailing,
}: Props<T>) {
  if (rows.length === 0) {
    return <div className="text-sm text-muted-foreground p-4">{emptyMessage || 'Nothing to show.'}</div>;
  }
  return (
    <ul className="space-y-2">
      {rows.map((row) => {
        const primary = fields.find((f) => f.primary);
        const secondaries = fields.filter((f) => !f.primary);
        return (
          <li
            key={rowKey(row)}
            onClick={onRowClick ? () => onRowClick(row) : undefined}
            className={cn(
              'rounded-md border bg-card p-3 flex items-start gap-3 min-h-[44px]',
              onRowClick && 'cursor-pointer hover:bg-muted/40 active:bg-muted/60',
            )}
          >
            <div className="flex-1 min-w-0">
              {primary && (
                <div className="font-semibold truncate">{primary.render(row)}</div>
              )}
              <div className="text-sm text-muted-foreground space-y-0.5 mt-0.5">
                {secondaries.map((f) => (
                  <div key={f.key} className="truncate">
                    {f.label && <span className="text-xs uppercase tracking-wide mr-1">{f.label}</span>}
                    {f.render(row)}
                  </div>
                ))}
              </div>
            </div>
            {trailing && <div className="shrink-0">{trailing(row)}</div>}
          </li>
        );
      })}
    </ul>
  );
}
```

- [ ] **Step 4: Run test, verify pass**

```bash
cd admin && npm test -- MobileCardList.test
```

Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
git add admin/src/components/MobileCardList.tsx admin/src/components/MobileCardList.test.tsx
git commit -m "feat(admin): add MobileCardList primitive for mobile-first lists"
```

---

## Task 16: Worker — extend `/api/admin/summary` with `pending_registration_count`

**Files:**
- Modify: `worker/src/admin/summary.ts`
- Modify: `worker/src/admin/summary.test.ts`

- [ ] **Step 1: Add a failing assertion to the existing summary test**

Open `worker/src/admin/summary.test.ts`. Find any existing `handleSummary`-level test that asserts the response shape (or the closest equivalent). Add a new test case that mocks the supabase client and asserts the response includes `pending_registration_count`.

If there is no existing handler-level test, add this one near the bottom of the file (adjust the supabase mock pattern to match the file's existing convention):

```ts
import { describe, it, expect, vi } from 'vitest';
import { handleSummary } from './summary';

describe('handleSummary response shape', () => {
  it('includes pending_registration_count from registrations table', async () => {
    const supabase = {
      from(table: string) {
        const chain = {
          select: () => chain,
          gte: () => chain,
          lt: () => chain,
          in: () => chain,
          eq: () => chain,
          order: () => chain,
          limit: () => chain,
          then: undefined as never,
        } as any;
        if (table === 'events') {
          chain.gte = () => ({ ...chain, order: () => ({ ...chain, then: (resolve: any) => resolve({ data: [], error: null }) }) });
          chain.lt = () => ({ ...chain, order: () => ({ ...chain, limit: () => ({ ...chain, then: (resolve: any) => resolve({ data: [], error: null }) }) }) });
        }
        if (table === 'guild_path_members') {
          chain.eq = () => ({ ...chain, gte: () => ({ ...chain, then: (resolve: any) => resolve({ data: [], error: null }) }) });
          chain.select = () => ({
            ...chain,
            eq: (col: string, val: string) =>
              col === 'status' && val === 'pending'
                ? { then: (resolve: any) => resolve({ data: null, count: 7, error: null }) }
                : ({ ...chain, gte: () => ({ ...chain, then: (resolve: any) => resolve({ data: [], error: null }) }) }),
          });
        }
        if (table === 'registrations') {
          chain.in = () => ({ ...chain, then: (resolve: any) => resolve({ data: [], error: null }) });
          chain.select = () => ({
            ...chain,
            eq: () => ({ then: (resolve: any) => resolve({ data: null, count: 4, error: null }) }),
          });
        }
        return chain;
      },
    };

    vi.doMock('../supabase', () => ({ getSupabase: () => supabase }));
    const { handleSummary: fresh } = await import('./summary');
    const res = await fresh({} as any);
    const body = await res.json();
    expect(body.pending_registration_count).toBe(4);
  });
});
```

If the existing test file already mocks supabase a different way, **adapt to its pattern instead of using the snippet above** — the goal is to assert that the response body has `pending_registration_count` numerically equal to the count of `registrations` rows with `payment_status = 'pending'`.

- [ ] **Step 2: Run the test, verify failure**

```bash
cd worker && npm test -- summary.test
```

Expected: FAIL — response body lacks `pending_registration_count`.

- [ ] **Step 3: Modify `summary.ts` to compute and return the count**

Open `worker/src/admin/summary.ts`. After the existing `pendingGuildCount` query (around line 113–116), add a parallel query for pending registrations:

```ts
  const { count: pendingRegistrationCount } = await supabase
    .from('registrations')
    .select('id', { count: 'exact', head: true })
    .eq('payment_status', 'pending');
```

Update the `jsonResponse` at the bottom of `handleSummary` (around lines 125–129) to:

```ts
  return jsonResponse({
    upcoming: buildCards(upcomingEvents || []),
    past: buildCards(pastEvents || []),
    pending_guild_count: pendingGuildCount ?? 0,
    pending_registration_count: pendingRegistrationCount ?? 0,
  });
```

- [ ] **Step 4: Run the test, verify pass**

```bash
cd worker && npm test -- summary.test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/src/admin/summary.ts worker/src/admin/summary.test.ts
git commit -m "feat(worker): summary returns pending_registration_count"
```

---

## Task 17: Verify counts flow end-to-end (manual check)

**Files:** none modified — verification only.

- [ ] **Step 1: Deploy Worker**

```bash
cd worker && npx wrangler deploy
```

Expected: deploy succeeds.

- [ ] **Step 2: Run admin dev server**

```bash
cd admin && npm run dev
```

- [ ] **Step 3: Manual checks at desktop width (1280px)**

Open `http://localhost:5173`. Verify:
- Sidebar shows orange BGC logo + "Admin" wordmark in Space Grotesk.
- "Registrations" sidebar item shows a yellow count badge if there are pending registrations.
- "Guild" sidebar item shows a yellow count badge if there are pending guild memberships.
- TopBar shows the disabled "Find someone… (Cmd-K)" search input.
- TopBar shows the user's email + "Sign out" link.

- [ ] **Step 4: Manual checks at phone width (375px)**

Resize the browser to 375px (DevTools device emulation). Verify:
- Sidebar is hidden.
- TopBar shows the BGC logo + "Admin" wordmark + a search icon button + initials avatar.
- A bottom tab bar shows: Dashboard, Registrations, Guild, Events, More — with count badges where applicable.
- Tapping "More" opens a bottom sheet with "Games" and "Sign out" entries.
- Bottom tab bar respects safe-area inset (visible space below tabs on iOS sim, none on desktop).

- [ ] **Step 5: Capture before/after screenshots**

Take screenshots of Dashboard, Registrations list, and Guild list at both 375px and 1280px. Save to `docs/superpowers/screenshots/2026-05-02-phase-1-after/` (create the directory if needed).

```bash
mkdir -p docs/superpowers/screenshots/2026-05-02-phase-1-after
# (manual screenshots from the browser saved into that folder)
```

- [ ] **Step 6: Stop dev server, commit screenshots**

```bash
git add docs/superpowers/screenshots/
git commit -m "docs(admin): phase 1 visual reference screenshots"
```

---

## Self-review summary

Spec coverage check (Phase 1 requirements vs. tasks):
- Brand palette tokens — Task 1.
- Brand fonts — Task 2.
- Brand logo in sidebar — Task 9.
- PWA manifest brand — Task 3.
- `theme-color` meta — Task 2.
- `StatusBadge` — Task 6.
- `RelativeDate` — Task 7.
- `PhoneCell` — Task 8.
- `MobileCardList` — Task 15.
- `Skeleton` (shadcn) — Task 4.
- `Loading` 150ms wrapper — Task 5.
- `DataTable` sortable — Task 13.
- `DataTable` dense mode — Task 13.
- `DataTable` truncation — Task 13.
- `DataTable` selectable — Task 14.
- `DataTable` mobile delegation — *deferred to Phase 3*: the spec calls for `MobileCardList` to be the default render path inside `DataTable`. Phase 1 ships both primitives standalone; Phase 3 wires the responsive switching when it consumes them on actual list pages. This keeps Phase 1 invisible to admins (no per-page UI changes) while still shipping the primitives needed for the switch.
- Bottom tab bar on mobile — Task 11 + 12.
- Hamburger drawer removal — Task 12.
- TopBar search affordance (UI only, no behavior) — Task 12.
- Avatar circle on mobile — Task 12.
- Sidebar count badges — Task 10 + 12 (Layout fetches summary and passes to Sidebar).
- BottomTabBar count badges — Task 11.
- Pending counts in summary endpoint — Task 16.
- Manual visual verification + screenshots — Task 17.

Out of scope deferred items (consistent with spec):
- Mobile delegation in DataTable — Phase 3 (where list pages are reworked).
- Search behavior — Phase 3.
- Service worker upgrade — already exists; no Phase 1 changes needed beyond the manifest theme.
- Validation, custom-question preview, smart defaults — Phase 2.
- Bulk actions toolbar — Phase 4.

Type consistency: `SidebarCounts` defined in Task 10 is imported by `BottomTabBar` (Task 11) and `Layout` (Task 12). Field names match: `pending_guild_count`, `pending_registration_count`. Worker response (Task 16) uses the same field names.
