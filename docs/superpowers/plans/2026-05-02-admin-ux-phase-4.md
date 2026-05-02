# Admin UX Improvements — Phase 4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make laptop work efficient. Wire multi-select on Registrations/Guild/Games (the `DataTable` capability shipped in Phase 1), add a sticky `BulkActionBar` with page-specific bulk operations (status changes, CSV export, WhatsApp broadcast clipboard, bulk-update "Currently with"), enable sortable columns on the obvious columns, persist saved filter views in localStorage, and add inline edit on two high-frequency desktop fields (Registrations status pill, Games "Currently with").

**Architecture:** Worker gains three CSV export endpoints. Admin gains a `BulkActionBar` primitive, a `BulkConfirmDialog` primitive, and migrations to the four desktop list pages. No DB changes.

**Tech Stack:** Continues from Phases 1–3. The DataTable already supports `selectable`, `sortable`, `dense`, and truncation (Phase 1). This phase consumes those capabilities.

**Spec reference:** `docs/superpowers/specs/2026-05-02-admin-ux-improvements-design.md` — Phase 4.

**Prerequisite:** Phases 1, 2, and 3 must already be merged. The mobile lists from Phase 3 stay unchanged — bulk multi-select doesn't apply to the mobile card view.

---

## File Structure

**New files (admin):**
- `admin/src/components/BulkActionBar.tsx` + test
- `admin/src/components/BulkConfirmDialog.tsx` + test
- `admin/src/lib/savedViews.ts` + test (localStorage helpers)
- `admin/src/lib/csv.ts` + test (CSV row serialization helper, used by worker tests too if convenient — actually keep this admin-side as a clipboard/template helper if needed; CSV building lives in the worker)

**New files (worker):**
- `worker/src/admin/export-registrations.ts` + test
- `worker/src/admin/export-guild.ts` + test
- `worker/src/admin/export-games.ts` + test
- `worker/src/admin/csv.ts` + test (shared CSV serializer)

**Modified files (admin):**
- `admin/src/pages/RegistrationsList.tsx` — selectable + BulkActionBar + sortable + saved views + inline status edit on desktop.
- `admin/src/pages/GuildList.tsx` — selectable + BulkActionBar + sortable + saved views.
- `admin/src/pages/GamesList.tsx` — selectable + BulkActionBar + sortable + inline "Currently with" edit.
- `admin/src/pages/EventsList.tsx` — sortable on date / capacity (no bulk actions).

**Modified files (worker):**
- `worker/src/index.ts` — three new GET routes.

---

## Task 1: Worker — CSV serializer

**Files:**
- Create: `worker/src/admin/csv.ts`
- Create: `worker/src/admin/csv.test.ts`

A pure helper consumed by the three export endpoints.

- [ ] **Step 1: Write failing test in `worker/src/admin/csv.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { toCsv } from './csv';

describe('toCsv', () => {
  it('emits header + rows for plain string values', () => {
    const csv = toCsv(['name', 'phone'], [{ name: 'Alice', phone: '9876543210' }]);
    expect(csv).toBe('name,phone\nAlice,9876543210\n');
  });

  it('quotes values containing commas', () => {
    const csv = toCsv(['note'], [{ note: 'hello, world' }]);
    expect(csv).toBe('note\n"hello, world"\n');
  });

  it('escapes inner double-quotes', () => {
    const csv = toCsv(['note'], [{ note: 'she said "hi"' }]);
    expect(csv).toBe('note\n"she said ""hi"""\n');
  });

  it('renders nullish as empty', () => {
    const csv = toCsv(['a', 'b'], [{ a: null, b: undefined }]);
    expect(csv).toBe('a,b\n,\n');
  });

  it('handles numbers and booleans', () => {
    const csv = toCsv(['n', 'b'], [{ n: 42, b: true }]);
    expect(csv).toBe('n,b\n42,true\n');
  });

  it('preserves header order across rows', () => {
    const csv = toCsv(['a', 'b'], [{ b: 1, a: 2 }, { a: 3, b: 4 }]);
    expect(csv).toBe('a,b\n2,1\n3,4\n');
  });
});
```

- [ ] **Step 2: Run, confirm fail**

```bash
cd worker && npm test -- csv.test
```

- [ ] **Step 3: Implement `worker/src/admin/csv.ts`**

```ts
function escape(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv<T extends Record<string, unknown>>(
  headers: ReadonlyArray<keyof T & string>,
  rows: ReadonlyArray<T>,
): string {
  const out: string[] = [];
  out.push(headers.map((h) => escape(h)).join(','));
  for (const r of rows) {
    out.push(headers.map((h) => escape(r[h])).join(','));
  }
  return out.join('\n') + '\n';
}
```

- [ ] **Step 4: Run, confirm pass**

```bash
cd worker && npm test -- csv.test
```

- [ ] **Step 5: Commit**

```bash
git add worker/src/admin/csv.ts worker/src/admin/csv.test.ts
git commit -m "feat(worker): pure CSV serializer with proper quoting"
```

---

## Task 2: Worker — registrations CSV export

**Files:**
- Create: `worker/src/admin/export-registrations.ts`
- Create: `worker/src/admin/export-registrations.test.ts`
- Modify: `worker/src/index.ts`

`GET /api/admin/registrations/export?event_id=&status=&ids=...` returns a CSV with columns: `name, phone, email, event, seats, total_amount, payment_status, source, created_at` plus one column per distinct custom-question label. If `ids` is supplied, restrict to those rows; otherwise honor `event_id` / `status` filters (same as the list endpoint).

- [ ] **Step 1: Write failing test for the helper that flattens registrations + custom questions** (the supabase query is harder to unit test — focus the test on the row-flattening logic).

```ts
import { describe, it, expect } from 'vitest';
import { flattenRegistrations, type RegRow, type EventRow } from './export-registrations';

describe('flattenRegistrations', () => {
  const events: EventRow[] = [
    { id: 'e1', name: 'Game night', custom_questions: [{ id: 'meal', label: 'Meal', type: 'select', required: true, options: [{ value: 'Veg' }] }] },
  ];
  const regs: RegRow[] = [
    { id: 'r1', name: 'A', phone: '9876500001', email: 'a@x.com', event_id: 'e1', seats: 2, total_amount: 400, payment_status: 'confirmed', source: null, created_at: '2026-04-30T10:00:00Z', custom_answers: { meal: 'Veg' } },
  ];

  it('returns headers including dynamic custom question labels', () => {
    const { headers } = flattenRegistrations(regs, events);
    expect(headers).toEqual([
      'name', 'phone', 'email', 'event', 'seats', 'total_amount', 'payment_status', 'source', 'created_at', 'Meal',
    ]);
  });

  it('flattens custom answers into matching columns', () => {
    const { rows } = flattenRegistrations(regs, events);
    expect(rows[0]).toEqual({
      name: 'A', phone: '9876500001', email: 'a@x.com',
      event: 'Game night', seats: 2, total_amount: 400,
      payment_status: 'confirmed', source: null, created_at: '2026-04-30T10:00:00Z',
      Meal: 'Veg',
    });
  });

  it('handles empty custom_answers without crashing', () => {
    const empty: RegRow[] = [{ ...regs[0], custom_answers: null }];
    const { rows } = flattenRegistrations(empty, events);
    expect(rows[0].Meal).toBe('');
  });
});
```

- [ ] **Step 2: Run, confirm fail**

- [ ] **Step 3: Implement `worker/src/admin/export-registrations.ts`**

```ts
import type { Env } from '../index';
import { getSupabase } from '../supabase';
import { toCsv } from './csv';

export interface RegRow {
  id: string; name: string; phone: string; email: string | null;
  event_id: string; seats: number; total_amount: number;
  payment_status: 'pending' | 'confirmed' | 'cancelled';
  source: string | null; created_at: string;
  custom_answers: Record<string, string | boolean> | null;
}

export interface EventRow {
  id: string; name: string;
  custom_questions: Array<{ id: string; label: string; type: string; required: boolean; options?: Array<{ value: string }> }> | null;
}

export function flattenRegistrations(regs: RegRow[], events: EventRow[]) {
  const eventById: Record<string, EventRow> = Object.fromEntries(events.map((e) => [e.id, e]));
  const dynamicLabels: string[] = [];
  const seenLabels = new Set<string>();
  for (const r of regs) {
    const ev = eventById[r.event_id];
    for (const q of ev?.custom_questions || []) {
      if (!seenLabels.has(q.label)) {
        seenLabels.add(q.label);
        dynamicLabels.push(q.label);
      }
    }
  }
  const baseHeaders = ['name', 'phone', 'email', 'event', 'seats', 'total_amount', 'payment_status', 'source', 'created_at'] as const;
  const headers = [...baseHeaders, ...dynamicLabels];

  const rows = regs.map((r) => {
    const ev = eventById[r.event_id];
    const row: Record<string, string | number | null> = {
      name: r.name,
      phone: r.phone,
      email: r.email,
      event: ev?.name ?? '',
      seats: r.seats,
      total_amount: r.total_amount,
      payment_status: r.payment_status,
      source: r.source,
      created_at: r.created_at,
    };
    for (const q of ev?.custom_questions || []) {
      const v = r.custom_answers?.[q.id];
      row[q.label] = typeof v === 'boolean' ? (v ? 'Yes' : 'No') : (typeof v === 'string' ? v : '');
    }
    return row;
  });

  return { headers, rows };
}

export async function handleExportRegistrations(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const eventId = url.searchParams.get('event_id');
  const status = url.searchParams.get('status');
  const ids = url.searchParams.get('ids')?.split(',').filter(Boolean);

  const supabase = getSupabase(env);
  let q = supabase.from('registrations').select('*');
  if (ids && ids.length > 0) q = q.in('id', ids);
  else {
    if (eventId) q = q.eq('event_id', eventId);
    if (status) q = q.eq('payment_status', status);
  }
  const { data: regs, error } = await q;
  if (error) return new Response(JSON.stringify({ error: 'Failed to load' }), { status: 500 });

  const eventIds = Array.from(new Set((regs || []).map((r: any) => r.event_id)));
  const { data: events } = eventIds.length > 0
    ? await supabase.from('events').select('id, name, custom_questions').in('id', eventIds)
    : { data: [] };

  const { headers, rows } = flattenRegistrations((regs || []) as RegRow[], (events || []) as EventRow[]);
  const csv = toCsv(headers, rows);
  const filename = `registrations-${new Date().toISOString().slice(0, 10)}.csv`;
  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
```

- [ ] **Step 4: Run, confirm pass**

- [ ] **Step 5: Wire route in `worker/src/index.ts`**

```ts
import { handleExportRegistrations } from './admin/export-registrations';

if (url.pathname === '/api/admin/registrations/export' && request.method === 'GET') {
  response = await handleExportRegistrations(request, env);
}
```

- [ ] **Step 6: Commit**

```bash
git add worker/src/admin/export-registrations.ts worker/src/admin/export-registrations.test.ts worker/src/index.ts
git commit -m "feat(worker): registrations CSV export with dynamic custom-question columns"
```

---

## Task 3: Worker — guild members CSV export

**Files:**
- Create: `worker/src/admin/export-guild.ts`
- Create: `worker/src/admin/export-guild.test.ts`
- Modify: `worker/src/index.ts`

`GET /api/admin/guild-members/export?status=&tier=&ids=`. Columns: `name, phone, email, tier, status, starts_at, expires_at, plus_ones_used, source`.

- [ ] **Step 1: TDD a small flatten helper** (similar to Task 2 but no custom-questions complication).

- [ ] **Step 2: Implement** following Task 2's structure. Query `guild_path_members` joined with users; either honor `ids` or `status`/`tier` filters.

- [ ] **Step 3: Wire route, commit**

```bash
git add worker/src/admin/export-guild.ts worker/src/admin/export-guild.test.ts worker/src/index.ts
git commit -m "feat(worker): guild members CSV export"
```

---

## Task 4: Worker — games CSV export

**Files:**
- Create: `worker/src/admin/export-games.ts`
- Create: `worker/src/admin/export-games.test.ts`
- Modify: `worker/src/index.ts`

`GET /api/admin/games/export?ids=`. Columns: `title, player_count, complexity, owned_by, currently_with, length, max_players`.

- [ ] **Step 1: TDD flatten helper, implement, wire route, commit.**

```bash
git add worker/src/admin/export-games.ts worker/src/admin/export-games.test.ts worker/src/index.ts
git commit -m "feat(worker): games CSV export"
```

---

## Task 5: BulkActionBar primitive

**Files:**
- Create: `admin/src/components/BulkActionBar.tsx`
- Create: `admin/src/components/BulkActionBar.test.tsx`

A sticky bar that slides in from the top of the page when at least one row is selected. Shows "<N> selected · [actions] · Clear".

- [ ] **Step 1: Write failing test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BulkActionBar, type BulkAction } from './BulkActionBar';

describe('BulkActionBar', () => {
  it('renders nothing when count is 0', () => {
    const { container } = render(<BulkActionBar count={0} actions={[]} onClear={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders selection count and actions when count > 0', () => {
    const onClick = vi.fn();
    const actions: BulkAction[] = [{ label: 'Mark confirmed', onClick }];
    render(<BulkActionBar count={3} actions={actions} onClear={() => {}} />);
    expect(screen.getByText(/3 selected/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Mark confirmed' }));
    expect(onClick).toHaveBeenCalled();
  });

  it('renders Clear button calling onClear', () => {
    const onClear = vi.fn();
    render(<BulkActionBar count={1} actions={[]} onClear={onClear} />);
    fireEvent.click(screen.getByRole('button', { name: /clear/i }));
    expect(onClear).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Implement `admin/src/components/BulkActionBar.tsx`**

```tsx
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface BulkAction {
  label: string;
  onClick: () => void;
  destructive?: boolean;
  disabled?: boolean;
}

interface Props {
  count: number;
  actions: BulkAction[];
  onClear: () => void;
}

export function BulkActionBar({ count, actions, onClear }: Props) {
  if (count === 0) return null;
  return (
    <div className="hidden md:flex sticky top-0 z-30 bg-secondary text-secondary-foreground rounded-md mb-3 px-3 py-2 items-center gap-2 flex-wrap">
      <span className="font-medium">{count} selected</span>
      <span className="opacity-50">·</span>
      {actions.map((a) => (
        <Button
          key={a.label}
          size="sm"
          variant={a.destructive ? 'destructive' : 'secondary'}
          onClick={a.onClick}
          disabled={a.disabled}
          className={cn(a.destructive ? '' : 'bg-background text-foreground hover:bg-muted')}
        >
          {a.label}
        </Button>
      ))}
      <span className="opacity-50">·</span>
      <Button size="sm" variant="ghost" onClick={onClear} className="text-secondary-foreground hover:bg-secondary/80">
        Clear
      </Button>
    </div>
  );
}
```

- [ ] **Step 3: Run, confirm 3/3 pass.**

- [ ] **Step 4: Commit**

```bash
git add admin/src/components/BulkActionBar.tsx admin/src/components/BulkActionBar.test.tsx
git commit -m "feat(admin): BulkActionBar primitive (desktop only)"
```

---

## Task 6: BulkConfirmDialog primitive

**Files:**
- Create: `admin/src/components/BulkConfirmDialog.tsx`
- Create: `admin/src/components/BulkConfirmDialog.test.tsx`

For destructive bulk actions: shows count + sample names + a confirm button.

- [ ] **Step 1: Test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BulkConfirmDialog } from './BulkConfirmDialog';

describe('BulkConfirmDialog', () => {
  it('lists sample names with overflow text when count > sample length', () => {
    render(
      <BulkConfirmDialog
        open
        title="Cancel registrations?"
        count={5}
        sampleNames={['Amrit', 'Suranjana']}
        confirmLabel="Cancel 5"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByText(/Amrit, Suranjana, \+3 more/i)).toBeInTheDocument();
  });

  it('calls onConfirm', () => {
    const onConfirm = vi.fn();
    render(
      <BulkConfirmDialog
        open title="x" count={1} sampleNames={['A']} confirmLabel="Go"
        onConfirm={onConfirm} onCancel={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Go' }));
    expect(onConfirm).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Implement**

```tsx
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface Props {
  open: boolean;
  title: string;
  count: number;
  sampleNames: string[];
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function BulkConfirmDialog({ open, title, count, sampleNames, confirmLabel, onConfirm, onCancel }: Props) {
  const overflow = count - sampleNames.length;
  const description = overflow > 0
    ? `${sampleNames.join(', ')}, +${overflow} more`
    : sampleNames.join(', ');
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{description}</p>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>Keep</Button>
          <Button variant="destructive" onClick={onConfirm}>{confirmLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Run, confirm pass.**

- [ ] **Step 4: Commit**

```bash
git add admin/src/components/BulkConfirmDialog.tsx admin/src/components/BulkConfirmDialog.test.tsx
git commit -m "feat(admin): BulkConfirmDialog with count + sample names"
```

---

## Task 7: Saved filter views library

**Files:**
- Create: `admin/src/lib/savedViews.ts`
- Create: `admin/src/lib/savedViews.test.ts`

Per-page localStorage helper. API: `listViews(pageKey)`, `saveView(pageKey, name, params)`, `deleteView(pageKey, name)`, `getView(pageKey, name)`.

- [ ] **Step 1: Test**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { listViews, saveView, deleteView } from './savedViews';

describe('savedViews', () => {
  beforeEach(() => localStorage.clear());

  it('saves and lists views', () => {
    saveView('regs', 'REPLAY pending', { event: 'e1', status: 'pending' });
    expect(listViews('regs')).toEqual([{ name: 'REPLAY pending', params: { event: 'e1', status: 'pending' } }]);
  });

  it('overwrites a view with the same name', () => {
    saveView('regs', 'A', { x: '1' });
    saveView('regs', 'A', { x: '2' });
    expect(listViews('regs')).toEqual([{ name: 'A', params: { x: '2' } }]);
  });

  it('deletes a view', () => {
    saveView('regs', 'A', {});
    saveView('regs', 'B', {});
    deleteView('regs', 'A');
    expect(listViews('regs').map((v) => v.name)).toEqual(['B']);
  });

  it('isolates pages', () => {
    saveView('regs', 'A', {});
    saveView('guild', 'A', {});
    expect(listViews('regs')).toHaveLength(1);
    expect(listViews('guild')).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Implement `admin/src/lib/savedViews.ts`**

```ts
export interface SavedView {
  name: string;
  params: Record<string, string>;
}

const KEY = (page: string) => `admin.savedViews.${page}`;

export function listViews(page: string): SavedView[] {
  try { return JSON.parse(localStorage.getItem(KEY(page)) || '[]'); } catch { return []; }
}

export function saveView(page: string, name: string, params: Record<string, string>) {
  const all = listViews(page).filter((v) => v.name !== name);
  all.push({ name, params });
  localStorage.setItem(KEY(page), JSON.stringify(all));
}

export function deleteView(page: string, name: string) {
  const all = listViews(page).filter((v) => v.name !== name);
  localStorage.setItem(KEY(page), JSON.stringify(all));
}

export function getView(page: string, name: string): SavedView | null {
  return listViews(page).find((v) => v.name === name) ?? null;
}
```

- [ ] **Step 3: Run, confirm pass + commit.**

```bash
git add admin/src/lib/savedViews.ts admin/src/lib/savedViews.test.ts
git commit -m "feat(admin): savedViews localStorage helper for per-page filter presets"
```

---

## Task 8: RegistrationsList — selectable + bulk + sortable + saved views + inline status

**Files:**
- Modify: `admin/src/pages/RegistrationsList.tsx`

Build on the Phase 3 desktop branch. Add:
- `selectable` on `DataTable`, controlled `selectedIds` state.
- `BulkActionBar` above the table when ≥1 selected. Actions:
  - **Mark confirmed** — `PATCH /api/admin/registrations/<id>` for each selected, then refresh + clear selection.
  - **Mark cancelled** — same, with `BulkConfirmDialog` confirming.
  - **Export CSV** — call `/api/admin/registrations/export?ids=<csv>`, browser handles download (use `<a download>` trick or `window.location`).
  - **WhatsApp broadcast** — copy comma-separated phones + a default message to clipboard, toast success.
- `sortable: true` + `sortValue` on columns: name, event, total, status, created.
- A "Saved views" dropdown (using `Select` or a small `DropdownMenu`) next to the filters: lists `listViews('registrations')` + a "Save current view…" item that prompts for a name.
- Inline status edit: replace the `<StatusBadge>` cell on desktop with a small `Select` that updates status on change (no drawer open).

- [ ] **Step 1: Read the current file to preserve filter behavior, then merge in the new features.**

- [ ] **Step 2: Add helper `runBulk(action, regs)`** that loops PATCHes, awaits all, refreshes, and shows a toast with the count.

```tsx
async function runBulk(status: Registration['payment_status']) {
  const ids = Array.from(selectedIds);
  await Promise.all(ids.map((id) =>
    fetchAdmin(`/api/admin/registrations/${id}`, { method: 'PATCH', body: JSON.stringify({ payment_status: status }) }),
  ));
  toast.success(`Marked ${ids.length} as ${status}`);
  setSelectedIds([]);
  refresh();
}

function downloadCsv() {
  const ids = Array.from(selectedIds);
  const url = `/api/admin/registrations/export?ids=${encodeURIComponent(ids.join(','))}`;
  window.location.href = url; // browser fetches with Cf-Access JWT cookie
}

async function copyWhatsAppList() {
  const selected = regs.filter((r) => selectedIds.includes(r.id));
  const phones = selected.map((r) => r.phone).join(', ');
  const message = `Hi! This is a reminder from Board Game Company about your upcoming event registration.`;
  await navigator.clipboard?.writeText(`${phones}\n\n${message}`);
  toast.success(`Copied ${selected.length} numbers + message to clipboard`);
}
```

- [ ] **Step 3: Inline status edit on desktop**

Add a small `<Select>` cell for the status column on desktop. Values map 1:1 with payment_status. On change: PATCH and update local state optimistically; revert on error.

```tsx
function inlineStatus(r: Registration) {
  return (
    <Select
      value={r.payment_status}
      onValueChange={async (v) => {
        const prev = r.payment_status;
        setRegs((rows) => rows.map((x) => x.id === r.id ? { ...x, payment_status: v as Registration['payment_status'] } : x));
        try {
          await fetchAdmin(`/api/admin/registrations/${r.id}`, { method: 'PATCH', body: JSON.stringify({ payment_status: v }) });
        } catch (e) {
          setRegs((rows) => rows.map((x) => x.id === r.id ? { ...x, payment_status: prev } : x));
          showApiError(e);
        }
      }}
    >
      <SelectTrigger className="h-7 w-32 text-xs"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="pending">Pending</SelectItem>
        <SelectItem value="confirmed">Confirmed</SelectItem>
        <SelectItem value="cancelled">Cancelled</SelectItem>
      </SelectContent>
    </Select>
  );
}
```

Use `inlineStatus(r)` as the column render on desktop. Mobile cards keep the `StatusBadge`.

- [ ] **Step 4: Sortable columns**

```tsx
const columns: Column<Registration>[] = [
  { key: 'name', header: 'Name', render: (r) => r.name, sortable: true, sortValue: (r) => r.name.toLowerCase() },
  { key: 'phone', header: 'Phone', render: (r) => <PhoneCell phone={r.phone} /> },
  { key: 'event', header: 'Event', render: (r) => eventNameById[r.event_id] || '—', sortable: true, sortValue: (r) => eventNameById[r.event_id] ?? '' },
  { key: 'seats', header: 'Seats', render: (r) => r.seats, sortable: true, sortValue: (r) => r.seats },
  { key: 'total', header: 'Total', render: (r) => `₹${r.total_amount}`, sortable: true, sortValue: (r) => r.total_amount },
  { key: 'status', header: 'Status', render: (r) => inlineStatus(r), sortable: true, sortValue: (r) => r.payment_status },
  { key: 'created', header: 'Created', render: (r) => <RelativeDate iso={r.created_at} />, sortable: true, sortValue: (r) => r.created_at },
];
```

- [ ] **Step 5: Saved views UI**

A small `<DropdownMenu>` next to the filters on desktop. Items: list of saved view names (clicking applies the params), plus "Save this view…" (prompts for a name; uses `prompt()` for simplicity — plain English label) and "Manage…" (no-op or simple `confirm()` to delete). For brevity, use `window.prompt()` and `window.confirm()` here — these admins are non-technical but a simple browser prompt is acceptable for a rarely-used admin power feature.

- [ ] **Step 6: Verify**

```bash
cd admin && npx tsc --noEmit
cd admin && npm test
```

- [ ] **Step 7: Commit**

```bash
git add admin/src/pages/RegistrationsList.tsx
git commit -m "feat(admin): registrations bulk actions, sortable, saved views, inline status edit"
```

---

## Task 9: GuildList — selectable + bulk + sortable + saved views

**Files:**
- Modify: `admin/src/pages/GuildList.tsx`

Same pattern as Task 8, simpler. Bulk actions:
- **Mark paid** — same simple "start date only" dialog as the inline pending verify (Task 8 of Phase 3).
- **Mark cancelled** — with `BulkConfirmDialog`.
- **Export CSV** — `/api/admin/guild-members/export?ids=`.
- **Send renewal reminder** — copy phones + a templated reminder message to clipboard.

Sortable on: name, expiry, tier, status. Saved views with `pageKey: 'guild'`.

- [ ] **Step 1: Implement following Task 8's approach.** Reuse the same start-date dialog from Phase 3 Task 8 to confirm the bulk Mark Paid (single shared start date applied to all selected, expiry calculated per row using each member's tier).

- [ ] **Step 2: Verify + commit**

```bash
cd admin && npx tsc --noEmit
cd admin && npm test
git add admin/src/pages/GuildList.tsx
git commit -m "feat(admin): guild bulk actions, sortable, saved views"
```

---

## Task 10: GamesList — selectable + bulk + sortable + inline "Currently with"

**Files:**
- Modify: `admin/src/pages/GamesList.tsx`

Bulk actions:
- **Update "Currently with"** — opens a small dialog with one input; applies to all selected games. Common case: someone returns 5 games at once.
- **Export CSV** — `/api/admin/games/export?ids=`.

Sortable on: title, currently_with.

Inline edit on desktop: clicking the "Currently with" cell turns it into an `<Input>`. Commits on blur or Enter, cancels on Escape.

- [ ] **Step 1: Implement.** Inline edit cell:

```tsx
function CurrentlyWithCell({ game, onChange }: { game: Game; onChange: (next: string | null) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(game.currently_with || '');
  if (!editing) {
    return (
      <button className="text-left hover:underline" onClick={(e) => { e.stopPropagation(); setEditing(true); setValue(game.currently_with || ''); }}>
        {game.currently_with || '—'}
      </button>
    );
  }
  function commit() {
    setEditing(false);
    if ((value || null) !== (game.currently_with || null)) onChange(value || null);
  }
  return (
    <Input
      autoFocus
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        else if (e.key === 'Escape') { setEditing(false); setValue(game.currently_with || ''); }
      }}
      onClick={(e) => e.stopPropagation()}
      className="h-7 text-xs"
    />
  );
}
```

The `onChange` handler PATCHes `/api/admin/games/<id>` and updates local state. Same optimistic-update / rollback pattern as Task 8.

- [ ] **Step 2: Verify + commit**

```bash
cd admin && npx tsc --noEmit
cd admin && npm test
git add admin/src/pages/GamesList.tsx
git commit -m "feat(admin): games bulk update, sortable, inline currently-with edit"
```

---

## Task 11: EventsList — sortable on date / capacity

**Files:**
- Modify: `admin/src/pages/EventsList.tsx`

No bulk actions on events (events aren't typically batched). Just enable sortable on `date` and `capacity`.

- [ ] **Step 1: Add `sortable: true` + `sortValue` on those columns.**

```tsx
{ key: 'date', header: 'Date', render: (e) => <RelativeDate iso={e.date} />, sortable: true, sortValue: (e) => e.date },
{ key: 'capacity', header: 'Capacity', render: (e) => e.capacity, sortable: true, sortValue: (e) => e.capacity },
```

- [ ] **Step 2: Verify + commit**

```bash
cd admin && npx tsc --noEmit
cd admin && npm test
git add admin/src/pages/EventsList.tsx
git commit -m "feat(admin): events sortable by date and capacity"
```

---

## Task 12: Manual end-to-end verification

- [ ] **Step 1: Deploy worker** with three new export endpoints

```bash
cd worker && npx wrangler deploy
```

- [ ] **Step 2: Smoke at desktop (1280px):**
  - Registrations: select 3 rows → BulkActionBar appears. "Export CSV" downloads a `registrations-YYYY-MM-DD.csv` with custom-question columns. "Mark cancelled" prompts confirmation; confirming updates the rows. Inline status pill changes work.
  - Click a sortable column header → ascending sort with arrow indicator. Click again → descending. Click a third time → cleared.
  - "Save this view…" with current filters → re-open dropdown shows the saved view → selecting reapplies the filters.
  - Guild list: same pattern. Bulk "Mark paid" prompts a single start date.
  - Games list: bulk "Update 'Currently with'" applies to all selected. Click an individual cell to inline-edit.
  - Events: sort by date or capacity.

- [ ] **Step 3: Smoke at phone (375px):**
  - All Phase 3 mobile behaviors still work. Bulk action UI is `hidden md:` so it doesn't show on phones.

- [ ] **Step 4: Capture screenshots** to `docs/superpowers/screenshots/2026-05-02-phase-4-after/` and commit.

---

## Self-review summary

**Spec coverage check (Phase 4 requirements vs. tasks):**
- Multi-select on Registrations / Guild / Games — Tasks 8, 9, 10.
- BulkActionBar — Task 5; consumed by Tasks 8, 9, 10.
- Per-page bulk actions:
  - Registrations: Mark confirmed / pending / cancelled, Export CSV, WhatsApp broadcast — Task 8.
  - Guild: Mark paid / cancelled, Export CSV, renewal reminder — Task 9.
  - Games: Bulk update "Currently with", Export CSV — Task 10.
- BulkConfirmDialog with count + sample names — Task 6; consumed by Tasks 8, 9.
- CSV export endpoints — Tasks 1, 2, 3, 4.
- Sortable columns:
  - Registrations: date, event, status, total, name — Task 8.
  - Guild: expiry, tier, status, name — Task 9.
  - Games: title, currently_with — Task 10.
  - Events: date, capacity — Task 11.
- Saved filter views — Task 7; consumed by Tasks 8, 9.
- Inline edit:
  - Registrations status pill — Task 8.
  - Games "Currently with" — Task 10.
- Undo toast for non-destructive bulk changes — *deferred*: implementer should add a simple `toast.success` with no undo affordance. Building proper undo (reversing N PATCHes) doubles task complexity; if needed later, add it incrementally.

**Type consistency:**
- `BulkAction` from Task 5 consumed by all three list pages.
- `SavedView` from Task 7 consumed by RegistrationsList + GuildList.
- Worker CSV export endpoints accept the same `ids` query param shape; admin-side download links share the encoding.

**Out of scope:**
- Undo for bulk operations.
- Server-side pagination (lists are small enough — under 500 rows on each list).
- Custom report builder.
- Scheduled email exports.

**Prerequisite reminder:** Phases 1, 2, and 3 must be merged. The DataTable's `selectable`, `sortable`, and `dense` capabilities (Phase 1) and the new mobile card layouts (Phase 3) are all consumed here.
