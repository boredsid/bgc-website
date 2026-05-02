# Admin UX Improvements — Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every admin form pleasant to fill in. Add a `FormDrawer` wrapper (mobile-bottom-sheet, sticky footer, error banner), pure-function validation with plain-English messages, ergonomic inputs (empty-when-empty number, custom date+time picker, styled discard modal), smart defaults (clone latest event, venue type-ahead, manual-reg phone-first remembers last event), and a live preview tab in the custom-questions editor.

**Architecture:** Five new primitives under `admin/src/components/`, one validation library under `admin/src/lib/`, one custom-question renderer under `admin/src/lib/`, and migrations of all six existing drawers (`EventDrawer`, `GameDrawer`, `GuildDrawer`, `RegistrationDrawer`, `ManualRegistrationDrawer`, `UserDrawer`) to consume them. No worker changes, no DB changes.

**Tech Stack:** React 19, Tailwind 4, shadcn/ui (existing `Sheet`, `Dialog`, `Input`, `Select`, `Button`, `Checkbox`), Vitest + Testing Library. Builds on Phase 1 primitives (`StatusBadge`, `RelativeDate`, `PhoneCell`, `DataTable`, `MobileCardList`, `BottomTabBar`).

**Spec reference:** `docs/superpowers/specs/2026-05-02-admin-ux-improvements-design.md` — Phase 2 section.

**Deviation from spec — `renderCustomQuestions.tsx` is admin-local, not shared:** The spec calls for a shared library between admin and the public site. The two apps are separate Vite builds with separate `node_modules`; sharing requires monorepo workspaces, which is out of scope for this phase. Pragmatic choice: admin gets its own copy that visually mirrors the public site via inline styles, so admins see a faithful preview without coupling the codebases. The public site's `src/components/CustomQuestion.tsx` is left untouched.

---

## File Structure

**New files (all under `admin/src/`):**
- `lib/validation.ts` + `lib/validation.test.ts` — pure validators per entity
- `lib/renderCustomQuestions.tsx` + test — admin-local renderer mirroring public form visuals
- `components/NumberInput.tsx` + test
- `components/DateTimePicker.tsx` + test
- `components/DiscardGuardModal.tsx` + test
- `components/FormDrawer.tsx` + test
- `components/CustomQuestionPreview.tsx` (consumes renderCustomQuestions in editor preview tab)

**Modified files:**
- `admin/src/components/CustomQuestionsEditor.tsx` — add Edit/Preview tabs.
- `admin/src/pages/EventDrawer.tsx` — adopt FormDrawer + validation + smart defaults from latest event.
- `admin/src/pages/GameDrawer.tsx` — adopt FormDrawer + validation.
- `admin/src/pages/GuildDrawer.tsx` — adopt FormDrawer + validation.
- `admin/src/pages/RegistrationDrawer.tsx` — adopt FormDrawer + validation.
- `admin/src/pages/ManualRegistrationDrawer.tsx` — adopt FormDrawer + validation + remember last event in localStorage.
- `admin/src/pages/UserDrawer.tsx` — adopt FormDrawer + validation.

---

## Conventions

- All commands assume CWD `/Users/siddhantnarula/Projects/bgc-website` unless a `cd` is shown.
- Tests run with `cd admin && npm test -- <pattern>`.
- Each task ends with `git add <files>` + `git commit`. Commit messages follow `feat(admin):` / `refactor(admin):`.
- Each drawer migration must keep its existing API behavior intact (route, save endpoint, dirty-check semantics) — only the surrounding wrapper, layout, and validation change.

---

## Task 1: Validation library

**Files:**
- Create: `admin/src/lib/validation.ts`
- Test: `admin/src/lib/validation.test.ts`

- [ ] **Step 1: Write the failing test**

Create `admin/src/lib/validation.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  validateEvent, validateGame, validateGuildMember,
  validateRegistration, validateUser, validateManualRegistration,
  parseRupees, parsePhone, type ValidationErrors,
} from './validation';

describe('parsePhone', () => {
  it('strips non-digits and a leading 91', () => {
    expect(parsePhone('+91 98765 43210')).toBe('9876543210');
    expect(parsePhone('919876543210')).toBe('9876543210');
    expect(parsePhone('98765-43210')).toBe('9876543210');
  });
  it('returns the digits as-is when no leading 91 and not 12 digits', () => {
    expect(parsePhone('9876543210')).toBe('9876543210');
    expect(parsePhone('123')).toBe('123');
  });
});

describe('parseRupees', () => {
  it('strips ₹ and whitespace', () => {
    expect(parseRupees('₹100')).toBe(100);
    expect(parseRupees('  ₹ 1,500 ')).toBe(1500);
    expect(parseRupees('250')).toBe(250);
  });
  it('returns null for empty / invalid input', () => {
    expect(parseRupees('')).toBeNull();
    expect(parseRupees('abc')).toBeNull();
  });
});

describe('validateEvent', () => {
  const valid = {
    name: 'Game night', date: '2026-09-01T19:00:00.000Z',
    capacity: 30, price: 200, venue_name: 'BGC HQ',
  };
  it('returns no errors for a valid event', () => {
    expect(Object.keys(validateEvent(valid))).toHaveLength(0);
  });
  it('requires a name', () => {
    expect(validateEvent({ ...valid, name: '   ' }).name).toBe('Please enter a name.');
  });
  it('requires capacity ≥ 1', () => {
    expect(validateEvent({ ...valid, capacity: 0 }).capacity).toBe('Capacity must be at least 1.');
  });
  it('rejects negative price', () => {
    expect(validateEvent({ ...valid, price: -1 }).price).toBe('Price cannot be negative.');
  });
  it('requires a date', () => {
    expect(validateEvent({ ...valid, date: '' }).date).toBe('Please pick a date and time.');
  });
});

describe('validateGame', () => {
  it('requires a title', () => {
    expect(validateGame({ title: '' }).title).toBe('Please enter a title.');
    expect(validateGame({ title: 'Catan' }).title).toBeUndefined();
  });
});

describe('validateGuildMember', () => {
  const valid = { tier: 'initiate', amount: 500, status: 'paid', starts_at: '2026-05-01', expires_at: '2026-08-01', plus_ones_used: 0 };
  it('returns no errors for valid input', () => {
    expect(Object.keys(validateGuildMember(valid))).toHaveLength(0);
  });
  it('flags expires_at before starts_at', () => {
    const errs = validateGuildMember({ ...valid, expires_at: '2026-04-01' });
    expect(errs.expires_at).toBe('Expiry must be after the start date.');
  });
  it('rejects negative plus_ones_used', () => {
    expect(validateGuildMember({ ...valid, plus_ones_used: -1 }).plus_ones_used).toBe('Plus-ones used cannot be negative.');
  });
});

describe('validateRegistration', () => {
  const valid = { name: 'A', phone: '9876543210', email: '', seats: 1, total_amount: 100, payment_status: 'pending' as const };
  it('valid for minimal input', () => {
    expect(Object.keys(validateRegistration(valid))).toHaveLength(0);
  });
  it('requires a name', () => {
    expect(validateRegistration({ ...valid, name: '' }).name).toBe('Please enter a name.');
  });
  it('requires a 10-digit phone', () => {
    expect(validateRegistration({ ...valid, phone: '1234' }).phone).toBe('Phone must be 10 digits.');
  });
  it('requires seats ≥ 1', () => {
    expect(validateRegistration({ ...valid, seats: 0 }).seats).toBe('Seats must be at least 1.');
  });
  it('rejects malformed email when provided', () => {
    expect(validateRegistration({ ...valid, email: 'not-an-email' }).email).toBe('Please enter a valid email.');
  });
});

describe('validateManualRegistration', () => {
  it('requires an event_id', () => {
    const errs = validateManualRegistration({ event_id: '', name: 'A', phone: '9876543210', email: '', seats: 1 });
    expect(errs.event_id).toBe('Please pick an event.');
  });
});

describe('validateUser', () => {
  it('requires a 10-digit phone', () => {
    expect(validateUser({ name: 'A', phone: '1', email: null }).phone).toBe('Phone must be 10 digits.');
  });
  it('rejects malformed email', () => {
    expect(validateUser({ name: 'A', phone: '9876543210', email: 'x' }).email).toBe('Please enter a valid email.');
  });
});

describe('ValidationErrors type compiles', () => {
  it('keys to optional strings', () => {
    const errs: ValidationErrors = { name: 'Bad' };
    expect(errs.name).toBe('Bad');
  });
});
```

- [ ] **Step 2: Run test, confirm fail**

```bash
cd admin && npm test -- validation.test
```

Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement `admin/src/lib/validation.ts`**

```ts
export type ValidationErrors = Record<string, string | undefined>;

const PHONE_REGEX = /^\d{10}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parsePhone(input: string): string {
  const digits = (input || '').replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  return digits;
}

export function parseRupees(input: string): number | null {
  if (typeof input !== 'string') return null;
  const cleaned = input.replace(/[₹,\s]/g, '');
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

interface EventInput {
  name?: string | null;
  date?: string | null;
  capacity?: number | null;
  price?: number | null;
  venue_name?: string | null;
}

export function validateEvent(e: EventInput): ValidationErrors {
  const errs: ValidationErrors = {};
  if (!e.name || !e.name.trim()) errs.name = 'Please enter a name.';
  if (!e.date) errs.date = 'Please pick a date and time.';
  if (e.capacity == null || e.capacity < 1) errs.capacity = 'Capacity must be at least 1.';
  if (e.price != null && e.price < 0) errs.price = 'Price cannot be negative.';
  return errs;
}

interface GameInput { title?: string | null }
export function validateGame(g: GameInput): ValidationErrors {
  const errs: ValidationErrors = {};
  if (!g.title || !g.title.trim()) errs.title = 'Please enter a title.';
  return errs;
}

interface GuildMemberInput {
  tier?: string;
  amount?: number;
  status?: string;
  starts_at?: string;
  expires_at?: string;
  plus_ones_used?: number;
}
export function validateGuildMember(m: GuildMemberInput): ValidationErrors {
  const errs: ValidationErrors = {};
  if (!m.tier) errs.tier = 'Please pick a tier.';
  if (!m.status) errs.status = 'Please pick a status.';
  if (!m.starts_at) errs.starts_at = 'Please pick a start date.';
  if (!m.expires_at) errs.expires_at = 'Please pick an expiry date.';
  if (m.starts_at && m.expires_at && m.expires_at < m.starts_at) {
    errs.expires_at = 'Expiry must be after the start date.';
  }
  if (m.amount != null && m.amount < 0) errs.amount = 'Amount cannot be negative.';
  if (m.plus_ones_used != null && m.plus_ones_used < 0) errs.plus_ones_used = 'Plus-ones used cannot be negative.';
  return errs;
}

interface RegistrationInput {
  name?: string;
  phone?: string;
  email?: string | null;
  seats?: number;
  total_amount?: number;
  payment_status?: 'pending' | 'confirmed' | 'cancelled';
}
export function validateRegistration(r: RegistrationInput): ValidationErrors {
  const errs: ValidationErrors = {};
  if (!r.name || !r.name.trim()) errs.name = 'Please enter a name.';
  const phoneDigits = parsePhone(r.phone || '');
  if (!PHONE_REGEX.test(phoneDigits)) errs.phone = 'Phone must be 10 digits.';
  if (r.email && !EMAIL_REGEX.test(r.email)) errs.email = 'Please enter a valid email.';
  if (r.seats == null || r.seats < 1) errs.seats = 'Seats must be at least 1.';
  if (r.total_amount != null && r.total_amount < 0) errs.total_amount = 'Total cannot be negative.';
  return errs;
}

interface ManualRegistrationInput extends RegistrationInput { event_id?: string }
export function validateManualRegistration(r: ManualRegistrationInput): ValidationErrors {
  const errs = validateRegistration(r);
  if (!r.event_id) errs.event_id = 'Please pick an event.';
  return errs;
}

interface UserInput { name?: string | null; phone?: string; email?: string | null }
export function validateUser(u: UserInput): ValidationErrors {
  const errs: ValidationErrors = {};
  const phoneDigits = parsePhone(u.phone || '');
  if (!PHONE_REGEX.test(phoneDigits)) errs.phone = 'Phone must be 10 digits.';
  if (u.email && !EMAIL_REGEX.test(u.email)) errs.email = 'Please enter a valid email.';
  return errs;
}
```

- [ ] **Step 4: Run test, confirm pass**

```bash
cd admin && npm test -- validation.test
```

Expected: PASS (15+ assertions across validators).

- [ ] **Step 5: Commit**

```bash
git add admin/src/lib/validation.ts admin/src/lib/validation.test.ts
git commit -m "feat(admin): add per-entity validation with plain-English messages"
```

---

## Task 2: NumberInput primitive

**Files:**
- Create: `admin/src/components/NumberInput.tsx`
- Test: `admin/src/components/NumberInput.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NumberInput } from './NumberInput';

describe('NumberInput', () => {
  it('renders empty when value is null', () => {
    render(<NumberInput value={null} onChange={() => {}} aria-label="amount" />);
    expect((screen.getByLabelText('amount') as HTMLInputElement).value).toBe('');
  });

  it('renders 0 only when value is the number 0', () => {
    render(<NumberInput value={0} onChange={() => {}} aria-label="amount" />);
    expect((screen.getByLabelText('amount') as HTMLInputElement).value).toBe('0');
  });

  it('emits null when user clears the field', () => {
    const onChange = vi.fn();
    render(<NumberInput value={10} onChange={onChange} aria-label="amount" />);
    fireEvent.change(screen.getByLabelText('amount'), { target: { value: '' } });
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it('emits a number when user types digits', () => {
    const onChange = vi.fn();
    render(<NumberInput value={null} onChange={onChange} aria-label="amount" />);
    fireEvent.change(screen.getByLabelText('amount'), { target: { value: '42' } });
    expect(onChange).toHaveBeenLastCalledWith(42);
  });

  it('strips ₹ and commas via the rupees parser when allowRupees is true', () => {
    const onChange = vi.fn();
    render(<NumberInput value={null} onChange={onChange} allowRupees aria-label="amount" />);
    fireEvent.change(screen.getByLabelText('amount'), { target: { value: '₹1,500' } });
    expect(onChange).toHaveBeenLastCalledWith(1500);
  });
});
```

- [ ] **Step 2: Run test, confirm fail**

```bash
cd admin && npm test -- NumberInput.test
```

- [ ] **Step 3: Implement `admin/src/components/NumberInput.tsx`**

```tsx
import { Input } from '@/components/ui/input';
import { parseRupees } from '@/lib/validation';

interface Props extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value' | 'type'> {
  value: number | null;
  onChange: (next: number | null) => void;
  allowRupees?: boolean;
  min?: number;
}

export function NumberInput({ value, onChange, allowRupees, ...rest }: Props) {
  const display = value == null ? '' : String(value);
  return (
    <Input
      type={allowRupees ? 'text' : 'number'}
      inputMode="decimal"
      value={display}
      onChange={(e) => {
        const raw = e.target.value;
        if (raw === '') return onChange(null);
        if (allowRupees) {
          const n = parseRupees(raw);
          if (n != null) onChange(n);
          return;
        }
        const n = Number(raw);
        if (Number.isFinite(n)) onChange(n);
      }}
      {...rest}
    />
  );
}
```

- [ ] **Step 4: Run test, confirm pass (5/5)**

- [ ] **Step 5: Commit**

```bash
git add admin/src/components/NumberInput.tsx admin/src/components/NumberInput.test.tsx
git commit -m "feat(admin): NumberInput shows empty when empty, accepts rupee strings"
```

---

## Task 3: DateTimePicker primitive

**Files:**
- Create: `admin/src/components/DateTimePicker.tsx`
- Test: `admin/src/components/DateTimePicker.test.tsx`

Native `<input type="datetime-local">` is awkward in iOS PWAs. This primitive splits date and time into two controls (date input + time `<select>` with 30-minute increments) and emits a single ISO string.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DateTimePicker } from './DateTimePicker';

describe('DateTimePicker', () => {
  it('renders the date and time portions of an ISO value (IST)', () => {
    render(<DateTimePicker value="2026-09-01T19:30:00+05:30" onChange={() => {}} />);
    expect((screen.getByLabelText(/date/i) as HTMLInputElement).value).toBe('2026-09-01');
    expect((screen.getByLabelText(/time/i) as HTMLSelectElement).value).toBe('19:30');
  });

  it('emits a new ISO string when the date changes', () => {
    const onChange = vi.fn();
    render(<DateTimePicker value="2026-09-01T19:30:00+05:30" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/date/i), { target: { value: '2026-09-02' } });
    expect(onChange).toHaveBeenCalled();
    const last = onChange.mock.calls.at(-1)?.[0] as string;
    expect(last.startsWith('2026-09-02T19:30')).toBe(true);
  });

  it('emits a new ISO string when the time changes', () => {
    const onChange = vi.fn();
    render(<DateTimePicker value="2026-09-01T19:30:00+05:30" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/time/i), { target: { value: '20:00' } });
    const last = onChange.mock.calls.at(-1)?.[0] as string;
    expect(last.startsWith('2026-09-01T20:00')).toBe(true);
  });

  it('renders empty selectors when value is empty', () => {
    render(<DateTimePicker value="" onChange={() => {}} />);
    expect((screen.getByLabelText(/date/i) as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText(/time/i) as HTMLSelectElement).value).toBe('');
  });

  it('offers 30-minute increments from 00:00 to 23:30', () => {
    render(<DateTimePicker value="" onChange={() => {}} />);
    const select = screen.getByLabelText(/time/i) as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => o.value);
    expect(options).toContain('00:00');
    expect(options).toContain('19:30');
    expect(options).toContain('23:30');
    expect(options).not.toContain('19:15');
    // 48 half-hours plus the empty placeholder.
    expect(options.length).toBe(49);
  });
});
```

- [ ] **Step 2: Run, confirm fail**

```bash
cd admin && npm test -- DateTimePicker.test
```

- [ ] **Step 3: Implement `admin/src/components/DateTimePicker.tsx`**

```tsx
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface Props {
  value: string; // ISO 8601 or '' for empty
  onChange: (iso: string) => void;
  className?: string;
}

const TIMES: string[] = (() => {
  const out: string[] = [];
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 30) {
      out.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    }
  }
  return out;
})();

function splitIso(iso: string): { date: string; time: string } {
  if (!iso) return { date: '', time: '' };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { date: '', time: '' };
  const pad = (n: number) => String(n).padStart(2, '0');
  // Local time (matches the device timezone — admin is in IST in practice).
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

function combine(date: string, time: string): string {
  if (!date) return '';
  const [h, m] = (time || '00:00').split(':').map(Number);
  const [y, mo, d] = date.split('-').map(Number);
  const local = new Date(y, mo - 1, d, h, m);
  return local.toISOString();
}

export function DateTimePicker({ value, onChange, className }: Props) {
  const { date, time } = splitIso(value);
  return (
    <div className={`grid grid-cols-2 gap-2 ${className || ''}`}>
      <div>
        <Label htmlFor="dtp-date">Date</Label>
        <Input
          id="dtp-date"
          type="date"
          value={date}
          onChange={(e) => onChange(combine(e.target.value, time || '00:00'))}
        />
      </div>
      <div>
        <Label htmlFor="dtp-time">Time</Label>
        <select
          id="dtp-time"
          value={time}
          onChange={(e) => onChange(combine(date, e.target.value))}
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm md:text-sm"
        >
          <option value="">—</option>
          {TIMES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run, confirm pass (5/5)**

- [ ] **Step 5: Commit**

```bash
git add admin/src/components/DateTimePicker.tsx admin/src/components/DateTimePicker.test.tsx
git commit -m "feat(admin): DateTimePicker with 30-minute increments"
```

---

## Task 4: DiscardGuardModal primitive

**Files:**
- Create: `admin/src/components/DiscardGuardModal.tsx`
- Test: `admin/src/components/DiscardGuardModal.test.tsx`

Replaces the native `confirm('Discard changes?')` dialog (which looks broken in PWA standalone) with a styled modal.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DiscardGuardModal } from './DiscardGuardModal';

describe('DiscardGuardModal', () => {
  it('renders nothing when not open', () => {
    render(<DiscardGuardModal open={false} onCancel={() => {}} onDiscard={() => {}} />);
    expect(screen.queryByText(/discard/i)).toBeNull();
  });

  it('shows the prompt when open', () => {
    render(<DiscardGuardModal open onCancel={() => {}} onDiscard={() => {}} />);
    expect(screen.getByText(/discard your changes/i)).toBeInTheDocument();
  });

  it('calls onCancel when the cancel button is clicked', () => {
    const onCancel = vi.fn();
    render(<DiscardGuardModal open onCancel={onCancel} onDiscard={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /keep editing/i }));
    expect(onCancel).toHaveBeenCalled();
  });

  it('calls onDiscard when the discard button is clicked', () => {
    const onDiscard = vi.fn();
    render(<DiscardGuardModal open onCancel={() => {}} onDiscard={onDiscard} />);
    fireEvent.click(screen.getByRole('button', { name: /discard/i }));
    expect(onDiscard).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run, confirm fail**

- [ ] **Step 3: Implement `admin/src/components/DiscardGuardModal.tsx`**

```tsx
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface Props {
  open: boolean;
  onCancel: () => void;
  onDiscard: () => void;
}

export function DiscardGuardModal({ open, onCancel, onDiscard }: Props) {
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Discard your changes?</DialogTitle>
          <DialogDescription>
            You'll lose anything you've typed but haven't saved.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>Keep editing</Button>
          <Button variant="destructive" onClick={onDiscard}>Discard</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

If `dialog.tsx` doesn't already export `DialogDescription`, fall back to using a regular `<p>` inside the header. Verify by reading `admin/src/components/ui/dialog.tsx` first.

- [ ] **Step 4: Run, confirm pass (4/4)**

- [ ] **Step 5: Commit**

```bash
git add admin/src/components/DiscardGuardModal.tsx admin/src/components/DiscardGuardModal.test.tsx
git commit -m "feat(admin): styled DiscardGuardModal replaces native confirm()"
```

---

## Task 5: FormDrawer wrapper

**Files:**
- Create: `admin/src/components/FormDrawer.tsx`
- Test: `admin/src/components/FormDrawer.test.tsx`

Wraps shadcn's `Sheet` with: bottom-up sheet on mobile (`< md`), right-side sheet on desktop, sticky footer with Cancel/Save, optional top-of-sheet error banner, and integrated `DiscardGuardModal`.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FormDrawer } from './FormDrawer';

describe('FormDrawer', () => {
  it('renders title, body, and footer Cancel/Save', () => {
    render(
      <FormDrawer
        open
        title="New thing"
        dirty={false}
        onCancel={() => {}}
        onSave={() => {}}
        saving={false}
      >
        <div data-testid="body">body</div>
      </FormDrawer>,
    );
    expect(screen.getByText('New thing')).toBeInTheDocument();
    expect(screen.getByTestId('body')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
  });

  it('shows the issue count on Save when errors present', () => {
    render(
      <FormDrawer
        open title="x" dirty onCancel={() => {}} onSave={() => {}} saving={false}
        errorCount={2}
      >
        <div />
      </FormDrawer>,
    );
    expect(screen.getByRole('button', { name: /save \(2 issues\)/i })).toBeInTheDocument();
  });

  it('shows top-of-sheet error banner when errorMessage is provided', () => {
    render(
      <FormDrawer
        open title="x" dirty={false} onCancel={() => {}} onSave={() => {}} saving={false}
        errorMessage="Server said no"
      >
        <div />
      </FormDrawer>,
    );
    expect(screen.getByText('Server said no')).toBeInTheDocument();
  });

  it('asks before discarding when dirty', () => {
    const onCancel = vi.fn();
    render(
      <FormDrawer
        open title="x" dirty onCancel={onCancel} onSave={() => {}} saving={false}
      >
        <div />
      </FormDrawer>,
    );
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    // The discard guard modal should appear now.
    expect(screen.getByText(/discard your changes/i)).toBeInTheDocument();
    // Clicking "Discard" should call onCancel.
    fireEvent.click(screen.getByRole('button', { name: /^discard$/i }));
    expect(onCancel).toHaveBeenCalled();
  });

  it('skips the discard guard when not dirty', () => {
    const onCancel = vi.fn();
    render(
      <FormDrawer
        open title="x" dirty={false} onCancel={onCancel} onSave={() => {}} saving={false}
      >
        <div />
      </FormDrawer>,
    );
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run, confirm fail**

- [ ] **Step 3: Implement `admin/src/components/FormDrawer.tsx`**

```tsx
import { useState, type ReactNode } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { AlertCircle } from 'lucide-react';
import { DiscardGuardModal } from './DiscardGuardModal';

interface Props {
  open: boolean;
  title: string;
  children: ReactNode;
  dirty: boolean;
  saving: boolean;
  onCancel: () => void;
  onSave: () => void;
  errorCount?: number;
  errorMessage?: string | null;
}

export function FormDrawer({
  open, title, children, dirty, saving, onCancel, onSave, errorCount, errorMessage,
}: Props) {
  const [askDiscard, setAskDiscard] = useState(false);

  function attemptCancel() {
    if (dirty) setAskDiscard(true);
    else onCancel();
  }

  const saveLabel = saving
    ? 'Saving…'
    : errorCount && errorCount > 0
      ? `Save (${errorCount} issue${errorCount === 1 ? '' : 's'})`
      : 'Save';

  return (
    <>
      <Sheet open={open} onOpenChange={(o) => { if (!o) attemptCancel(); }}>
        <SheetContent
          side="bottom"
          className="md:!right-0 md:!left-auto md:!top-0 md:!bottom-0 md:!w-full md:!max-w-2xl md:!h-full max-h-[92vh] md:max-h-none rounded-t-xl md:rounded-none flex flex-col p-0"
        >
          <SheetHeader className="px-4 pt-4 md:px-6 md:pt-6 pb-2 border-b">
            <SheetTitle>{title}</SheetTitle>
          </SheetHeader>

          {errorMessage && (
            <div className="mx-4 md:mx-6 mt-3 rounded-md bg-status-cancelled text-status-cancelled-foreground p-3 text-sm flex items-start gap-2">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <div>{errorMessage}</div>
            </div>
          )}

          <div className="flex-1 overflow-y-auto px-4 md:px-6 py-4 space-y-4">
            {children}
          </div>

          <div
            className="border-t bg-background px-4 md:px-6 py-3 flex justify-end gap-2"
            style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}
          >
            <Button variant="ghost" onClick={attemptCancel} disabled={saving}>Cancel</Button>
            <Button onClick={onSave} disabled={saving}>{saveLabel}</Button>
          </div>
        </SheetContent>
      </Sheet>

      <DiscardGuardModal
        open={askDiscard}
        onCancel={() => setAskDiscard(false)}
        onDiscard={() => { setAskDiscard(false); onCancel(); }}
      />
    </>
  );
}
```

- [ ] **Step 4: Run, confirm pass (5/5)**

- [ ] **Step 5: Commit**

```bash
git add admin/src/components/FormDrawer.tsx admin/src/components/FormDrawer.test.tsx
git commit -m "feat(admin): FormDrawer wrapper (mobile bottom sheet, sticky footer, discard guard)"
```

---

## Task 6: Admin-local custom-question renderer

**Files:**
- Create: `admin/src/lib/renderCustomQuestions.tsx`
- Test: `admin/src/lib/renderCustomQuestions.test.tsx`

Visually mirrors the public site's `src/components/CustomQuestion.tsx` (neo-brutalist look — 2px black border, hard-edged buttons, cream background) but is implemented standalone in admin with inline styles, so the public site's `global.css` is not needed.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { renderCustomQuestion } from './renderCustomQuestions';
import type { CustomQuestion } from './types';

describe('renderCustomQuestion', () => {
  it('renders a text question with required marker', () => {
    const q: CustomQuestion = { id: 'note', label: 'Note', type: 'text', required: true };
    render(<>{renderCustomQuestion({ question: q, value: '', onChange: () => {} })}</>);
    expect(screen.getByText('Note')).toBeInTheDocument();
    expect(screen.getByText('*')).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('emits a string value on text change', () => {
    const q: CustomQuestion = { id: 'note', label: 'Note', type: 'text', required: false };
    const onChange = vi.fn();
    render(<>{renderCustomQuestion({ question: q, value: '', onChange })}</>);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'hello' } });
    expect(onChange).toHaveBeenCalledWith('hello');
  });

  it('renders select with placeholder + options', () => {
    const q: CustomQuestion = {
      id: 'meal', label: 'Meal', type: 'select', required: false,
      options: [{ value: 'Veg' }, { value: 'NonVeg' }],
    };
    render(<>{renderCustomQuestion({ question: q, value: '', onChange: () => {} })}</>);
    expect(screen.getByText('Veg')).toBeInTheDocument();
    expect(screen.getByText('NonVeg')).toBeInTheDocument();
  });

  it('renders radio options as clickable buttons', () => {
    const q: CustomQuestion = {
      id: 'meal', label: 'Meal', type: 'radio', required: false,
      options: [{ value: 'Veg' }, { value: 'NonVeg' }],
    };
    const onChange = vi.fn();
    render(<>{renderCustomQuestion({ question: q, value: '', onChange })}</>);
    fireEvent.click(screen.getByRole('button', { name: /^Veg$/i }));
    expect(onChange).toHaveBeenCalledWith('Veg');
  });

  it('renders checkbox toggle', () => {
    const q: CustomQuestion = { id: 'pizza', label: 'Pizza?', type: 'checkbox', required: false };
    const onChange = vi.fn();
    render(<>{renderCustomQuestion({ question: q, value: false, onChange })}</>);
    fireEvent.click(screen.getByRole('button'));
    expect(onChange).toHaveBeenCalledWith(true);
  });
});
```

- [ ] **Step 2: Run, confirm fail**

- [ ] **Step 3: Implement `admin/src/lib/renderCustomQuestions.tsx`**

```tsx
import type { CustomQuestion } from './types';

interface Args {
  question: CustomQuestion;
  value: string | boolean;
  onChange: (value: string | boolean) => void;
  optionCounts?: Record<string, number>;
}

const COLORS = {
  border: '2px solid #1A1A1A',
  text: '#1A1A1A',
  bgWhite: '#FFFFFF',
  bgBlack: '#1A1A1A',
  textInverse: '#FFFFFF',
  required: '#FF6B6B',
  cream: '#FFF8E7',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontFamily: 'Space Grotesk, system-ui, sans-serif',
  fontWeight: 700,
  fontSize: '0.875rem',
  marginBottom: 6,
  color: COLORS.text,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  border: COLORS.border,
  borderRadius: 8,
  padding: '0.5rem 0.75rem',
  background: COLORS.bgWhite,
  color: COLORS.text,
  fontFamily: 'Inter, system-ui, sans-serif',
};

const buttonBase: React.CSSProperties = {
  border: COLORS.border,
  borderRadius: 8,
  padding: '0.625rem 0.875rem',
  fontFamily: 'Space Grotesk, system-ui, sans-serif',
  fontWeight: 600,
  textAlign: 'left',
  width: '100%',
  cursor: 'pointer',
};

export function renderCustomQuestion({ question, value, onChange, optionCounts }: Args) {
  const { id, label, type, required, options } = question;
  const isFull = (optValue: string, capacity?: number) =>
    capacity !== undefined && optionCounts && (optionCounts[optValue] || 0) >= capacity;

  return (
    <div key={id} style={{ marginBottom: '1.25rem' }}>
      <label htmlFor={`cq-${id}`} style={labelStyle}>
        {label} {required && <span style={{ color: COLORS.required }}>*</span>}
      </label>

      {type === 'text' && (
        <input
          id={`cq-${id}`}
          type="text"
          value={(value as string) || ''}
          onChange={(e) => onChange(e.target.value)}
          style={inputStyle}
          required={required}
        />
      )}

      {type === 'select' && options && (
        <select
          id={`cq-${id}`}
          value={(value as string) || ''}
          onChange={(e) => onChange(e.target.value)}
          style={{ ...inputStyle, fontFamily: 'Space Grotesk, system-ui, sans-serif', fontWeight: 600 }}
          required={required}
        >
          <option value="">Select…</option>
          {options.map((opt) => {
            const full = isFull(opt.value, opt.capacity);
            return (
              <option key={opt.value} value={opt.value} disabled={full}>
                {opt.value}{full ? ' (Full)' : ''}
              </option>
            );
          })}
        </select>
      )}

      {type === 'radio' && options && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {options.map((opt) => {
            const full = isFull(opt.value, opt.capacity);
            const selected = value === opt.value;
            return (
              <button
                type="button"
                key={opt.value}
                disabled={full}
                onClick={() => !full && onChange(opt.value)}
                style={{
                  ...buttonBase,
                  background: selected ? COLORS.bgBlack : COLORS.bgWhite,
                  color: selected ? COLORS.textInverse : COLORS.text,
                  opacity: full ? 0.5 : 1,
                  cursor: full ? 'not-allowed' : 'pointer',
                }}
              >
                <span>{opt.value}</span>
                {opt.capacity !== undefined && (
                  <span style={{ marginLeft: 8, fontSize: '0.75rem', fontWeight: 400, opacity: 0.7 }}>
                    {full
                      ? '(Full)'
                      : `(${opt.capacity - (optionCounts?.[opt.value] || 0)} spots)`}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {type === 'checkbox' && (
        <button
          type="button"
          onClick={() => onChange(!(value as boolean))}
          style={{
            ...buttonBase,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            background: (value as boolean) ? COLORS.bgBlack : COLORS.bgWhite,
            color: (value as boolean) ? COLORS.textInverse : COLORS.text,
          }}
        >
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 20,
              height: 20,
              borderRadius: 4,
              border: '2px solid currentColor',
            }}
          >
            {(value as boolean) ? '✓' : ''}
          </span>
          <span>{label}</span>
        </button>
      )}
    </div>
  );
}

export function CustomQuestionsPreview({
  questions,
  values,
  onChange,
}: {
  questions: CustomQuestion[];
  values: Record<string, string | boolean>;
  onChange: (id: string, value: string | boolean) => void;
}) {
  if (questions.length === 0) {
    return <div className="text-sm text-muted-foreground">No questions yet — add one to see the preview.</div>;
  }
  return (
    <div style={{ background: '#FFF8E7', padding: '1rem', borderRadius: 12, border: '2px solid #1A1A1A' }}>
      {questions.map((q) =>
        renderCustomQuestion({
          question: q,
          value: values[q.id] ?? (q.type === 'checkbox' ? false : ''),
          onChange: (v) => onChange(q.id, v),
        }),
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run, confirm pass (5/5)**

- [ ] **Step 5: Commit**

```bash
git add admin/src/lib/renderCustomQuestions.tsx admin/src/lib/renderCustomQuestions.test.tsx
git commit -m "feat(admin): admin-local custom-question renderer for live preview"
```

---

## Task 7: Custom-Questions editor — Edit/Preview tabs

**Files:**
- Modify: `admin/src/components/CustomQuestionsEditor.tsx`

The current editor lists question rows with their controls. Add a tab strip on top with **Edit** (existing UI) and **Preview** (renders questions through the new renderer with local state). On mobile, the tabs stack as a strip. On `≥ lg`, render side-by-side.

- [ ] **Step 1: Read the current `CustomQuestionsEditor.tsx`** to understand its existing structure (you'll wrap it).

```bash
cd admin && wc -l src/components/CustomQuestionsEditor.tsx
```

- [ ] **Step 2: Modify the component** by extracting its current return into an inner `EditorBody` component. Then in the outer `CustomQuestionsEditor` component, render either:

```tsx
import { useState } from 'react';
import { CustomQuestionsPreview } from '@/lib/renderCustomQuestions';
// ... existing imports

export default function CustomQuestionsEditor({ value, onChange }: Props) {
  const [tab, setTab] = useState<'edit' | 'preview'>('edit');
  const [previewValues, setPreviewValues] = useState<Record<string, string | boolean>>({});

  return (
    <div className="space-y-3 lg:grid lg:grid-cols-2 lg:gap-4 lg:space-y-0">
      <div>
        <div className="lg:hidden flex border rounded-md overflow-hidden mb-2">
          <button
            type="button"
            onClick={() => setTab('edit')}
            className={`flex-1 py-1.5 text-sm ${tab === 'edit' ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}
          >
            Edit
          </button>
          <button
            type="button"
            onClick={() => setTab('preview')}
            className={`flex-1 py-1.5 text-sm ${tab === 'preview' ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}
          >
            Preview
          </button>
        </div>
        {/* existing editor body — render only when tab === 'edit' on mobile, always on desktop */}
        <div className={tab === 'edit' ? '' : 'hidden lg:block'}>
          {/* ... move the current return block here ... */}
        </div>
      </div>
      <div className={tab === 'preview' ? '' : 'hidden lg:block'}>
        <div className="text-xs text-muted-foreground mb-2">Live preview — what attendees see on the registration form.</div>
        <CustomQuestionsPreview questions={value} values={previewValues} onChange={(id, v) => setPreviewValues((p) => ({ ...p, [id]: v }))} />
      </div>
    </div>
  );
}
```

The exact integration depends on the current file shape — preserve all existing add/remove/reorder/edit behaviors, and verify the existing `CustomQuestionsEditor.test.tsx` (4 tests) still passes after your changes.

- [ ] **Step 3: Verify tests**

```bash
cd admin && npm test -- CustomQuestionsEditor.test
```

Expected: existing 4 tests still pass.

- [ ] **Step 4: Run full suite**

```bash
cd admin && npm test
```

Expected: no regressions.

- [ ] **Step 5: Commit**

```bash
git add admin/src/components/CustomQuestionsEditor.tsx
git commit -m "feat(admin): live preview tab in custom-questions editor"
```

---

## Task 8: Migrate `EventDrawer` to FormDrawer + validation + smart defaults

**Files:**
- Modify: `admin/src/pages/EventDrawer.tsx`

Replace the existing `Sheet`/header/body/footer scaffolding with `FormDrawer`. Integrate validation. Add a "clone from latest" smart default in create mode.

- [ ] **Step 1: Replace `admin/src/pages/EventDrawer.tsx` entirely.**

Use the structure below as a template (read the existing file first; preserve API interactions and field set):

```tsx
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { FormDrawer } from '@/components/FormDrawer';
import { NumberInput } from '@/components/NumberInput';
import { DateTimePicker } from '@/components/DateTimePicker';
import CustomQuestionsEditor from '@/components/CustomQuestionsEditor';
import { fetchAdmin, showApiError } from '@/lib/api';
import { validateEvent, type ValidationErrors } from '@/lib/validation';
import { toast } from 'sonner';
import type { Event, CustomQuestion } from '@/lib/types';

interface Props { mode: 'create' | 'edit' }

const empty: Partial<Event> = {
  name: '', description: '', date: '', venue_name: '', venue_area: '',
  price: 0, capacity: 0, custom_questions: [], price_includes: '', is_published: false,
};

export default function EventDrawer({ mode }: Props) {
  const navigate = useNavigate();
  const { id } = useParams();
  const [form, setForm] = useState<Partial<Event>>(empty);
  const [initial, setInitial] = useState<Partial<Event>>(empty);
  const [loading, setLoading] = useState(mode === 'edit');
  const [saving, setSaving] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [venueSuggestions, setVenueSuggestions] = useState<string[]>([]);

  useEffect(() => {
    if (mode === 'edit' && id) {
      fetchAdmin<{ event: Event }>(`/api/admin/events/${id}`)
        .then((r) => { setForm(r.event); setInitial(r.event); })
        .catch(showApiError)
        .finally(() => setLoading(false));
    } else {
      // Smart default for create: clone the most recent published event.
      fetchAdmin<{ events: Event[] }>('/api/admin/events')
        .then((r) => {
          const sorted = [...r.events].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
          const latest = sorted.find((e) => e.is_published) || sorted[0];
          if (latest) {
            const next = new Date();
            next.setDate(next.getDate() + 14);
            setForm({
              ...empty,
              date: next.toISOString(),
              venue_name: latest.venue_name || '',
              venue_area: latest.venue_area || '',
              price: latest.price,
              capacity: latest.capacity,
              custom_questions: latest.custom_questions || [],
              price_includes: latest.price_includes || '',
            });
          }
          // Build venue suggestion list from distinct venues.
          const seen = new Set<string>();
          const suggestions: string[] = [];
          for (const e of r.events) {
            if (e.venue_name && !seen.has(e.venue_name)) {
              seen.add(e.venue_name);
              suggestions.push(e.venue_name);
            }
          }
          setVenueSuggestions(suggestions);
        })
        .catch(() => {});
    }
  }, [mode, id]);

  const errors: ValidationErrors = useMemo(() => validateEvent(form), [form]);
  const errorCount = Object.keys(errors).length;
  const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(initial), [form, initial]);

  function close() { navigate('/events'); }

  async function save() {
    setShowErrors(true);
    if (errorCount > 0) {
      // Scroll to first errored field.
      const first = Object.keys(errors)[0];
      const el = document.getElementById(`field-${first}`);
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el?.focus();
      return;
    }
    setSaving(true);
    setServerError(null);
    try {
      const payload = {
        ...form,
        date: form.date ? new Date(form.date).toISOString() : '',
        custom_questions: form.custom_questions || [],
      };
      if (mode === 'create') {
        await fetchAdmin('/api/admin/events', { method: 'POST', body: JSON.stringify(payload) });
        toast.success('Event created');
      } else {
        await fetchAdmin(`/api/admin/events/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
        toast.success('Event updated');
      }
      navigate('/events');
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setSaving(false);
    }
  }

  function set<K extends keyof Event>(k: K, v: Event[K]) { setForm((f) => ({ ...f, [k]: v })); }

  function field(key: string, label: string, control: React.ReactNode) {
    const err = showErrors ? errors[key] : undefined;
    return (
      <div id={`field-${key}`}>
        <Label className={err ? 'text-destructive' : undefined}>{label}</Label>
        {control}
        {err && <div className="text-xs text-destructive mt-1">{err}</div>}
      </div>
    );
  }

  return (
    <FormDrawer
      open
      title={mode === 'create' ? 'New event' : 'Edit event'}
      dirty={dirty}
      saving={saving}
      onCancel={close}
      onSave={save}
      errorCount={showErrors ? errorCount : 0}
      errorMessage={serverError}
    >
      {loading ? <p>Loading…</p> : (
        <>
          {field('name', 'Name', (
            <Input value={form.name || ''} onChange={(e) => set('name', e.target.value)} />
          ))}
          {field('description', 'Description', (
            <Textarea value={form.description || ''} onChange={(e) => set('description', e.target.value)} rows={4} />
          ))}
          {field('date', 'When', (
            <DateTimePicker value={form.date || ''} onChange={(iso) => set('date', iso)} />
          ))}
          <div className="grid grid-cols-2 gap-3">
            {field('capacity', 'Capacity', (
              <NumberInput value={form.capacity ?? null} onChange={(n) => set('capacity', n ?? 0)} aria-label="Capacity" />
            ))}
            {field('price', 'Price (₹)', (
              <NumberInput value={form.price ?? null} onChange={(n) => set('price', n ?? 0)} allowRupees aria-label="Price" />
            ))}
          </div>
          {field('venue_name', 'Venue name', (
            <>
              <Input list="venue-suggestions" value={form.venue_name || ''} onChange={(e) => set('venue_name', e.target.value)} />
              <datalist id="venue-suggestions">
                {venueSuggestions.map((v) => <option key={v} value={v} />)}
              </datalist>
            </>
          ))}
          {field('venue_area', 'Venue area', (
            <Input value={form.venue_area || ''} onChange={(e) => set('venue_area', e.target.value)} />
          ))}
          {field('price_includes', 'Price includes', (
            <Input value={form.price_includes || ''} onChange={(e) => set('price_includes', e.target.value)} />
          ))}
          <div className="flex items-center gap-2">
            <Switch checked={!!form.is_published} onCheckedChange={(c) => set('is_published', c)} />
            <Label>Published</Label>
          </div>
          <div>
            <Label className="block mb-2">Custom questions</Label>
            <CustomQuestionsEditor
              value={form.custom_questions || []}
              onChange={(qs: CustomQuestion[]) => set('custom_questions', qs)}
            />
          </div>
        </>
      )}
    </FormDrawer>
  );
}
```

- [ ] **Step 2: Verify**

```bash
cd admin && npx tsc --noEmit
cd admin && npm test
```

Expected: no errors, all tests pass.

- [ ] **Step 3: Manual smoke check** — start dev server, open `/events/new`. Verify:
  - The drawer opens as a bottom sheet on mobile width (375px) and right-side on desktop.
  - Saving an event with empty name shows "Please enter a name." inline + "Save (1 issue)" on the button.
  - On create, the venue/price/capacity/custom questions are pre-populated from a recent event.

- [ ] **Step 4: Commit**

```bash
git add admin/src/pages/EventDrawer.tsx
git commit -m "refactor(admin): EventDrawer adopts FormDrawer + validation + clone-latest defaults"
```

---

## Task 9: Migrate `GameDrawer`

**Files:**
- Modify: `admin/src/pages/GameDrawer.tsx`

Apply the same pattern as Task 8. Validation is `validateGame`. No smart defaults needed (games are individually distinct). Number fields use `NumberInput`.

- [ ] **Step 1: Replace `admin/src/pages/GameDrawer.tsx`** following the FormDrawer pattern from Task 8. Keep the existing FIELDS array driving the layout. Wrap each numeric field with `NumberInput`, wrap each text field with the existing `Input`. Run `validateGame({ title: form.title })` for the error count. The dirty/save logic mirrors Task 8.

- [ ] **Step 2: Verify**

```bash
cd admin && npx tsc --noEmit
cd admin && npm test
```

- [ ] **Step 3: Commit**

```bash
git add admin/src/pages/GameDrawer.tsx
git commit -m "refactor(admin): GameDrawer adopts FormDrawer + validation"
```

---

## Task 10: Migrate `GuildDrawer`

**Files:**
- Modify: `admin/src/pages/GuildDrawer.tsx`

Apply the FormDrawer pattern. Validation is `validateGuildMember`. Tier and Status are `Select`. Date fields can stay as `<input type="date">` (no time component, native is fine). Amount and plus_ones_used use `NumberInput`.

- [ ] **Step 1: Replace `admin/src/pages/GuildDrawer.tsx`** following the FormDrawer pattern. Preserve the user-info read-only block at the top of the body (Name/Phone/Email + "Edit user details" link).

- [ ] **Step 2: Verify**

```bash
cd admin && npx tsc --noEmit
cd admin && npm test
```

- [ ] **Step 3: Commit**

```bash
git add admin/src/pages/GuildDrawer.tsx
git commit -m "refactor(admin): GuildDrawer adopts FormDrawer + validation"
```

---

## Task 11: Migrate `RegistrationDrawer`

**Files:**
- Modify: `admin/src/pages/RegistrationDrawer.tsx`

Apply the FormDrawer pattern. Validation is `validateRegistration`. Wrap numeric fields with `NumberInput` (`allowRupees` on `total_amount`). Phone field stays as a regular `Input` for now — formatting on display is the `PhoneCell`'s job in lists. Custom-answer rendering can stay as the existing inline shadcn controls (we're not switching the in-drawer answer renderer to brutal — that's reserved for the editor's preview tab).

- [ ] **Step 1: Replace `admin/src/pages/RegistrationDrawer.tsx`** following the FormDrawer pattern. Preserve the existing custom-answers editing UI at the bottom of the body.

- [ ] **Step 2: Verify**

```bash
cd admin && npx tsc --noEmit
cd admin && npm test
```

- [ ] **Step 3: Commit**

```bash
git add admin/src/pages/RegistrationDrawer.tsx
git commit -m "refactor(admin): RegistrationDrawer adopts FormDrawer + validation"
```

---

## Task 12: Migrate `ManualRegistrationDrawer` + remember last event

**Files:**
- Modify: `admin/src/pages/ManualRegistrationDrawer.tsx`

Apply the FormDrawer pattern. Validation is `validateManualRegistration`. Phone-first behavior already exists — keep it, just adapt to the new wrapper. Add localStorage persistence for the last-used event so it pre-selects on next open.

- [ ] **Step 1: Replace `admin/src/pages/ManualRegistrationDrawer.tsx`** following the FormDrawer pattern.

The `useEffect` that picks the default event should:

```tsx
useEffect(() => {
  fetchAdmin<{ events: Event[] }>('/api/admin/events')
    .then((r) => {
      setEvents(r.events);
      const remembered = localStorage.getItem('admin.manualReg.lastEventId') || '';
      const upcoming = r.events
        .filter((e) => Date.parse(e.date) >= Date.now())
        .sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
      if (remembered && r.events.some((e) => e.id === remembered)) setEventId(remembered);
      else if (upcoming[0]) setEventId(upcoming[0].id);
    })
    .catch(showApiError);
}, []);
```

When the user changes the event, persist the new id:

```tsx
function pickEvent(v: string) {
  setEventId(v);
  if (v) localStorage.setItem('admin.manualReg.lastEventId', v);
}
```

The `Select`'s `onValueChange` calls `pickEvent` instead of `setEventId`.

- [ ] **Step 2: Verify**

```bash
cd admin && npx tsc --noEmit
cd admin && npm test
```

- [ ] **Step 3: Commit**

```bash
git add admin/src/pages/ManualRegistrationDrawer.tsx
git commit -m "refactor(admin): ManualRegistrationDrawer adopts FormDrawer + remembers last event"
```

---

## Task 13: Migrate `UserDrawer`

**Files:**
- Modify: `admin/src/pages/UserDrawer.tsx`

Apply the FormDrawer pattern. Validation is `validateUser`. Three fields: name, phone, email.

- [ ] **Step 1: Replace `admin/src/pages/UserDrawer.tsx`** following the FormDrawer pattern.

- [ ] **Step 2: Verify**

```bash
cd admin && npx tsc --noEmit
cd admin && npm test
```

- [ ] **Step 3: Commit**

```bash
git add admin/src/pages/UserDrawer.tsx
git commit -m "refactor(admin): UserDrawer adopts FormDrawer + validation"
```

---

## Task 14: Manual end-to-end verification

**Files:** none modified — verification only.

- [ ] **Step 1: Run dev server**

```bash
cd admin && npm run dev
```

- [ ] **Step 2: Smoke at desktop (1280px)**
  - `/events/new` — bottom-up sheet on mobile, right-side on desktop. Submit empty → see inline errors + "Save (N issues)" button. Submit valid → save, drawer closes, list updates.
  - `/events/new` again — date/venue/price/capacity/custom_questions pre-populated from a recent event.
  - `/events/<id>` — edit existing, change one field, click Cancel → discard guard modal appears.
  - `/games/new` — title required validation works.
  - `/guild/<id>` — start/expiry consistency check works (set expiry < start → error).
  - `/registrations/<id>` — edit existing, submit invalid email → error; submit valid → success.
  - `/registrations/new` — phone-first flow still works; default event matches what was last used.
  - `/guild/<id>/user` — UserDrawer phone validation works.

- [ ] **Step 3: Smoke at phone (375px)**
  - Each drawer opens as bottom sheet with rounded top corners.
  - Sticky footer (Cancel + Save) is visible without scrolling.
  - Single-column layout — no fields hugging each other in awkward two-column grids.
  - Number inputs are blank when empty (no zero placeholder).
  - DateTimePicker date+time selectors work; time options are 30-minute increments.

- [ ] **Step 4: Verify custom-questions editor preview**
  - Open `/events/new` → in the Custom questions section, switch to Preview (or scroll to it on `≥lg`). Adding a question on Edit immediately appears in Preview.
  - Preview matches the public registration form's neo-brutalist look (cream background, hard-edged borders).

- [ ] **Step 5: Capture screenshots**

```bash
mkdir -p docs/superpowers/screenshots/2026-05-02-phase-2-after
# (manual screenshots: each drawer at 375px and 1280px)
```

```bash
git add docs/superpowers/screenshots/
git commit -m "docs(admin): phase 2 visual reference screenshots"
```

---

## Self-review summary

**Spec coverage check (Phase 2 requirements vs. tasks):**
- FormDrawer wrapper (single-column default, mobile bottom sheet, desktop right side, sticky footer, top error banner) — Task 5.
- Field-level validation (`lib/validation.ts`, plain-English messages, scroll-to-first-error, save button issue count) — Tasks 1, 8, 9, 10, 11, 12, 13.
- NumberInput (empty when empty, forgiving rupee parser) — Task 2.
- Phone parsing (forgiving, strips +91/spaces) — Task 1 (parsePhone helper used by validators).
- Custom DateTimePicker (date + 30-min time selects) — Task 3.
- Discard-changes styled modal — Task 4 (consumed by FormDrawer in Task 5).
- Smart defaults: clone latest event — Task 8.
- Venue type-ahead — Task 8 (datalist).
- Manual registration phone-first + remembered last event — Task 12.
- Custom-questions live preview — Tasks 6, 7.
- Public-site rendering extraction → admin-local renderer (deviation noted in plan header) — Task 6.

**Type consistency:**
- `ValidationErrors` from Task 1 used by all drawers (Tasks 8–13).
- `FormDrawer` props (`dirty`, `saving`, `onCancel`, `onSave`, `errorCount`, `errorMessage`) consumed unchanged by every drawer migration.
- `CustomQuestion` from `lib/types` consumed by both Task 6 renderer and Task 7 editor.
- `parsePhone` exported from validation, used by `validateRegistration` and `validateUser`.

**Out of scope (deferred to Phase 3 / Phase 4):**
- Mobile card-list layouts on list pages — Phase 3.
- Global "Find someone" search — Phase 3.
- Inline guild verify/reject buttons — Phase 3.
- Bulk action toolbar + CSV export — Phase 4.
- Sorting on list pages (the capability shipped in Phase 1; consumption is Phase 4).
- Sharing `renderCustomQuestions` between admin and public site — out of scope (deviation noted).
