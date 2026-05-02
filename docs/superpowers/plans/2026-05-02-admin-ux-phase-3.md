# Admin UX Improvements — Phase 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make admin work fast on a phone. Add a global "Find someone" search (phone-first, full-screen overlay), mobile card layouts on every list with single-tap status changes via action sheets, inline guild pending verify/reject buttons, FAB creation buttons on list pages, and an offline read mode with a clear banner.

**Architecture:** Worker gains two endpoints (`/api/admin/search`, `/api/admin/log`). Admin gains a `lib/log.ts` client error reporter, an `ActionSheet` primitive, a `SearchOverlay` page, and rewrites every list (`RegistrationsList`, `GuildList`, `EventsList`, `GamesList`) to render `MobileCardList` on mobile while keeping the existing `DataTable` on desktop. Service worker is extended to cache the last-fetched API responses for offline read; mutations refuse offline.

**Tech Stack:** Continues from Phase 1 (primitives, shell, sortable+selectable DataTable, MobileCardList) and Phase 2 (FormDrawer, validation, primitives). No new dependencies.

**Spec reference:** `docs/superpowers/specs/2026-05-02-admin-ux-improvements-design.md` — Phase 3 + cross-cutting (offline, telemetry).

**Prerequisite:** Phases 1 and 2 must already be merged to `main`. The TopBar's disabled "Find someone…" button (added in Phase 1) gets wired up here.

---

## File Structure

**New files (admin):**
- `admin/src/lib/log.ts` + test — client error reporter, posts to `/api/admin/log`
- `admin/src/components/ActionSheet.tsx` + test — bottom sheet of action buttons (reusable)
- `admin/src/components/SearchOverlay.tsx` + test — full-screen search modal
- `admin/src/components/OfflineBanner.tsx` — small inline banner shown when serving cached data

**New files (worker):**
- `worker/src/admin/search.ts` + `search.test.ts` — search across users/registrations/guild_members
- `worker/src/admin/log.ts` + `log.test.ts` — accept client error events

**Modified files (admin):**
- `admin/src/components/TopBar.tsx` — wire search button to open `SearchOverlay`; add Cmd-K / "/" keyboard shortcut.
- `admin/src/main.tsx` — install `lib/log.ts` global handler.
- `admin/src/pages/RegistrationsList.tsx` — mobile card layout + tap-to-action-sheet.
- `admin/src/pages/GuildList.tsx` — mobile cards + inline ✓/✗ for pending rows.
- `admin/src/pages/EventsList.tsx` — mobile cards + FAB.
- `admin/src/pages/GamesList.tsx` — mobile cards + FAB.
- `admin/src/pages/Dashboard.tsx` — collapse custom-question summaries on mobile.
- `admin/public/sw.js` — extend to cache last-fetched GET API responses for offline read.

**Modified files (worker):**
- `worker/src/index.ts` — route `/api/admin/search` and `/api/admin/log`.

---

## Task 1: Worker — `GET /api/admin/search`

**Files:**
- Create: `worker/src/admin/search.ts`
- Create: `worker/src/admin/search.test.ts`
- Modify: `worker/src/index.ts` (add route)

The endpoint accepts `?q=<query>` (≥ 2 chars) and returns three arrays: `registrations`, `guild_members`, `users`. Match strategy:
- If the query digit-stripped is ≥ 4 digits, treat as phone search (substring match against `users.phone`, `registrations.phone`, `guild_members` joined to user phone).
- Else treat as name/email search (case-insensitive substring match against name and email).
- Cap each array at 10 results.

- [ ] **Step 1: Write the failing test** for a pure helper in `worker/src/admin/search.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { classifyQuery } from './search';

describe('classifyQuery', () => {
  it('treats 4+ digit input as a phone query', () => {
    expect(classifyQuery('98765')).toEqual({ kind: 'phone', value: '98765' });
    expect(classifyQuery('+91 98765')).toEqual({ kind: 'phone', value: '9198765' });
  });

  it('treats short or text input as a name/email query', () => {
    expect(classifyQuery('amrit')).toEqual({ kind: 'text', value: 'amrit' });
    expect(classifyQuery('@gmail')).toEqual({ kind: 'text', value: '@gmail' });
    expect(classifyQuery('123')).toEqual({ kind: 'text', value: '123' });
  });

  it('rejects queries shorter than 2 chars', () => {
    expect(classifyQuery('a')).toBeNull();
    expect(classifyQuery('')).toBeNull();
    expect(classifyQuery('  ')).toBeNull();
  });
});
```

- [ ] **Step 2: Run, confirm fail**

```bash
cd worker && npm test -- search.test
```

- [ ] **Step 3: Implement `worker/src/admin/search.ts`**

```ts
import type { Env } from '../index';
import { getSupabase } from '../supabase';
import { jsonResponse } from '../validation';

export type Query = { kind: 'phone' | 'text'; value: string };

export function classifyQuery(raw: string): Query | null {
  const trimmed = (raw || '').trim();
  if (trimmed.length < 2) return null;
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length >= 4) return { kind: 'phone', value: digits };
  return { kind: 'text', value: trimmed };
}

export interface SearchResults {
  registrations: Array<{
    id: string; name: string; phone: string;
    event_id: string; event_name: string | null;
    payment_status: 'pending' | 'confirmed' | 'cancelled';
  }>;
  guild_members: Array<{
    id: string; user_id: string;
    name: string | null; phone: string;
    tier: string; status: string; expires_at: string;
  }>;
  users: Array<{
    id: string; name: string | null; phone: string; email: string | null;
    last_registered_at: string;
  }>;
}

const EMPTY: SearchResults = { registrations: [], guild_members: [], users: [] };

export async function handleSearch(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const q = classifyQuery(url.searchParams.get('q') || '');
  if (!q) return jsonResponse(EMPTY);

  const supabase = getSupabase(env);
  const phoneFilter = q.kind === 'phone' ? `phone.ilike.%${q.value}%` : null;
  const textFilter = q.kind === 'text' ? `name.ilike.%${q.value}%,email.ilike.%${q.value}%` : null;

  // Registrations
  let regs: any[] = [];
  {
    const filter = phoneFilter || textFilter;
    if (filter) {
      const { data } = await supabase
        .from('registrations')
        .select('id, name, phone, event_id, payment_status, events(name)')
        .or(filter)
        .limit(10);
      regs = (data || []).map((r: any) => ({
        id: r.id, name: r.name, phone: r.phone,
        event_id: r.event_id,
        event_name: r.events?.name ?? null,
        payment_status: r.payment_status,
      }));
    }
  }

  // Users
  let users: any[] = [];
  {
    const filter = phoneFilter || textFilter;
    if (filter) {
      const { data } = await supabase
        .from('users')
        .select('id, name, phone, email, last_registered_at')
        .or(filter)
        .order('last_registered_at', { ascending: false })
        .limit(10);
      users = data || [];
    }
  }

  // Guild members — match by joined user.
  let guild: any[] = [];
  {
    const userIds = users.map((u) => u.id);
    if (userIds.length > 0) {
      const { data } = await supabase
        .from('guild_path_members')
        .select('id, user_id, tier, status, expires_at, users(name, phone)')
        .in('user_id', userIds)
        .limit(10);
      guild = (data || []).map((g: any) => ({
        id: g.id,
        user_id: g.user_id,
        name: g.users?.name ?? null,
        phone: g.users?.phone ?? '',
        tier: g.tier,
        status: g.status,
        expires_at: g.expires_at,
      }));
    }
  }

  return jsonResponse({ registrations: regs, guild_members: guild, users });
}
```

- [ ] **Step 4: Run, confirm pass**

```bash
cd worker && npm test -- search.test
```

- [ ] **Step 5: Wire route in `worker/src/index.ts`**

Read the existing file to find where the admin routes are dispatched (after the `gateAdmin` check). Add:

```ts
import { handleSearch } from './admin/search';

// ... inside the admin route block:
if (url.pathname === '/api/admin/search' && request.method === 'GET') {
  response = await handleSearch(request, env);
}
```

- [ ] **Step 6: Verify**

```bash
cd worker && npx tsc --noEmit
cd worker && npm test
```

- [ ] **Step 7: Commit**

```bash
git add worker/src/admin/search.ts worker/src/admin/search.test.ts worker/src/index.ts
git commit -m "feat(worker): add /api/admin/search across users/regs/guild"
```

---

## Task 2: Worker — `POST /api/admin/log`

**Files:**
- Create: `worker/src/admin/log.ts`
- Create: `worker/src/admin/log.test.ts`
- Modify: `worker/src/index.ts`

Accept JSON `{ message, stack, url, user_agent }`, validate, and persist to a new `admin_client_errors` table (or a Worker KV key — choose KV to avoid a migration).

**Decision:** since adding a DB table requires migration tooling for the user, use Cloudflare Workers KV. If KV isn't bound in `wrangler.toml`, the implementer falls back to logging via `console.warn` only — the rest of the implementation stays consistent.

- [ ] **Step 1: Write failing test in `worker/src/admin/log.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { validateLogPayload } from './log';

describe('validateLogPayload', () => {
  it('accepts a minimal payload', () => {
    expect(validateLogPayload({ message: 'boom' }).ok).toBe(true);
  });
  it('rejects a missing message', () => {
    expect(validateLogPayload({} as any).ok).toBe(false);
  });
  it('rejects a non-string message', () => {
    expect(validateLogPayload({ message: 123 } as any).ok).toBe(false);
  });
  it('clamps overlong message + stack', () => {
    const big = 'x'.repeat(5000);
    const r = validateLogPayload({ message: big, stack: big });
    expect(r.ok).toBe(true);
    expect(r.value!.message.length).toBeLessThanOrEqual(2000);
    expect(r.value!.stack!.length).toBeLessThanOrEqual(4000);
  });
});
```

- [ ] **Step 2: Run, confirm fail**

- [ ] **Step 3: Implement `worker/src/admin/log.ts`**

```ts
import type { Env } from '../index';
import { jsonResponse } from '../validation';

interface LogPayload {
  message: string;
  stack?: string;
  url?: string;
  user_agent?: string;
}

interface ValidatedPayload extends LogPayload {
  message: string;
  stack?: string;
  url?: string;
  user_agent?: string;
}

export function validateLogPayload(raw: any): { ok: true; value: ValidatedPayload } | { ok: false } {
  if (!raw || typeof raw.message !== 'string' || raw.message.length === 0) return { ok: false };
  const v: ValidatedPayload = {
    message: raw.message.slice(0, 2000),
    stack: typeof raw.stack === 'string' ? raw.stack.slice(0, 4000) : undefined,
    url: typeof raw.url === 'string' ? raw.url.slice(0, 500) : undefined,
    user_agent: typeof raw.user_agent === 'string' ? raw.user_agent.slice(0, 500) : undefined,
  };
  return { ok: true, value: v };
}

export async function handleLog(request: Request, env: Env, adminEmail: string): Promise<Response> {
  const raw = await request.json().catch(() => null);
  const v = validateLogPayload(raw);
  if (!v.ok) return jsonResponse({ error: 'Invalid payload' }, 400);

  const entry = {
    ts: new Date().toISOString(),
    admin: adminEmail,
    ...v.value,
  };

  // Best-effort: console.warn so it surfaces in tail logs.
  console.warn('[admin-client-error]', JSON.stringify(entry));
  return jsonResponse({ ok: true });
}
```

- [ ] **Step 4: Wire route in `worker/src/index.ts`** (after the admin gate check):

```ts
import { handleLog } from './admin/log';

// ...
if (url.pathname === '/api/admin/log' && request.method === 'POST') {
  response = await handleLog(request, env, gate.admin.email);
}
```

- [ ] **Step 5: Verify**

```bash
cd worker && npx tsc --noEmit
cd worker && npm test
```

- [ ] **Step 6: Commit**

```bash
git add worker/src/admin/log.ts worker/src/admin/log.test.ts worker/src/index.ts
git commit -m "feat(worker): /api/admin/log accepts client error reports"
```

---

## Task 3: `lib/log.ts` client-side error reporter

**Files:**
- Create: `admin/src/lib/log.ts`
- Create: `admin/src/lib/log.test.ts`
- Modify: `admin/src/main.tsx`

Captures `window.error` + `unhandledrejection` events, batches with a 1-second debounce, posts to `/api/admin/log`.

- [ ] **Step 1: Write failing test in `admin/src/lib/log.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { reportError, __resetForTests } from './log';

describe('lib/log', () => {
  beforeEach(() => {
    __resetForTests();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it('debounces calls within 1 second', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    reportError(new Error('one'));
    reportError(new Error('two'));
    expect(fetchMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('truncates very long messages on the wire', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    reportError(new Error('x'.repeat(5000)));
    await vi.advanceTimersByTimeAsync(1000);
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.message.length).toBeLessThanOrEqual(2000);
  });
});
```

- [ ] **Step 2: Run, confirm fail**

- [ ] **Step 3: Implement `admin/src/lib/log.ts`**

```ts
const QUEUE: Array<{ message: string; stack?: string; url?: string; user_agent?: string }> = [];
let timer: ReturnType<typeof setTimeout> | null = null;

export function reportError(err: unknown, extra?: { url?: string }) {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;
  QUEUE.push({
    message: message.slice(0, 2000),
    stack: stack?.slice(0, 4000),
    url: extra?.url || (typeof location !== 'undefined' ? location.href : undefined),
    user_agent: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 500) : undefined,
  });
  if (timer) return;
  timer = setTimeout(flush, 1000);
}

async function flush() {
  timer = null;
  while (QUEUE.length > 0) {
    const entry = QUEUE.shift()!;
    try {
      await fetch('/api/admin/log', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry),
      });
    } catch {
      // network down — drop silently
    }
  }
}

export function installGlobalErrorHandler() {
  if (typeof window === 'undefined') return;
  window.addEventListener('error', (e) => reportError(e.error || e.message));
  window.addEventListener('unhandledrejection', (e) => reportError(e.reason));
}

export function __resetForTests() {
  QUEUE.length = 0;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}
```

- [ ] **Step 4: Run, confirm pass**

- [ ] **Step 5: Install in `admin/src/main.tsx`** — read the current file, then add at the top after imports:

```ts
import { installGlobalErrorHandler } from './lib/log';
installGlobalErrorHandler();
```

- [ ] **Step 6: Verify**

```bash
cd admin && npm test
```

- [ ] **Step 7: Commit**

```bash
git add admin/src/lib/log.ts admin/src/lib/log.test.ts admin/src/main.tsx
git commit -m "feat(admin): debounced client error reporter"
```

---

## Task 4: ActionSheet primitive

**Files:**
- Create: `admin/src/components/ActionSheet.tsx`
- Create: `admin/src/components/ActionSheet.test.tsx`

A reusable bottom sheet showing a vertical list of action buttons (used in subsequent tasks for status changes, "More" menus, etc).

- [ ] **Step 1: Write failing test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ActionSheet } from './ActionSheet';

describe('ActionSheet', () => {
  it('renders title and actions when open', () => {
    render(
      <ActionSheet
        open
        title="Change status"
        actions={[
          { label: 'Mark confirmed', onClick: () => {} },
          { label: 'Mark cancelled', onClick: () => {}, destructive: true },
        ]}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText('Change status')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mark confirmed' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mark cancelled' })).toBeInTheDocument();
  });

  it('invokes the action callback when a button is clicked', () => {
    const onClick = vi.fn();
    const onClose = vi.fn();
    render(
      <ActionSheet
        open title="x"
        actions={[{ label: 'Do thing', onClick }]}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Do thing' }));
    expect(onClick).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('renders nothing when not open', () => {
    render(<ActionSheet open={false} title="x" actions={[]} onClose={() => {}} />);
    expect(screen.queryByText('x')).toBeNull();
  });
});
```

- [ ] **Step 2: Run, confirm fail**

- [ ] **Step 3: Implement `admin/src/components/ActionSheet.tsx`**

```tsx
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

export interface ActionItem {
  label: string;
  onClick: () => void;
  destructive?: boolean;
  disabled?: boolean;
  icon?: React.ReactNode;
}

interface Props {
  open: boolean;
  title: string;
  actions: ActionItem[];
  onClose: () => void;
}

export function ActionSheet({ open, title, actions, onClose }: Props) {
  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent
        side="bottom"
        className="rounded-t-xl"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
        </SheetHeader>
        <ul className="p-2 space-y-1">
          {actions.map((a) => (
            <li key={a.label}>
              <button
                type="button"
                disabled={a.disabled}
                onClick={() => { a.onClick(); onClose(); }}
                className={cn(
                  'w-full flex items-center gap-3 px-3 py-3 rounded-md text-sm min-h-11 text-left',
                  a.destructive ? 'text-destructive hover:bg-destructive/10' : 'hover:bg-muted',
                  a.disabled && 'opacity-50 cursor-not-allowed',
                )}
              >
                {a.icon}
                {a.label}
              </button>
            </li>
          ))}
        </ul>
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 4: Run, confirm pass (3/3)**

- [ ] **Step 5: Commit**

```bash
git add admin/src/components/ActionSheet.tsx admin/src/components/ActionSheet.test.tsx
git commit -m "feat(admin): ActionSheet primitive for mobile bottom-up actions"
```

---

## Task 5: SearchOverlay component

**Files:**
- Create: `admin/src/components/SearchOverlay.tsx`
- Create: `admin/src/components/SearchOverlay.test.tsx`

A full-screen modal (mobile-first; on desktop appears as a wide modal) with a single input. Fetches `/api/admin/search?q=…` on debounced typing (250ms). Recent searches stored in localStorage under `admin.searchRecents` (max 8). Each result row tapped → navigates to the relevant detail page and closes the overlay.

- [ ] **Step 1: Write failing test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SearchOverlay } from './SearchOverlay';

function renderIt(open = true) {
  return render(
    <MemoryRouter>
      <SearchOverlay open={open} onClose={() => {}} />
    </MemoryRouter>,
  );
}

describe('SearchOverlay', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      registrations: [{ id: 'r1', name: 'Amrit', phone: '9876500001', event_id: 'e1', event_name: 'Game night', payment_status: 'confirmed' }],
      guild_members: [],
      users: [],
    }), { status: 200 })));
    localStorage.clear();
  });

  it('renders an input when open', () => {
    renderIt();
    expect(screen.getByPlaceholderText(/find someone/i)).toBeInTheDocument();
  });

  it('queries the search endpoint after typing', async () => {
    vi.useFakeTimers();
    renderIt();
    fireEvent.change(screen.getByPlaceholderText(/find someone/i), { target: { value: 'amrit' } });
    await vi.advanceTimersByTimeAsync(250);
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/api/admin/search?q=amrit'), expect.any(Object)));
    vi.useRealTimers();
  });

  it('renders a recent searches section when input is empty', () => {
    localStorage.setItem('admin.searchRecents', JSON.stringify(['amrit', '98765']));
    renderIt();
    expect(screen.getByText('amrit')).toBeInTheDocument();
    expect(screen.getByText('98765')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run, confirm fail**

- [ ] **Step 3: Implement `admin/src/components/SearchOverlay.tsx`**

```tsx
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, X, Phone, ShieldCheck, Calendar } from 'lucide-react';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Input } from '@/components/ui/input';
import { fetchAdmin } from '@/lib/api';
import { StatusBadge } from './StatusBadge';

interface SearchResults {
  registrations: Array<{ id: string; name: string; phone: string; event_id: string; event_name: string | null; payment_status: 'pending' | 'confirmed' | 'cancelled' }>;
  guild_members: Array<{ id: string; user_id: string; name: string | null; phone: string; tier: string; status: string; expires_at: string }>;
  users: Array<{ id: string; name: string | null; phone: string; email: string | null; last_registered_at: string }>;
}

const EMPTY: SearchResults = { registrations: [], guild_members: [], users: [] };
const RECENTS_KEY = 'admin.searchRecents';
const RECENTS_MAX = 8;

function readRecents(): string[] {
  try { return JSON.parse(localStorage.getItem(RECENTS_KEY) || '[]'); } catch { return []; }
}

function pushRecent(q: string) {
  if (!q.trim()) return;
  const prev = readRecents().filter((x) => x !== q);
  prev.unshift(q);
  localStorage.setItem(RECENTS_KEY, JSON.stringify(prev.slice(0, RECENTS_MAX)));
}

export function SearchOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SearchResults>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [recents, setRecents] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (open) { setRecents(readRecents()); setQ(''); setResults(EMPTY); } }, [open]);
  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);

  useEffect(() => {
    if (!q.trim() || q.trim().length < 2) { setResults(EMPTY); return; }
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const data = await fetchAdmin<SearchResults>(`/api/admin/search?q=${encodeURIComponent(q)}`);
        setResults(data);
      } catch {
        setResults(EMPTY);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  function go(path: string) {
    pushRecent(q);
    setRecents(readRecents());
    onClose();
    navigate(path);
  }

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="bottom" className="h-full max-h-screen p-0 flex flex-col">
        <div className="flex items-center gap-2 p-3 border-b">
          <Search className="h-4 w-4 text-muted-foreground shrink-0" />
          <Input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Find someone…"
            className="border-none focus-visible:ring-0"
          />
          <button type="button" onClick={onClose} aria-label="Close" className="p-1.5 rounded-md hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-4">
          {!q && recents.length > 0 && (
            <section>
              <div className="text-xs uppercase text-muted-foreground mb-2">Recent</div>
              <ul className="space-y-1">
                {recents.map((r) => (
                  <li key={r}>
                    <button onClick={() => setQ(r)} className="w-full text-left px-3 py-2 rounded-md hover:bg-muted text-sm">{r}</button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {loading && <div className="text-sm text-muted-foreground">Searching…</div>}
          {!loading && q && (
            <>
              <Section title="Registrations" count={results.registrations.length}>
                {results.registrations.map((r) => (
                  <ResultRow key={r.id} icon={<Calendar className="h-4 w-4" />} onClick={() => go(`/registrations/${r.id}`)}>
                    <div className="font-medium truncate">{r.name}</div>
                    <div className="text-xs text-muted-foreground truncate">{r.event_name || '—'} · {r.phone}</div>
                    <StatusBadge status={r.payment_status} />
                  </ResultRow>
                ))}
              </Section>
              <Section title="Guild members" count={results.guild_members.length}>
                {results.guild_members.map((g) => (
                  <ResultRow key={g.id} icon={<ShieldCheck className="h-4 w-4" />} onClick={() => go(`/guild/${g.id}`)}>
                    <div className="font-medium truncate">{g.name || '—'}</div>
                    <div className="text-xs text-muted-foreground truncate">{g.tier} · expires {g.expires_at} · {g.phone}</div>
                  </ResultRow>
                ))}
              </Section>
              <Section title="Users" count={results.users.length}>
                {results.users.map((u) => (
                  <ResultRow key={u.id} icon={<Phone className="h-4 w-4" />} onClick={() => go(`/registrations?phone=${encodeURIComponent(u.phone)}`)}>
                    <div className="font-medium truncate">{u.name || '—'}</div>
                    <div className="text-xs text-muted-foreground truncate">{u.phone}{u.email ? ` · ${u.email}` : ''}</div>
                  </ResultRow>
                ))}
              </Section>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section>
      <div className="text-xs uppercase text-muted-foreground mb-1">{title} ({count})</div>
      {count === 0 ? <div className="text-sm text-muted-foreground">No matches</div> : <ul className="space-y-1">{children}</ul>}
    </section>
  );
}

function ResultRow({ icon, children, onClick }: { icon: React.ReactNode; children: React.ReactNode; onClick: () => void }) {
  return (
    <li>
      <button onClick={onClick} className="w-full flex items-center gap-3 p-2 rounded-md hover:bg-muted text-left min-h-11">
        <div className="shrink-0 text-muted-foreground">{icon}</div>
        <div className="flex-1 min-w-0">{children}</div>
      </button>
    </li>
  );
}
```

- [ ] **Step 4: Run tests (3/3 pass)**

- [ ] **Step 5: Commit**

```bash
git add admin/src/components/SearchOverlay.tsx admin/src/components/SearchOverlay.test.tsx
git commit -m "feat(admin): SearchOverlay with phone-first matching + recents"
```

---

## Task 6: Wire SearchOverlay to TopBar + Cmd-K shortcut

**Files:**
- Modify: `admin/src/components/TopBar.tsx`

The TopBar already has a disabled search button (Phase 1). Replace `disabled` with an `onClick` that opens the overlay; bind `Cmd-K` (and "/") to open the same overlay.

- [ ] **Step 1: Modify `admin/src/components/TopBar.tsx`** — read the existing file, then:

  - Add state: `const [searchOpen, setSearchOpen] = useState(false);`
  - Replace `disabled` on both search buttons (mobile + desktop) with `onClick={() => setSearchOpen(true)}`. Drop the `title="Search arrives in Phase 3"`.
  - Add a `useEffect` keyboard handler:

```tsx
useEffect(() => {
  function onKey(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setSearchOpen(true); }
    if (e.key === '/' && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
      e.preventDefault();
      setSearchOpen(true);
    }
  }
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}, []);
```

  - Render `<SearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} />` at the end of the JSX.

- [ ] **Step 2: Verify**

```bash
cd admin && npx tsc --noEmit
cd admin && npm test
```

- [ ] **Step 3: Commit**

```bash
git add admin/src/components/TopBar.tsx
git commit -m "feat(admin): wire SearchOverlay + Cmd-K shortcut into TopBar"
```

---

## Task 7: RegistrationsList — mobile cards + ActionSheet status changes

**Files:**
- Modify: `admin/src/pages/RegistrationsList.tsx`

Render `MobileCardList` on `< md`, `DataTable` on `≥ md`. Each card shows name, event, phone (with `PhoneCell` WhatsApp link), status badge (tap → ActionSheet → mark confirmed/pending/cancelled). Add a FAB for "New manual registration" on mobile.

- [ ] **Step 1: Replace `admin/src/pages/RegistrationsList.tsx`** with the structure below. Read the existing file first to preserve filter state + URL params behavior.

```tsx
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus } from 'lucide-react';
import DataTable, { Column } from '@/components/DataTable';
import MobileCardList, { CardField } from '@/components/MobileCardList';
import { StatusBadge } from '@/components/StatusBadge';
import { PhoneCell } from '@/components/PhoneCell';
import { RelativeDate } from '@/components/RelativeDate';
import { ActionSheet, type ActionItem } from '@/components/ActionSheet';
import { fetchAdmin, showApiError } from '@/lib/api';
import { toast } from 'sonner';
import type { Registration, Event } from '@/lib/types';

export default function RegistrationsList() {
  const [params, setParams] = useSearchParams();
  const eventFilter = params.get('event') || '';
  const statusFilter = params.get('status') || '';
  const [regs, setRegs] = useState<Registration[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionTarget, setActionTarget] = useState<Registration | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    fetchAdmin<{ events: Event[] }>('/api/admin/events').then((r) => setEvents(r.events)).catch(showApiError);
  }, []);

  const refresh = () => {
    setLoading(true);
    const qs = new URLSearchParams();
    if (eventFilter) qs.set('event_id', eventFilter);
    if (statusFilter) qs.set('status', statusFilter);
    fetchAdmin<{ registrations: Registration[] }>(`/api/admin/registrations?${qs}`)
      .then((r) => setRegs(r.registrations))
      .catch(showApiError)
      .finally(() => setLoading(false));
  };

  useEffect(refresh, [eventFilter, statusFilter]);

  const eventNameById = useMemo(() => Object.fromEntries(events.map((e) => [e.id, e.name])), [events]);

  function setFilter(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next);
  }

  async function changeStatus(reg: Registration, status: Registration['payment_status']) {
    try {
      await fetchAdmin(`/api/admin/registrations/${reg.id}`, {
        method: 'PATCH', body: JSON.stringify({ payment_status: status }),
      });
      toast.success(`Marked ${status}`);
      refresh();
    } catch (e) { showApiError(e); }
  }

  const actionItems = (r: Registration): ActionItem[] => [
    { label: 'Mark confirmed', onClick: () => changeStatus(r, 'confirmed'), disabled: r.payment_status === 'confirmed' },
    { label: 'Mark pending', onClick: () => changeStatus(r, 'pending'), disabled: r.payment_status === 'pending' },
    { label: 'Mark cancelled', onClick: () => changeStatus(r, 'cancelled'), disabled: r.payment_status === 'cancelled', destructive: true },
    { label: 'Edit details', onClick: () => navigate(`/registrations/${r.id}`) },
    { label: 'Copy phone', onClick: () => navigator.clipboard?.writeText(r.phone) },
  ];

  const columns: Column<Registration>[] = [
    { key: 'name', header: 'Name', render: (r) => r.name },
    { key: 'phone', header: 'Phone', render: (r) => <PhoneCell phone={r.phone} /> },
    { key: 'event', header: 'Event', render: (r) => eventNameById[r.event_id] || '—' },
    { key: 'seats', header: 'Seats', render: (r) => r.seats },
    { key: 'total', header: 'Total', render: (r) => `₹${r.total_amount}` },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.payment_status} /> },
    { key: 'created', header: 'Created', render: (r) => <RelativeDate iso={r.created_at} /> },
  ];

  const fields: CardField<Registration>[] = [
    { key: 'name', render: (r) => r.name, primary: true },
    { key: 'event', render: (r) => eventNameById[r.event_id] || '—' },
    { key: 'phone', render: (r) => <PhoneCell phone={r.phone} /> },
    { key: 'total', render: (r) => `${r.seats} seat${r.seats === 1 ? '' : 's'} · ₹${r.total_amount}` },
  ];

  const upcoming = events.filter((e) => Date.parse(e.date) >= Date.now()).sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  const past = events.filter((e) => Date.parse(e.date) < Date.now()).sort((a, b) => Date.parse(b.date) - Date.parse(a.date));

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">Registrations</h1>
        <Button asChild className="hidden md:inline-flex">
          <Link to="/registrations/new">New manual registration</Link>
        </Button>
      </div>
      <div className="flex gap-2 mb-3 flex-wrap">
        <Select value={eventFilter || 'all'} onValueChange={(v) => setFilter('event', v === 'all' ? '' : v)}>
          <SelectTrigger className="w-72"><SelectValue placeholder="All events" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All events</SelectItem>
            {upcoming.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
            {past.length > 0 && <SelectItem value="__sep" disabled>── past ──</SelectItem>}
            {past.map((e) => <SelectItem key={e.id} value={e.id}>{e.name} (past)</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={statusFilter || 'all'} onValueChange={(v) => setFilter('status', v === 'all' ? '' : v)}>
          <SelectTrigger className="w-48"><SelectValue placeholder="All statuses" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="confirmed">Confirmed</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {loading ? <p>Loading…</p> : (
        <>
          <div className="md:hidden">
            <MobileCardList
              rows={regs}
              fields={fields}
              rowKey={(r) => r.id}
              onRowClick={(r) => setActionTarget(r)}
              emptyMessage="No registrations match these filters."
              trailing={(r) => <StatusBadge status={r.payment_status} />}
            />
          </div>
          <div className="hidden md:block">
            <DataTable
              rows={regs}
              columns={columns}
              rowKey={(r) => r.id}
              onRowClick={(r) => navigate(`/registrations/${r.id}${params.toString() ? '?' + params.toString() : ''}`)}
              emptyMessage="No registrations match."
            />
          </div>
        </>
      )}

      {/* FAB on mobile */}
      <Link
        to="/registrations/new"
        className="md:hidden fixed right-4 bottom-20 z-30 h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center"
        style={{ bottom: 'calc(5rem + env(safe-area-inset-bottom))' }}
        aria-label="New manual registration"
      >
        <Plus className="h-6 w-6" />
      </Link>

      <ActionSheet
        open={!!actionTarget}
        title={actionTarget ? `${actionTarget.name} · ${eventNameById[actionTarget.event_id] || ''}` : ''}
        actions={actionTarget ? actionItems(actionTarget) : []}
        onClose={() => setActionTarget(null)}
      />
    </div>
  );
}
```

- [ ] **Step 2: Verify**

```bash
cd admin && npx tsc --noEmit
cd admin && npm test
```

- [ ] **Step 3: Manual smoke** — at 375px, the list renders as cards; tapping a card opens the action sheet; "Mark confirmed" updates the row. At 1280px, the existing table view renders unchanged.

- [ ] **Step 4: Commit**

```bash
git add admin/src/pages/RegistrationsList.tsx
git commit -m "feat(admin): mobile card layout + tap-to-action-sheet on registrations"
```

---

## Task 8: GuildList — mobile cards + inline ✓/✗ for pending

**Files:**
- Modify: `admin/src/pages/GuildList.tsx`

Same dual-render pattern as Task 7. On the pending tab (`?status=pending`), each card surfaces two big buttons inline: ✓ "Mark paid" and ✗ "Cancel". Tapping "Mark paid" calls a small inline modal that asks only for the start date (default today; expiry auto-set by tier — initiate +90, adventurer +180, guildmaster +365).

- [ ] **Step 1: Replace `admin/src/pages/GuildList.tsx`** following the dual-render pattern from Task 7 plus inline buttons. Outline:

```tsx
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Check, X } from 'lucide-react';
import DataTable, { Column } from '@/components/DataTable';
import MobileCardList, { CardField } from '@/components/MobileCardList';
import { StatusBadge } from '@/components/StatusBadge';
import { PhoneCell } from '@/components/PhoneCell';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { fetchAdmin, showApiError } from '@/lib/api';
import { toast } from 'sonner';
import type { GuildMember } from '@/lib/types';

const TIER_DAYS: Record<string, number> = { initiate: 90, adventurer: 180, guildmaster: 365 };

export default function GuildList() {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') || '';
  const tier = params.get('tier') || '';
  const [members, setMembers] = useState<GuildMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmTarget, setConfirmTarget] = useState<GuildMember | null>(null);
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const navigate = useNavigate();

  const refresh = () => {
    setLoading(true);
    const qs = new URLSearchParams();
    if (status) qs.set('status', status);
    if (tier) qs.set('tier', tier);
    fetchAdmin<{ members: GuildMember[] }>(`/api/admin/guild-members?${qs}`)
      .then((r) => setMembers(r.members))
      .catch(showApiError)
      .finally(() => setLoading(false));
  };
  useEffect(refresh, [status, tier]);

  function setFilter(k: string, v: string) {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v); else next.delete(k);
    setParams(next);
  }

  async function markCancelled(m: GuildMember) {
    try {
      await fetchAdmin(`/api/admin/guild-members/${m.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'cancelled' }) });
      toast.success('Marked cancelled');
      refresh();
    } catch (e) { showApiError(e); }
  }

  async function confirmMarkPaid() {
    if (!confirmTarget) return;
    const start = new Date(startDate);
    const days = TIER_DAYS[confirmTarget.tier] ?? 90;
    const expires = new Date(start);
    expires.setDate(start.getDate() + days);
    try {
      await fetchAdmin(`/api/admin/guild-members/${confirmTarget.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: 'paid',
          starts_at: startDate,
          expires_at: expires.toISOString().slice(0, 10),
        }),
      });
      toast.success(`${confirmTarget.user_name || 'Member'} marked paid`);
      setConfirmTarget(null);
      refresh();
    } catch (e) { showApiError(e); }
  }

  const columns: Column<GuildMember>[] = [
    { key: 'name', header: 'Name', render: (m) => m.user_name || '—' },
    { key: 'phone', header: 'Phone', render: (m) => <PhoneCell phone={m.user_phone} /> },
    { key: 'tier', header: 'Tier', render: (m) => m.tier },
    { key: 'expires', header: 'Expires', render: (m) => m.expires_at },
    { key: 'status', header: 'Status', render: (m) => <StatusBadge status={m.status as any} /> },
  ];

  const fields: CardField<GuildMember>[] = [
    { key: 'name', render: (m) => m.user_name || '—', primary: true },
    { key: 'tier', render: (m) => `${m.tier} · expires ${m.expires_at}` },
    { key: 'phone', render: (m) => <PhoneCell phone={m.user_phone} /> },
  ];

  const isPendingFilter = status === 'pending';

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-4">Guild members</h1>
      <div className="flex gap-2 mb-3 flex-wrap">
        <Select value={status || 'all'} onValueChange={(v) => setFilter('status', v === 'all' ? '' : v)}>
          <SelectTrigger className="w-48"><SelectValue placeholder="All statuses" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="paid">Paid</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
        <Select value={tier || 'all'} onValueChange={(v) => setFilter('tier', v === 'all' ? '' : v)}>
          <SelectTrigger className="w-48"><SelectValue placeholder="All tiers" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All tiers</SelectItem>
            <SelectItem value="initiate">Initiate</SelectItem>
            <SelectItem value="adventurer">Adventurer</SelectItem>
            <SelectItem value="guildmaster">Guildmaster</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {loading ? <p>Loading…</p> : (
        <>
          <div className="md:hidden space-y-2">
            {isPendingFilter ? (
              members.length === 0 ? (
                <div className="text-sm text-muted-foreground p-4">Nothing waiting — you're caught up.</div>
              ) : members.map((m) => (
                <div key={m.id} className="rounded-md border bg-card p-3 space-y-2">
                  <div className="flex items-start justify-between">
                    <div className="min-w-0">
                      <div className="font-semibold truncate">{m.user_name || '—'}</div>
                      <div className="text-sm text-muted-foreground">{m.tier}</div>
                      <PhoneCell phone={m.user_phone} className="text-sm" />
                    </div>
                    <StatusBadge status="pending" />
                  </div>
                  <div className="flex gap-2 pt-1">
                    <Button className="flex-1" onClick={() => setConfirmTarget(m)}>
                      <Check className="h-4 w-4 mr-1" /> Mark paid
                    </Button>
                    <Button variant="destructive" className="flex-1" onClick={() => markCancelled(m)}>
                      <X className="h-4 w-4 mr-1" /> Cancel
                    </Button>
                  </div>
                </div>
              ))
            ) : (
              <MobileCardList rows={members} fields={fields} rowKey={(m) => m.id} onRowClick={(m) => navigate(`/guild/${m.id}`)} emptyMessage="No guild members match these filters." trailing={(m) => <StatusBadge status={m.status as any} />} />
            )}
          </div>
          <div className="hidden md:block">
            <DataTable rows={members} columns={columns} rowKey={(m) => m.id} onRowClick={(m) => navigate(`/guild/${m.id}`)} emptyMessage="No guild members match." />
          </div>
        </>
      )}

      <Dialog open={!!confirmTarget} onOpenChange={(o) => { if (!o) setConfirmTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark {confirmTarget?.user_name || 'member'} as paid</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Start date</Label>
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            <div className="text-xs text-muted-foreground">
              Expires {TIER_DAYS[confirmTarget?.tier || 'initiate']} days later (auto).
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmTarget(null)}>Cancel</Button>
            <Button onClick={confirmMarkPaid}>Confirm</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

- [ ] **Step 2: Verify + commit**

```bash
cd admin && npx tsc --noEmit
cd admin && npm test
git add admin/src/pages/GuildList.tsx
git commit -m "feat(admin): GuildList mobile cards + inline pending verify/cancel"
```

---

## Task 9: EventsList — mobile cards + FAB

**Files:**
- Modify: `admin/src/pages/EventsList.tsx`

Same dual-render pattern. Card shows: name, relative date (`RelativeDate`), capacity bar, status badge.

- [ ] **Step 1: Replace `admin/src/pages/EventsList.tsx`** with dual-render structure (mirror Task 7's pattern). Capacity bar can be a simple `<div className="h-2 bg-muted">` with an inner div sized via inline style. FAB to `/events/new` mirrors Task 7.

The mobile card fields:
```tsx
const fields: CardField<Event>[] = [
  { key: 'name', render: (e) => e.name, primary: true },
  { key: 'date', render: (e) => <RelativeDate iso={e.date} /> },
  { key: 'venue', render: (e) => e.venue_name || '—' },
];
const trailing = (e: Event) => <StatusBadge status={e.is_published ? 'published' : 'draft'} />;
```

The desktop table replaces today's plain text columns with `<RelativeDate>` for the date and `<StatusBadge>` for the status.

- [ ] **Step 2: Verify + commit**

```bash
cd admin && npx tsc --noEmit
cd admin && npm test
git add admin/src/pages/EventsList.tsx
git commit -m "feat(admin): EventsList mobile cards + FAB"
```

---

## Task 10: GamesList — mobile cards + FAB

**Files:**
- Modify: `admin/src/pages/GamesList.tsx`

Same pattern. Card primary = title; secondary = "Players · Complexity"; trailing = "with {currently_with}". FAB to `/games/new`.

- [ ] **Step 1: Replace `admin/src/pages/GamesList.tsx`** with dual-render structure (mirror Task 7). Preserve the existing search + "Filter by who has it" inputs.

- [ ] **Step 2: Verify + commit**

```bash
cd admin && npx tsc --noEmit
cd admin && npm test
git add admin/src/pages/GamesList.tsx
git commit -m "feat(admin): GamesList mobile cards + FAB"
```

---

## Task 11: Dashboard mobile reflow

**Files:**
- Modify: `admin/src/pages/Dashboard.tsx`
- Modify: `admin/src/components/DashboardCard.tsx`

On mobile, custom-question summaries collapse behind a "View breakdown" button (tap → expands inline or opens an action sheet). Today's `DashboardCard` always renders all summaries inline; lift the breakdown into a collapsible block on `< md`.

- [ ] **Step 1: Modify `DashboardCard.tsx`**

Wrap the `questions.length > 0` block in a state-toggled expander on mobile (always shown on `≥ md`):

```tsx
import { useState } from 'react';
// ... existing imports

const [expanded, setExpanded] = useState(false);

// inside render, replace the existing questions block with:
{questions.length > 0 && (
  <>
    <button
      type="button"
      onClick={() => setExpanded((x) => !x)}
      className="md:hidden text-sm text-primary hover:underline w-full text-left flex items-center gap-1"
    >
      {expanded ? '▾' : '▸'} View breakdown
    </button>
    <div className={`space-y-2 ${expanded ? '' : 'hidden md:block'}`}>
      {questions.map((q) => {
        const s = custom_question_summary[q.id];
        if (!s) return null;
        return <QuestionSummaryRow key={q.id} question={q} summary={s} />;
      })}
    </div>
  </>
)}
```

- [ ] **Step 2: Verify + commit**

```bash
cd admin && npx tsc --noEmit
cd admin && npm test
git add admin/src/components/DashboardCard.tsx
git commit -m "feat(admin): collapse custom-question breakdown on mobile dashboard cards"
```

---

## Task 12: Service worker — offline read cache + offline banner

**Files:**
- Modify: `admin/public/sw.js`
- Create: `admin/src/components/OfflineBanner.tsx`
- Modify: `admin/src/components/Layout.tsx`

Today's `sw.js` only caches the app shell. Extend it with a stale-while-revalidate strategy for `/api/admin/*` GETs: serve cached response if available, then fetch in background and update cache. Add a custom response header `x-cache-age: <seconds>` so the client can show the offline/stale banner.

- [ ] **Step 1: Update `admin/public/sw.js`**

Append to the existing `fetch` listener (or restructure):

```js
const API_CACHE = 'bgc-admin-api-v1';

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // ... existing checks ...

  // Admin API GETs: stale-while-revalidate
  if (e.request.method === 'GET' && url.pathname.startsWith('/api/admin/')) {
    e.respondWith((async () => {
      const cache = await caches.open(API_CACHE);
      const cached = await cache.match(e.request);
      const networkPromise = fetch(e.request).then(async (res) => {
        if (res.ok) {
          // Stamp a cache age via a sidecar key so the client can detect staleness.
          const stamped = new Response(await res.clone().text(), {
            status: res.status,
            statusText: res.statusText,
            headers: new Headers([
              ...res.headers,
              ['x-cache-stamp', String(Date.now())],
              ['Content-Type', res.headers.get('Content-Type') || 'application/json'],
            ]),
          });
          cache.put(e.request, stamped.clone());
          return stamped;
        }
        return res;
      }).catch(() => cached);

      if (cached) {
        // Fire-and-forget revalidate.
        e.waitUntil(networkPromise);
        return cached;
      }
      return networkPromise;
    })());
    return;
  }
});
```

Note: the existing service worker has an `if (url.pathname.startsWith('/api/'))` short-circuit at the top of the `fetch` handler that returns early. Remove that branch (or scope it to non-admin) so the stale-while-revalidate for admin can run.

- [ ] **Step 2: Implement `admin/src/components/OfflineBanner.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { WifiOff } from 'lucide-react';

export function OfflineBanner() {
  const [offline, setOffline] = useState(typeof navigator !== 'undefined' && !navigator.onLine);
  useEffect(() => {
    const on = () => setOffline(false);
    const off = () => setOffline(true);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  if (!offline) return null;
  return (
    <div className="bg-status-pending text-status-pending-foreground text-sm flex items-center gap-2 px-4 py-2">
      <WifiOff className="h-4 w-4 shrink-0" />
      You're offline — showing the last data we fetched. Saving is disabled.
    </div>
  );
}
```

- [ ] **Step 3: Mount in `Layout.tsx`** — add `<OfflineBanner />` immediately above `<TopBar />`.

- [ ] **Step 4: Block mutations when offline** — modify `admin/src/lib/api.ts` `fetchAdmin` to check `navigator.onLine` before non-GET requests:

```ts
if (init?.method && init.method !== 'GET' && typeof navigator !== 'undefined' && !navigator.onLine) {
  throw new ApiError(0, "You're offline. Connect to save.");
}
```

(The unit test `api.test.ts` may need a small update to mock `navigator.onLine` — adjust accordingly to keep all 4 tests passing.)

- [ ] **Step 5: Verify**

```bash
cd admin && npm test
cd admin && npm run build
```

Expected: tests pass, build succeeds.

- [ ] **Step 6: Commit**

```bash
git add admin/public/sw.js admin/src/components/OfflineBanner.tsx admin/src/components/Layout.tsx admin/src/lib/api.ts admin/src/lib/api.test.ts
git commit -m "feat(admin): offline read cache + offline banner + mutation guard"
```

---

## Task 13: Manual end-to-end verification

- [ ] **Step 1: Deploy worker** (with new `/api/admin/search` and `/api/admin/log` endpoints)

```bash
cd worker && npx wrangler deploy
```

- [ ] **Step 2: Run admin dev server** and smoke at desktop (1280px):
  - TopBar search button now opens the overlay; `Cmd-K` works.
  - Type "amrit" → registrations/users listed; tapping a result navigates.
  - Refresh / clear and confirm recent searches appear.

- [ ] **Step 3: Smoke at phone (375px)**:
  - Each list (Registrations, Guild, Events, Games) renders as cards with a FAB for create.
  - Tap a registration card → action sheet appears with status changes.
  - Open `/guild?status=pending` → each card has ✓ "Mark paid" / ✗ "Cancel" buttons. "Mark paid" opens a date dialog.
  - Dashboard custom-question breakdowns collapse behind "View breakdown".

- [ ] **Step 4: Offline test** — DevTools Network → Offline. Refresh dashboard; offline banner appears, dashboard renders from cache. Try to save anything → "You're offline" toast.

- [ ] **Step 5: Capture screenshots** to `docs/superpowers/screenshots/2026-05-02-phase-3-after/` and commit.

---

## Self-review summary

**Spec coverage check (Phase 3 + cross-cutting requirements vs. tasks):**
- Global "Find someone" search overlay — Tasks 1, 5, 6.
- Cmd-K / "/" shortcut — Task 6.
- Recent searches localStorage — Task 5.
- Phone-first matching — Task 1.
- Registrations mobile card layout + ActionSheet for status — Tasks 4, 7.
- Sticky filter bar — Task 7 (filter row stays at top).
- Pull-to-refresh — *deferred* (browser default refresh works; native pull-to-refresh requires extra library, not justified for 4 admins).
- Guild pending verify/reject inline buttons — Task 8.
- Mark-paid simplified flow (date only, expiry auto) — Task 8.
- EventsList mobile cards + FAB — Task 9.
- GamesList mobile cards + FAB — Task 10.
- Dashboard custom-question breakdown collapse on mobile — Task 11.
- Offline read caching — Task 12.
- Offline banner — Task 12.
- Mutation refusal when offline — Task 12.
- Telemetry / `lib/log.ts` (cross-cutting) — Tasks 2, 3.

**Type consistency:**
- `ActionSheet` `ActionItem` is consumed by `RegistrationsList` (Task 7).
- `MobileCardList`'s `CardField<T>` consumed by Tasks 7, 9, 10 (Guild Task 8 hand-rolls the layout because of the inline action buttons).
- `SearchResults` shape from worker (Task 1) matches the type in `SearchOverlay` (Task 5).
- `StatusBadge` accepts the existing variants from Phase 1 (`confirmed`, `pending`, etc) — no changes needed.

**Out of scope:**
- Pull-to-refresh, native swipe gestures.
- DB-backed error log (uses console.warn instead — sufficient for 4 admins).
- Sharing search results across the public site.

**Prerequisite reminder:** This phase must be implemented after Phases 1 and 2 are merged. The starting point assumes `FormDrawer`, `validation.ts`, `StatusBadge`, `RelativeDate`, `PhoneCell`, `MobileCardList`, `BottomTabBar`, and the upgraded `DataTable` already exist on `main`.
