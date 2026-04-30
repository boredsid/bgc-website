# Event Price-Includes Banner

Add an optional `price_includes` text field to events that surfaces as a banner on the calendar event cards and the registration page header.

## Goal

Many BGC events bundle the ticket price with extras (cover charge, F&B credit, welcome drink). We want a way to tell attendees what's included so they don't ask before signing up. The text is freeform, single-line in spirit (one short sentence), entered by an admin directly in Supabase.

## Schema

One migration adds a nullable text column:

```sql
alter table events add column price_includes text;
```

Nullable. No backfill — existing rows stay NULL and render no banner.

## Display

When `event.price_includes` is set (truthy, non-empty string), a banner renders in two places. When it's NULL or empty, nothing renders.

### Calendar event card (`src/components/EventList.tsx` → `EventCard`)

Banner appears between the price/spots-left row and the Register/Sold-Out button.

### Registration page header (`src/components/RegistrationForm.tsx`)

Banner appears immediately under the existing date / venue / price summary block, before the form fields.

### Banner markup (identical in both places)

```tsx
{event.price_includes && (
  <div className="card-brutal px-3 py-2 text-sm" style={{ background: '#FFD166', boxShadow: '3px 3px 0 #1A1A1A' }}>
    <span className="font-heading font-semibold">✨ {event.price_includes}</span>
  </div>
)}
```

Inlined in both consumers — no new component yet. If a third consumer appears, extract then.

## Type changes

`src/lib/types.ts` — add to the `Event` interface:

```ts
price_includes: string | null;
```

No Worker changes required — events are read by the browser via the anon-key Supabase client (RLS allows public read of published events). The new column is automatically returned by `select('*')`.

## Files

### Modified
- `supabase/migrations/005_event_price_includes.sql` — the migration above (new file but treated as modification to the schema).
- `src/lib/types.ts` — add `price_includes: string | null` to `Event`.
- `src/components/EventList.tsx` — render the banner inside `EventCard` between the price line and the action button.
- `src/components/RegistrationForm.tsx` — render the banner inside the event header wrapper `<div className="mb-6 pb-6" ...>` (around lines 232–256), placed after the price/spots row and before the wrapper closes. Use `mt-3` for spacing.

## Edge cases

- **Empty string vs NULL.** Both render nothing. The truthy check `event.price_includes && ...` handles both.
- **Very long text.** No DB or UI clamp. Wraps naturally. Admin discretion — keep it under one short sentence.
- **Special characters / emoji.** Plain text is rendered with React's default escaping. Safe by default.
- **Sold-out card.** Banner still shows above the "Sold Out" pill — the inclusion info is useful even when registration is closed.

## Out of scope (YAGNI)

- Markdown / rich text rendering.
- Multiple structured inclusion items.
- Icon picker per event (the ✨ emoji is hardcoded).
- Length limits at the DB layer.
- Banner on the homepage `UpcomingEventBanner` — only calendar + registration page for now.

## Testing

- Set `price_includes` on a published event in Supabase Studio (e.g., `"Includes ₹500 bar credit + welcome tea"`).
- Visit `/calendar` — banner shows on that event's card; other cards (with NULL) show no banner.
- Visit `/register?event=<id>` — banner shows in the header.
- Clear the column to NULL — both pages stop showing the banner after refresh.
