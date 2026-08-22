# Event timing — Apps Script email update

Events can now be **all day** and can **span several days** (migration `020`). The worker
already sends the two new fields on every `event_registration` and `event_waitlist` payload:

```json
{
  "event": {
    "name": "…",
    "date": "2026-09-05T10:00:00+05:30",
    "end_date": "2026-09-07T18:00:00+05:30",
    "is_all_day": false,
    "venue_name": "…",
    "venue_area": "…"
  }
}
```

- `end_date` is `null` for a normal single-slot event.
- `is_all_day` is `true` when the event has no meaningful clock time.

The Apps Script template ignores both today, so a three-day event's confirmation email
currently shows only its start date. Two edits fix it.

## 1. Add this helper

Paste it anywhere at the top level of `Code.gs`:

```javascript
/**
 * Bangalore-time labels for an event, covering all-day and multi-day events.
 * Returns the same { dateStr, timeStr } pair the template already uses, so
 * nothing else in buildEventEmailHtml has to change.
 */
function formatEventWhen(event) {
  var TZ = 'Asia/Kolkata';
  var start = new Date(event.date);
  var end = event.end_date ? new Date(event.end_date) : null;

  var startDay = Utilities.formatDate(start, TZ, 'yyyy-MM-dd');
  var endDay = end ? Utilities.formatDate(end, TZ, 'yyyy-MM-dd') : startDay;
  var multiDay = endDay !== startDay;

  var dateStr;
  if (!multiDay) {
    dateStr = Utilities.formatDate(start, TZ, 'EEE, d MMM yyyy');
  } else if (Utilities.formatDate(start, TZ, 'yyyy') !== Utilities.formatDate(end, TZ, 'yyyy')) {
    // 30 Dec 2026 – 2 Jan 2027
    dateStr = Utilities.formatDate(start, TZ, 'd MMM yyyy') + ' – ' + Utilities.formatDate(end, TZ, 'd MMM yyyy');
  } else if (Utilities.formatDate(start, TZ, 'MMM') !== Utilities.formatDate(end, TZ, 'MMM')) {
    // 28 Sep – 2 Oct 2026
    dateStr = Utilities.formatDate(start, TZ, 'd MMM') + ' – ' + Utilities.formatDate(end, TZ, 'd MMM yyyy');
  } else {
    // 5 – 7 Sep 2026
    dateStr = Utilities.formatDate(start, TZ, 'd') + ' – ' + Utilities.formatDate(end, TZ, 'd MMM yyyy');
  }

  var timeStr;
  if (event.is_all_day) {
    timeStr = 'All day';
  } else {
    timeStr = Utilities.formatDate(start, TZ, 'h:mm a');
    if (end) {
      var endTime = Utilities.formatDate(end, TZ, 'h:mm a');
      if (endTime !== timeStr) timeStr = timeStr + ' – ' + endTime;
    }
  }

  return { dateStr: dateStr, timeStr: timeStr };
}
```

## 2. Use it in `buildEventEmailHtml`

Find these three lines:

```javascript
  const eventDate = new Date(event.date);
  const dateStr = Utilities.formatDate(eventDate, 'Asia/Kolkata', 'EEE, d MMM yyyy');
  const timeStr = Utilities.formatDate(eventDate, 'Asia/Kolkata', 'h:mm a');
```

Replace them with:

```javascript
  const when = formatEventWhen(event);
  const dateStr = when.dateStr;
  const timeStr = when.timeStr;
```

The template already renders these as `dateStr + ' · ' + timeStr`, so the surrounding
copy needs no change — an all-day event reads `5 – 7 Sep 2026 · All day`.

If the waitlist email builder formats `event.date` the same way, apply the identical
two-line swap there; it receives the same fields.

Then **redeploy** the web app: Deploy → Manage deployments → edit the active deployment →
New version → Deploy. Editing the code alone does not update the live endpoint.

## What each shape should produce

| Event | `dateStr` | `timeStr` |
|---|---|---|
| Single slot, timed | `Sat, 5 Sep 2026` | `6:00 pm` |
| Single day, with an end time | `Sat, 5 Sep 2026` | `6:00 pm – 10:00 pm` |
| All day, one day | `Sat, 5 Sep 2026` | `All day` |
| Multi-day, timed | `5 – 7 Sep 2026` | `10:00 am – 6:00 pm` |
| Multi-day, all day | `5 – 7 Sep 2026` | `All day` |
| Across months | `28 Sep – 2 Oct 2026` | — |
| Across years | `30 Dec 2026 – 2 Jan 2027` | — |

These match what the site and admin show, which come from `src/lib/event-date.ts`.

## Smoke test

1. In admin, create a **draft** (unpublished) event, turn on **All day** and **Set an end**,
   and give it a two-day span.
2. Publish it briefly, register yourself with an email address, then unpublish it.
3. The confirmation email should read `5 – 7 Sep 2026 · All day`.
4. Delete the test registration from the admin Registrations list.

Nothing in the worker needs redeploying for this — it already sends the fields.
