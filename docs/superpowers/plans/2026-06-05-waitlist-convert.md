# Convert waitlist → registration from the Leads page — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin or event-scoped guest convert a waitlist lead into a registration directly from the admin Leads page.

**Architecture:** Reuse the existing `/api/admin/registrations/manual` endpoint. Add best-effort lead auto-conversion to `handleManualRegister` (mirroring the public `/api/register` flow), then add a prefilled convert dialog to `Leads.tsx`. No new endpoint, no DB migration.

**Tech Stack:** Cloudflare Worker (TS, Vitest), React 19 + shadcn admin SPA, Supabase via service-role client.

Spec: `docs/superpowers/specs/2026-06-05-waitlist-convert-design.md`

---

## Task 1: Worker — `handleManualRegister` marks the matching lead converted

**Files:**
- Modify: `worker/src/admin/register-manual.ts` (insert after the registration insert, currently `register-manual.ts:171`)
- Test: `worker/src/admin/register-manual.test.ts`

- [ ] **Step 1: Write the failing test**

Add this test inside the `describe('handleManualRegister', ...)` block in `worker/src/admin/register-manual.test.ts`. It uses a tailored Supabase mock that captures the `leads.update` payload and records which `.eq`/`.is` filters were applied.

```ts
it('marks a matching open lead converted after a manual registration', async () => {
  let leadUpdate: any = null;
  const leadFilters: Record<string, unknown> = {};
  (getSupabase as any).mockReturnValue({
    from: (table: string) => {
      if (table === 'events') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'e1', name: 'T', date: '2026-06-01T00:00:00Z', price: 0, capacity: 10, custom_questions: null, is_published: true, venue_name: 'X', venue_area: null, price_includes: null }, error: null }) }) }) };
      }
      if (table === 'registrations') {
        return {
          select: () => ({ eq: () => ({ neq: async () => ({ data: [], error: null }) }) }),
          insert: () => ({ select: () => ({ single: async () => ({ data: { id: 'reg-99' }, error: null }) }) }),
        };
      }
      if (table === 'users') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'u1' }, error: null }) }) }),
          update: () => ({ eq: async () => ({ error: null }) }),
        };
      }
      if (table === 'guild_path_members') {
        return noMember();
      }
      if (table === 'leads') {
        return {
          update: (row: any) => {
            leadUpdate = row;
            return {
              eq: (col: string, val: unknown) => { leadFilters[col] = val; return {
                eq: (col2: string, val2: unknown) => { leadFilters[col2] = val2; return {
                  is: (col3: string, val3: unknown) => { leadFilters[col3] = val3; return {
                    is: async (col4: string, val4: unknown) => { leadFilters[col4] = val4; return { error: null }; },
                  }; },
                }; },
              }; },
            };
          },
        };
      }
      return null;
    },
  });
  const req = new Request('http://localhost/api/admin/registrations/manual', {
    method: 'POST',
    body: JSON.stringify({ event_id: 'e1', name: 'A', phone: '9999999999', email: 'a@x.com', seats: 1, payment_status: 'pending', custom_answers: {} }),
  });
  const ctx = { waitUntil: () => {} } as any;
  const res = await handleManualRegister(req, mockEnv(), ctx);
  expect(res.status).toBe(200);
  expect(leadUpdate).toMatchObject({ registration_id: 'reg-99' });
  expect(leadUpdate.converted_at).toBeTruthy();
  expect(leadFilters).toMatchObject({
    phone: '9999999999',
    event_id: 'e1',
    converted_at: null,
    junk_at: null,
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd worker && npx vitest run src/admin/register-manual.test.ts -t "marks a matching open lead converted"`
Expected: FAIL — `from('leads')` is not yet called, so `leadUpdate` is `null` and the `toMatchObject` assertion throws.

- [ ] **Step 3: Write minimal implementation**

In `worker/src/admin/register-manual.ts`, immediately after the registration-insert error guard (after `if (regErr || !reg) return jsonResponse({ error: 'Registration failed' }, 500);`, which is line 171), insert:

```ts
  // Convert any open lead matching this phone+event (e.g. a waitlist entry).
  // Best-effort — failures here must not fail the registration.
  try {
    await supabase
      .from('leads')
      .update({
        converted_at: new Date().toISOString(),
        registration_id: reg.id,
        updated_at: new Date().toISOString(),
      })
      .eq('phone', phone)
      .eq('event_id', body.event_id)
      .is('converted_at', null)
      .is('junk_at', null);
  } catch {
    // swallow
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd worker && npx vitest run src/admin/register-manual.test.ts`
Expected: PASS — all existing tests plus the new one.

- [ ] **Step 5: Commit**

```bash
git add worker/src/admin/register-manual.ts worker/src/admin/register-manual.test.ts
git commit -m "feat(worker): manual register converts matching open lead"
```

---

## Task 2: Admin — convert dialog on waitlist rows

**Files:**
- Modify: `admin/src/pages/Leads.tsx`

This task is a React UI addition with no unit-test harness for `Leads.tsx` (none exists today). Per the spec, worker-side coverage in Task 1 covers the conversion logic; here we add the UI and verify with a build + manual smoke check.

- [ ] **Step 1: Add imports for the dialog and payment-status select**

At the top of `admin/src/pages/Leads.tsx`, add to the existing import block:

```tsx
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
```

`Select`, `Input`, `Label`, `Button`, `toast`, `fetchAdmin`, and `ApiError` are already imported in this file.

- [ ] **Step 2: Add convert-dialog state and handler inside the `Leads` component**

Inside `export default function Leads()`, after the existing `const [waitlist, setWaitlist] = ...` line, add the dialog state:

```tsx
  const [convertLead, setConvertLead] = useState<Lead | null>(null);
  const [convName, setConvName] = useState('');
  const [convEmail, setConvEmail] = useState('');
  const [convSeats, setConvSeats] = useState('1');
  const [convPayment, setConvPayment] = useState<'pending' | 'confirmed'>('pending');
  const [convSubmitting, setConvSubmitting] = useState(false);
  const [convError, setConvError] = useState<string | null>(null);

  function openConvert(lead: Lead) {
    setConvertLead(lead);
    setConvName(lead.name ?? '');
    setConvEmail(lead.email ?? '');
    setConvSeats(String(lead.seats ?? 1));
    setConvPayment('pending');
    setConvError(null);
  }

  async function submitConvert() {
    if (!convertLead) return;
    const name = convName.trim();
    if (!name) { setConvError('Name is required'); return; }
    const seats = parseInt(convSeats, 10);
    if (Number.isNaN(seats) || seats < 1) { setConvError('Enter a valid seat count'); return; }
    setConvSubmitting(true);
    setConvError(null);
    try {
      await fetchAdmin('/api/admin/registrations/manual', {
        method: 'POST',
        body: JSON.stringify({
          event_id: convertLead.event_id,
          name,
          phone: convertLead.phone,
          email: convEmail.trim() || undefined,
          seats,
          payment_status: convPayment,
          custom_answers: {},
        }),
      });
      const convertedId = convertLead.id;
      setLeads((cur) => cur.filter((l) => l.id !== convertedId));
      setConvertLead(null);
      toast.success('Registered');
    } catch (e) {
      setConvError(e instanceof ApiError ? e.message : 'Failed to register');
    } finally {
      setConvSubmitting(false);
    }
  }
```

- [ ] **Step 3: Add a Register button to waitlist rows**

In the actions cell of each row (the `<td className="p-2 text-right whitespace-nowrap">` block, currently containing the WhatsApp link and the Junk button), add a Register button shown only for waitlist rows. Place it immediately before the existing `<a ... WhatsApp>` link:

```tsx
                    {l.waitlist_at && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="mr-2"
                        onClick={() => openConvert(l)}
                      >Register</Button>
                    )}
```

- [ ] **Step 4: Render the convert dialog**

Just before the closing `</div>` of the top-level `return (<div className="p-4 space-y-4"> ... </div>)`, add the dialog:

```tsx
      <Dialog open={!!convertLead} onOpenChange={(o) => { if (!o) setConvertLead(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Register from waitlist</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="text-sm text-muted-foreground">
              {convertLead?.phone} · {convertLead?.events?.name ?? 'event'}
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="conv-name">Name</Label>
              <Input id="conv-name" value={convName} onChange={(e) => setConvName(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="conv-email">Email</Label>
              <Input id="conv-email" value={convEmail} onChange={(e) => setConvEmail(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="conv-seats">Seats</Label>
              <Input id="conv-seats" inputMode="numeric" value={convSeats} onChange={(e) => setConvSeats(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1">
              <Label>Payment</Label>
              <Select value={convPayment} onValueChange={(v) => setConvPayment(v as 'pending' | 'confirmed')}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="confirmed">Confirmed</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {convError && <div className="text-sm text-destructive">{convError}</div>}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConvertLead(null)} disabled={convSubmitting}>Cancel</Button>
            <Button onClick={submitConvert} disabled={convSubmitting}>
              {convSubmitting ? 'Registering…' : 'Register'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
```

- [ ] **Step 5: Verify it compiles**

Run: `cd admin && npm run build`
Expected: build succeeds with no TypeScript errors.

- [ ] **Step 6: Manual smoke check**

Run `cd admin && npm run dev`, open the Leads page, set the **Waitlist** filter to "Waitlist only", and confirm:
- waitlist rows show a **Register** button; non-waitlist rows do not;
- clicking it opens the dialog prefilled with the lead's name/email/seats and Payment = Pending;
- submitting against an event with a free spot creates the registration, toasts "Registered", and removes the row;
- submitting against a full event keeps the dialog open and shows the "Only N spots remaining" error.

- [ ] **Step 7: Commit**

```bash
git add admin/src/pages/Leads.tsx
git commit -m "feat(admin): convert waitlist leads to registrations from Leads page"
```

---

## Task 3: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full worker test suite**

Run: `cd worker && npm test`
Expected: all tests pass.

- [ ] **Step 2: Run the admin test suite**

Run: `cd admin && npm test`
Expected: all existing tests pass (no Leads tests were added/removed).

- [ ] **Step 3: Confirm no migration or routing changes were needed**

Verify `git diff --stat main` touches only:
- `worker/src/admin/register-manual.ts`
- `worker/src/admin/register-manual.test.ts`
- `admin/src/pages/Leads.tsx`
- the spec/plan docs

No `worker/src/index.ts`, `worker/src/guest/index.ts`, or `supabase/migrations/` changes — guest scoping and routing already cover `/api/admin/registrations/manual`.

---

## Deployment notes

After merge:
- Admin SPA deploys automatically on push to `main` (Cloudflare Pages).
- **Worker must be deployed manually:** `cd worker && npx wrangler deploy`. The lead-conversion behaviour (Task 1) does not take effect until the worker is deployed.
