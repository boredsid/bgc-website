# Store link — Apps Script email update

The registration confirmation email is a Google Apps Script template (`Code.gs`),
**outside this repo** — see `AGENTS.md`. Adding the store link is a hand edit there.

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

## After editing

Apps Script edits are live on save — there is no deploy step for the webhook
target, but re-deploy the Web App if the deployment is pinned to a version
rather than "Head". Send yourself a test registration to confirm the footer
renders and the link works.
