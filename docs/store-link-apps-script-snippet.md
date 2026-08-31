# Store link — Apps Script email update

The registration confirmation email is a Google Apps Script template (`Code.gs`),
**outside this repo** — see `AGENTS.md`. Adding the store link is a hand edit there.

> **Status: all edits below were applied to `Code.gs` on 2026-08-31.** Kept as
> the record of what changed, since `Code.gs` is not in version control and has
> no history of its own.

## The edit

In `buildEventEmailHtml`, find the footer block:

```javascript
              '<div style="color:#666;font-size:14px;margin-top:32px;border-top:1px solid #eee;padding-top:16px;">' +
                'Questions? Reply to this email or WhatsApp <a href="https://wa.me/' + WHATSAPP_NUMBER_DIGITS + '" style="color:#F47B20;">' + WHATSAPP_NUMBER_DISPLAY + '</a>.' +
              '</div>' +
              '<div style="color:#999;font-size:13px;margin-top:8px;">— BGC · Bangalore\'s board gaming community</div>' +
```

Insert one new `<div>` between the two existing ones:

```javascript
              '<div style="color:#666;font-size:14px;margin-top:32px;border-top:1px solid #eee;padding-top:16px;">' +
                'Questions? Reply to this email or WhatsApp <a href="https://wa.me/' + WHATSAPP_NUMBER_DIGITS + '" style="color:#F47B20;">' + WHATSAPP_NUMBER_DISPLAY + '</a>.' +
              '</div>' +
              '<div style="color:#666;font-size:14px;margin-top:8px;">' +
                'You can buy games and more from <a href="https://boardgamecompany.in/store" style="color:#F47B20;">BGC\'s store</a>.' +
              '</div>' +
              '<div style="color:#999;font-size:13px;margin-top:8px;">— BGC · Bangalore\'s board gaming community</div>' +
```

Notes:

- The apostrophe in `BGC\'s` **must** stay escaped — the surrounding string is
  single-quoted, and an unescaped `'` is a syntax error that stops every
  confirmation email from sending.
- It sits below the "Questions?" line and above the `— BGC` sign-off, so the
  sign-off stays last. To put it literally last instead, move the new block
  below the sign-off `<div>`.
- Uses the same `#666` / 14px as the "Questions?" line so it reads as one
  footer group rather than an ad.
- No trailing-slash on `/store` — the site 308-redirects `/store` → `/store/`,
  which is fine, but `/store/` avoids the extra hop if you prefer.

## Unrelated bug found in the same block

`WHATSAPP_NUMBER_DIGITS` / `WHATSAPP_NUMBER_DISPLAY` in `Code.gs` are still the
**old** business number:

```javascript
const WHATSAPP_NUMBER_DIGITS = '919982200768';
const WHATSAPP_NUMBER_DISPLAY = '+91 99822 00768';
```

Commit `0469127` ("fix: update business contact number", 2026) moved the website
and worker to `919606598024`, but Code.gs was missed because it lives outside the
repo. Every registration confirmation email still points people at the retired
number. Fix while you are in the file:

```javascript
const WHATSAPP_NUMBER_DIGITS = '919606598024';
const WHATSAPP_NUMBER_DISPLAY = '+91 96065 98024';
```

Check the guild / payment email templates for the same two constants — they were
built from the same plan and likely carry the stale number too.

## Two bugs in `buildWaitlistEmailHtml`

Found by running the whole of `Code.gs` against stubbed Apps Script globals
after the store line went in. Both pre-date this change; neither affects the
registration email.

**1. Missing space in the greeting.** Renders `You're on the waitlist,Asha!`
The registration and guild templates both have the space; waitlist does not.

```javascript
// before
'...margin-bottom:16px;">You\'re on the waitlist,' + escapeHtml(name) + '!</div>' +
// after
'...margin-bottom:16px;">You\'re on the waitlist, ' + escapeHtml(name) + '!</div>' +
```

**2. Waitlist emails ignore all-day and multi-day events.** `formatEventWhen`
(added for migration `020`) was only wired into `buildEventEmailHtml`.
`buildWaitlistEmailHtml` still calls `Utilities.formatDate` on `event.date`
directly, so for a 5–7 Sep all-day event the two emails disagree:

| | renders |
|---|---|
| registration | `5 – 7 Sep 2026 · All day` |
| waitlist | `Sat, 5 Sep 2026 · 7:00 PM` |

Someone waitlisted for a three-day event is told it is a single evening, at a
clock time the event does not have. Fix by using the same helper:

```javascript
// before
  const eventDate = new Date(event.date);
  const dateStr = Utilities.formatDate(eventDate, 'Asia/Kolkata', 'EEE, d MMM yyyy');
  const timeStr = Utilities.formatDate(eventDate, 'Asia/Kolkata', 'h:mm a');
// after
  const when = formatEventWhen(event);
  const dateStr = when.dateStr;
  const timeStr = when.timeStr;
```

No worker change is needed: `WaitlistEmailPayload.event` in
`worker/src/email.ts:44` already declares `end_date` and `is_all_day`, the same
as `EventEmailPayload`. The data has been arriving all along — only the
template ignores it.

## Scope of the store line

It is in `buildEventEmailHtml` only, which matches the request. The guild
welcome and waitlist emails do not carry it. Add the same `<div>` to their
footers if you want it everywhere.

## Confirming the waitlist fix

`testSendEmailToSelf` only covers the registration path, and its sample event is
a single-slot one — so it exercises neither waitlist bug. Paste this alongside it
to check both in one send:

```javascript
function testWaitlistEmailToSelf() {
  const me = Session.getActiveUser().getEmail();
  const payload = {
    to: me,
    name: 'Test User',
    seats: 2,
    event: {
      name: 'Three Day Con',
      date: '2026-09-05T10:00:00+05:30',
      end_date: '2026-09-07T18:00:00+05:30',
      is_all_day: true,
      venue_name: 'The Den',
      venue_area: 'Indiranagar',
    },
  };
  MailApp.sendEmail({
    to: payload.to,
    subject: "[BGC] You're on the waitlist for " + payload.event.name,
    htmlBody: buildWaitlistEmailHtml(payload),
    name: 'Board Game Company',
    from: FROM_ADDRESS,
  });
  Logger.log('Sent test waitlist email to ' + me);
}
```

Expect `5 – 7 Sep 2026 · All day` and a space after the comma in
`You're on the waitlist, Test User!`. If you instead see `Sat, 5 Sep 2026 ·
10:00 AM`, `formatEventWhen` did not get wired in.

## After editing

Apps Script edits are live on save — there is no deploy step for the webhook
target, but re-deploy the Web App if the deployment is pinned to a version
rather than "Head". Send yourself a test registration to confirm the footer
renders and the link works.
