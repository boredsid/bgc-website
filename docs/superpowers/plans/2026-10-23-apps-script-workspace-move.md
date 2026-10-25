# Move the email Apps Script to the Workspace account (Phase 4)

> **Superseded 2026-10-23 by [`2026-10-23-resend-email.md`](2026-10-23-resend-email.md)** — the worker now sends through Resend instead of a copied Apps Script. Kept for its analysis, which still applies: the REPLAY gate on removing the Gmail alias and tightening DMARC, and the silent-failure risks.

**Goal:** BGC's transactional emails (registration, waitlist, Guild purchase, Demon's Draft) come **from `hello@boardgamecompany.in`**, sent by that Google Workspace account and DKIM-signed by `boardgamecompany.in`. Replies land in the `hello@` inbox.

**What happens today (verified 2026-10-23 from a real confirmation sent 2026-10-22):** confirmations arrive as `From: Board Game Company <boardgamecompany2024@gmail.com>`, signed `d=gmail.com`, with no Reply-To. The script calls `MailApp.sendEmail({ from: 'hello@…' })`, but **MailApp has no `from` option and ignores it**. So BGC confirmations pass DMARC today, as gmail.com mail, and have never actually come from `hello@`. This move changes the **visible sender** and **where replies go**. It is also the first time BGC sends as `boardgamecompany.in`.

**Shape of the change:** copy the Apps Script project into the Workspace account, using exactly the code that is deployed today. Deploy it, and prove it matches the old endpoint by calling both directly. Then flip **one** worker secret (`APPS_SCRIPT_URL`). Rollback is flipping it back. No worker code, database or site change is part of the cutover.

**Not covered here but blocking the cleanup (Step 7):** REPLAY's emails and the REPLAY marketing sends go out **as `hello@` through the Gmail account's "Send mail as" alias**. Those *do* fail DMARC alignment today. Removing the alias or tightening DMARC before they move would break them. See the Step 7 gate.

**Operator:** Siddhant, in the Apps Script UI, Cloudflare (`wrangler`), and Gmail. Active time ≈ 1.5 hours, then a 14-day soak.

**Review:** independently reviewed twice on 2026-10-23. The first pass made 21 findings, all folded in. The re-review found no blockers; its 8 follow-ups are folded in too, including dropping the separate logging deploy, which carried more risk than it removed.

---

## Facts this plan relies on

| Fact | Source |
|---|---|
| Live confirmations: `From: Board Game Company <boardgamecompany2024@gmail.com>`, `DKIM d=gmail.com`, no `Reply-To`, subject `[BGC] You're registered for <event>!`. They appear in the Gmail account's **Sent** folder. | Raw headers of a message sent 2026-10-22 (read via the Gmail connector) |
| The live sender name and subject match the Guild plan's router, but the snippets edited since then (event timing, store link, DD, waitlist) were pasted by hand and have no history. **Only the live project is authoritative.** | `2026-05-01-guild-email-and-payment-page.md:1009,1016` vs the live email |
| `MailApp.sendEmail` options are attachments, bcc, body, cc, htmlBody, inlineImages, name, noReply, replyTo, subject, to. There is **no `from`**; that is a GmailApp option. | developers.google.com/apps-script/reference/mail/mail-app |
| The worker posts `{ type, ...payload, secret }` to `APPS_SCRIPT_URL`, follows redirects, and only `console.error`s on failure. | `worker/src/email.ts:58-84` |
| Every send runs in `ctx.waitUntil(...)`. **A broken endpoint never fails a booking and nobody sees an error.** The DD path swallows thrown errors entirely (`.catch(() => {})`). `waitUntil` work is cut off 30 s after the response. | `register.ts:396`, `admin/register-manual.ts:402`, `guild-purchase.ts:134`, `waitlist.ts:135`, `dd-submit.ts:109-113` |
| Worker log strings: `[email] non-OK response`, `[email] non-success body`, `[email] send error`, `[email] waitlist send error`, `[email] APPS_SCRIPT_URL or APPS_SCRIPT_SECRET not configured; skipping`. | `git grep '\[email\]' worker/src` |
| **Worker logs are not stored.** There is no `[observability]` block in `worker/wrangler.toml`, so only a live `wrangler tail` sees them. This plan relies on a tail on cutover day plus a daily check against the Sent folder (5.5). Turning logs on would need a full code deploy, so it's a separate follow-up. | `worker/wrangler.toml` |
| `doPost` catches every error and returns JSON. Apps Script **Executions show "Completed" even when the send failed.** | Design in the May plan, Task 2 |
| Four payload types: `event_registration`, `guild_purchase`, `event_waitlist`, `dd_submission`. Whether the live router really handles all four is checked in Step 1. | `worker/src/email.ts`; May plan router `2026-05-01-guild-email-and-payment-page.md:993-1010` |
| Apps Script auth: `payload.secret` is compared with the Script Property `SHARED_SECRET`. The secret is not in the code. | May plan, Task 2 |
| Known test functions call `Session.getActiveUser()`, which needs the `userinfo.email` scope. | `2026-05-01-registration-confirmation-email.md:378`, `2026-05-01-guild-email-and-payment-page.md:1033`, `docs/store-link-apps-script-snippet.md:128` |
| A deployment serves a **fixed version**, while the editor holds the latest *saved* code. The two can differ. Live code changes via *Manage deployments → edit → New version*, which keeps the URL. | developers.google.com/apps-script/concepts/deployments; `docs/event-timing-apps-script-snippet.md:97-98` |
| Worker secrets are **write-only**: the current `APPS_SCRIPT_URL` cannot be read back. Secrets are **stored per worker version**, so a `wrangler rollback` to an older version also restores that version's `APPS_SCRIPT_URL`. | Cloudflare docs; wrangler 4.81.1 rollback prompt |
| The worker currently serves **one version at 100%** (`ba2be757…`, deployed 2026-10-22), so `wrangler secret put` will work. | `npx wrangler deployments status`, 2026-10-23 |
| Volume: peak **22** registrations in a day (2026-08-11), about **31 recipients** that day counting waitlist and Guild emails. About 6 bookings on an active day. MailApp quotas count **recipients**, and are lower for trial and new domains. | Supabase queries; developers.google.com/apps-script/guides/services/quotas |
| Cancelling a **pending** booking refunds no credits and restores no promo uses. REPLAY pass claims are released either way. | `worker/src/cancel.ts:30-62` |
| Registering overwrites `users.name` / `users.email` for that phone number and creates and converts a lead. Pending seats count toward capacity until cancelled. | `register.ts:88, 166-168` |
| Recovery data: `registrations` stores its own `name`, `phone`, `email`. Waitlist joins live in `leads` (`waitlist_at`, `updated_at`). `guild_path_members` has **no** `created_at`. | migrations 001/002; `waitlist.ts:108-124` |
| This repo is **public**. No URL or secret from this plan may be committed. | `gh repo view` |
| REPLAY's script uses `GmailApp.sendEmail(..., { from: 'hello@boardgamecompany.in', name: 'REPLAY' })` with Script Property `WEBHOOK_SECRET`. REPLAY's docs place the alias on `boardgamecompany2024@gmail.com`. Marketing sends also go through that alias. | `replay-website/apps-script/Code.gs:5,32-35`; `replay-website/docs/reference/REPLAY3_EMAIL_HANDOFF.md:25-28`; `replay-website/marketing/replay-3/send-log.md:12-13` |

---

## Ground rules for the whole procedure

1. **Freeze the old project.** From Step 1 until the soak ends, don't edit or redeploy the old BGC project. If a template change is unavoidable during the soak, make it in the *new* project only, and accept that a rollback would lose it.
2. **One Chrome profile per Google account.** The Apps Script editor doesn't support several signed-in accounts in one browser. Profile A is the Gmail account; profile B is `hello@` only.
3. **Secrets never go into chat, the repo, or shell history.** Keep `OLD_URL`, `NEW_URL` and `SHARED_SECRET` in your password manager. The smoke-test script reads them interactively and passes the secret on stdin only.
4. **Work in a quiet window.** Avoid the hours after an event announcement or poster drop, and have about an hour to watch logs after the flip.

---

## Step 0 — Preconditions (all must be true before Step 2)

- [ ] **P1. Workspace billing is active.** If the trial lapses, the `hello@` inbox *and* the moved script both stop. Admin console → Billing shows a paid subscription.
- [ ] **P2. DKIM signing is active.** Send an email from `hello@` (Gmail web) to a personal address. "Show original" must show SPF, DKIM and DMARC **PASS**, with DKIM `d=boardgamecompany.in`.
- [ ] **P3. The Workspace allows the web app.** Under Admin console → Apps → Google Workspace:
  - *Drive and Docs → Sharing settings → Sharing outside of boardgamecompany.in* = **ON**. This is needed for "Anyone" access.
  - *Drive and Docs → Google Apps Script* (or *Additional Google services → Google Apps Script*) = **ON**.
- [ ] **P4. `wrangler` is ready.** From `worker/`:
  - `npx wrangler whoami` shows the BGC account.
  - `npx wrangler deployments status` shows a **single version at 100%**. A split rollout makes `secret put` refuse.
- [ ] **P5. `jq` and `curl` are present** (`/usr/bin/jq`, `/usr/bin/curl` on macOS).
- [ ] **P6. Someone reads the `hello@` inbox.** After the flip, replies to confirmations, bounces, and DMARC reports all land there. Sign `hello@` into the Gmail app on your phone. Also check the account's display name: the DD notification sets no `name`, so it shows the account default.

## Step 1 — Inventory the old project (read-only; profile A)

- [ ] 1.1 Open script.google.com and find the BGC email project. In Overview, confirm it is **standalone**, not bound to a Sheet or Doc. Record the **Project OAuth Scopes** shown there.
- [ ] 1.2 Project Settings → tick **Show "appsscript.json"**. Record the file list, and from the manifest: `timeZone`, `oauthScopes`, the `webapp` block, `dependencies` and `runtimeVersion`.
- [ ] 1.3 **Script Properties:** record every name. Store `SHARED_SECRET` (and any others) in your password manager.
- [ ] 1.4 **Triggers** (clock icon). Expected: none. Any trigger → **stop**; it must be recreated in the new project, and this plan needs a step for that.
- [ ] 1.5 **Deploy → Manage deployments.** Record each active Web app deployment: description, **version number**, *Execute as*, *Who has access*, URL. Save the URL in use as **`OLD_URL`** in your password manager. Cloudflare can't show it to you, so it's your main rollback path. If several deployments are active, the one in use has recent `doPost` runs under Executions.
- [ ] 1.6 **Deployed code vs saved code.** Open Project History (clock-arrow icon) and view the deployed **version** from 1.5. Compare it file by file with the current editor code.
  - If they match, carry on.
  - If they differ, the saved code holds edits that were never deployed. The move deploys **the version that is live today**. Undeployed edits become a separate change after the soak.
- [ ] 1.7 **Map the router.** In `doPost`, record the **exact reply sent for a wrong secret** (the May design returns `{"error":"unauthorized"}`; the live code may differ). Then record which `type` values have their own branch, and each branch's subject and sender `name`. Confirm the four worker types (`event_registration`, `guild_purchase`, `event_waitlist`, `dd_submission`). Any type without a branch falls through to the event email; note it. The smoke test then shows the same thing on both URLs, which still counts as parity.
- [ ] 1.8 **Dependency check.** Search every file for `SpreadsheetApp`, `DriveApp`, `DocumentApp`, `CalendarApp`, `GmailApp`, `UrlFetchApp`, `getUserProperties`, `getDocumentProperties`, `LockService`, `CacheService`, `ScriptApp`, `Session.`.
  - Allowed: `MailApp`, `ContentService`, `PropertiesService.getScriptProperties`, `Utilities`, `Logger`, plus `Session.getActiveUser` **inside `test*` functions only**.
  - **Any other hit → stop**, and work out what the resource is and whether `hello@` can reach it. A `GmailApp` hit in particular changes the scopes and makes the sender logic behave differently.
- [ ] 1.9 **Back up** the deployed version's code (from 1.6) and `appsscript.json` into a folder **outside this repo**, e.g. `~/Documents/bgc-apps-script-2026-10-23/old/`.

## Step 2 — Copy the project into `hello@`

- [ ] 2.1 (Profile A) In Drive, **Share** the script file with `hello@boardgamecompany.in` as **Viewer**.
- [ ] 2.2 (Profile B) Open it → Overview (ⓘ) → **Make a copy**. If the option is greyed out, change the share to Editor and retry.
- [ ] 2.3 Rename the copy to **BGC Email (Workspace)**. Overview must show the owner as `hello@boardgamecompany.in`.
- [ ] 2.4 If 1.6 found a difference, replace the copy's code with the **deployed version's** code from the 1.9 backup.
- [ ] 2.5 **Diff.** Enable the manifest in the copy and paste each file into `~/Documents/bgc-apps-script-2026-10-23/new/`. Then run:
  ```bash
  diff -r ~/Documents/bgc-apps-script-2026-10-23/old ~/Documents/bgc-apps-script-2026-10-23/new
  ```
  Expected: no output. **Make zero code changes in this move.** `FROM_ADDRESS` stays as it is; it is harmless with MailApp.
- [ ] 2.6 **Script Properties: check, then add whatever is missing.** Each property from 1.3 must exist with the **same value**. Reusing the secret keeps rollback to a one-value change.
- [ ] 2.7 Triggers: none. Services must match the manifest.

## Step 3 — Authorize, check Sent and quota (profile B)

- [ ] 3.1 Run an existing test function, e.g. `testSendEmailToSelf`. On the consent screen, the scopes must be **exactly the set recorded in 1.1/1.2**. If 1.6 found a difference, compare against the `oauthScopes` in the **deployed version's** manifest (1.9 backup) instead, because the Overview scopes reflect the saved code. Expect "Send email as you" plus "See your primary email address" (the latter from `Session`). Anything else → stop.
- [ ] 3.2 The test email must land in the `hello@` inbox **and** appear in `hello@`'s **Sent** folder. Steps 5.3 and 5.4 rely on the Sent folder.
- [ ] 3.3 **Quota.** Add a temporary file `zz_quota.gs` containing `function zzQuota() { Logger.log(MailApp.getRemainingDailyQuota()); }`. Run it, read the log, then **delete the file before deploying**. Pass: **≥ 60** (peak observed demand is about 31 recipients/day). Below 60 → don't cut over yet; new and trial domains ramp up.

## Step 4 — Deploy, then prove parity with the old endpoint (worker untouched)

- [ ] 4.1 (Profile B) **Deploy → New deployment** → **Web app**. Description `BGC email – Workspace v1`. Execute as **Me (hello@boardgamecompany.in)**. Who has access **Anyone**. If "Anyone" isn't offered → P3.
- [ ] 4.2 Save the web app URL as **`NEW_URL`**. Prefer the `https://script.google.com/macros/s/<id>/exec` form. If the dialog shows `…/a/macros/boardgamecompany.in/s/<id>/exec`, use whichever form the smoke test reaches **anonymously**, i.e. returns JSON rather than a sign-in page.
- [ ] 4.3 Create `scripts/apps-script-smoke.sh` from **Appendix A** (no secrets in it). Run it **in your own terminal**, never through Claude, once per URL, saving the output:
  ```bash
  bash scripts/apps-script-smoke.sh > ~/Documents/bgc-apps-script-2026-10-23/smoke-old.txt   # enter OLD_URL
  bash scripts/apps-script-smoke.sh > ~/Documents/bgc-apps-script-2026-10-23/smoke-new.txt   # enter NEW_URL
  diff ~/Documents/bgc-apps-script-2026-10-23/smoke-old.txt ~/Documents/bgc-apps-script-2026-10-23/smoke-new.txt
  ```
  **Pass criteria (all required):**
  - The two runs report **different URL endings** on stderr. This proves you didn't test `OLD_URL` twice.
  - Both runs exit 0. That means every reply was JSON (no HTML sign-in page) and the wrong-secret probe was not accepted.
  - **`diff` prints nothing.** Every probe answered the same way on both URLs, including the exact wrong-secret reply recorded in 1.7 and any type both scripts don't handle.
  - No `slow` warnings on stderr. A request over 20 s risks the worker's 30 s `waitUntil` cut-off.
  - Each URL sends **one email per type its router handles** (1.7), none for the wrong-secret probe, and **the same set from both**. The two sets are **identical except the sender**. The old set shows `boardgamecompany2024@gmail.com`; the new set shows `Board Game Company <hello@boardgamecompany.in>`. Compare subject, sender name, body, UPI block, dates (including the multi-day all-day one) and the DD attachment.
  - On one new email, "Show original" shows SPF **PASS**, DKIM **PASS** `d=boardgamecompany.in`, DMARC **PASS**, and no "via".
  - If you have an Outlook, Yahoo or iCloud address, run the NEW_URL test once more to it and confirm the emails land in the **inbox**, not spam. This is the first mail sent as `boardgamecompany.in`.
  - The 6 new-project executions all exist. "Completed" alone proves nothing (see Facts); the emails are the proof.

  Any failure → **stop**. Nothing in production has changed.

## Step 5 — Cut over (flip one secret)

- [ ] 5.1 `cd worker && npx wrangler deployments status`. Record the version ID as **`V_PRE`**.
- [ ] 5.2 Flip the secret, pasting `NEW_URL` at the prompt with no quotes or trailing spaces:
  ```bash
  cd worker && npx wrangler secret put APPS_SCRIPT_URL
  ```
  This deploys a new version that differs **only** by that secret; local code isn't uploaded. Run `npx wrangler deployments status` again and record the new ID as **`V_POST`**, plus the time as **`T_FLIP`** (IST).
- [ ] 5.3 **Start the log tail after the flip,** so it attaches to the new version, and keep a copy:
  ```bash
  cd worker && npx wrangler tail --format json | tee ~/Documents/bgc-apps-script-2026-10-23/tail.jsonl | grep --line-buffered '\[email\]'
  ```
- [ ] 5.4 **End-to-end through the real site.** Register for an upcoming **free** event on boardgamecompany.in, 1 seat, with **your own** phone, name and email. Registering overwrites the name and email stored for that phone, so use the real ones.
  - On a free event nothing is spent. Credits only apply when something is owed, a promo is kept when the total is already 0 (`register.ts:287`), and cancelling releases REPLAY claims and refunds plus-ones (`cancel.ts:57-93`). Only two things matter: the event has spare seats, and it doesn't start at the same moment as another booking on your number.
  - If there's no free event, use a paid one and leave it **pending**. Then use a number holding **no** credits and **no** active promo, which you can check in the admin phone lookup, because cancelling a pending booking doesn't refund them.
  - Either way, avoid events that are Guild-Path-only or externally managed.
  - Pass:
    - The confirmation arrives within a minute from `hello@` and its headers pass as in 4.3.
    - It is in `hello@`'s Sent folder and **not** in the Gmail account's.
    - The tail shows no `[email]` lines.
    - The old project's Executions shows no new run.
  - Clean up: cancel the booking in the admin tool. The lead it created stays, marked converted, which is harmless.
- [ ] 5.5 **Reconcile daily for the first 3 days, then spot-check through the soak.** Count each day's sends with the queries in Step 6 and compare against `hello@`'s Sent folder for the same day. The old project's Executions must show **no runs after `T_FLIP`**, which proves all traffic moved. Worker logs aren't stored, so this count is the main detector. Any booking without a matching sent email → rollback.

## Step 6 — Rollback (any time during the soak)

Roll back on any failed check in Step 5, any `[email]` error, or any report of a missing confirmation.

- **Preferred:** put the old URL back. Same secret, so nothing else changes.
  ```bash
  cd worker && npx wrangler secret put APPS_SCRIPT_URL   # paste OLD_URL
  ```
- **Alternative,** only if no other worker code has been deployed since the flip: `npx wrangler rollback V_PRE`. It restores the old secret along with the old code.

The old deployment is still serving (ground rule 1), so either path works until Step 7.1.

**Who missed an email.** Replace the timestamps; the `+05:30` matters because Supabase runs in UTC:
```sql
-- Event confirmations (public and admin manual)
select created_at, name, phone, email from registrations
 where email is not null and email <> ''
   and created_at between '<T_FLIP>+05:30' and '<T_ROLLBACK>+05:30'
 order by created_at;

-- Waitlist joins (a re-join re-sends the email and bumps updated_at)
select updated_at, name, phone, email from leads
 where waitlist_at is not null
   and updated_at between '<T_FLIP>+05:30' and '<T_ROLLBACK>+05:30'
 order by updated_at;

-- Guild purchases (no created_at; starts_at is a UTC date, so this is day-granular — over-includes)
select g.starts_at, g.tier, u.name, u.phone, u.email
  from guild_path_members g join users u on u.id = g.user_id
 where coalesce(g.source, '') <> 'community_host'
   and g.starts_at between '<flip date, UTC>' and '<rollback date, UTC>';
```
Compare these with `hello@`'s Sent folder, and message anyone who didn't get an email on WhatsApp.

## Step 7 — Soak (14 days), then clean up

**7.1 can happen after BGC's own 14-day soak. 7.2 and 7.4 are gated.**

- [ ] 7.1 Old BGC project (profile A) → Manage deployments → **Archive** the web app deployment. Once it's archived, rollback means redeploying it, so add the AGENTS.md gotcha below **before** archiving.

**Gate before 7.2 and 7.4.** Every sender of `@boardgamecompany.in` mail must already send from the Workspace account:
- [ ] **REPLAY's Apps Script** moved to `hello@` with its own plan, written against `replay-website`. It differs in three ways: it uses `GmailApp` with `from`, so the full Gmail scope; its secret is `WEBHOOK_SECRET`; and requests are HMAC-signed with the signature in a query parameter. Its smoke test differs too. It has its own soak.
- [ ] **REPLAY marketing sends** go from the `hello@` Workspace account directly, with the Gmail connector re-authorised as `hello@`.
- [ ] **Every "Send mail as" user** of any `@boardgamecompany.in` address is listed and moved. That includes team members' personal Gmails for the old ImprovMX addresses (`amrit@`, `siddhant@`, `suranjana@`, `swapnil@`). Rare senders may not show up in 14 days of reports, so ask the people involved.
- [ ] DMARC aggregate reports show only aligned Google sources for **14 days after** the last of those moves.

Then, in order:
- [ ] 7.2 Gmail account → Settings → Accounts and Import → **Send mail as** → delete `hello@boardgamecompany.in`.
- [ ] 7.3 Remove `hello@`'s Viewer access to the old project, and delete `~/Documents/bgc-apps-script-2026-10-23/tail.jsonl`, which holds request IPs and URLs (tidy-up).
- [ ] 7.4 Cloudflare DNS: set `_dmarc` to `v=DMARC1; p=quarantine; rua=mailto:hello@boardgamecompany.in`. Watch reports for a further 2–4 weeks before considering `p=reject`.
- [ ] 7.5 *(Optional, separate change)* Rotate `SHARED_SECRET`. To avoid any failed sends during the swap, first make `doPost` temporarily accept either `SHARED_SECRET` or `SHARED_SECRET_NEXT` (a code change, deployed as a new version). Then set the worker secret, then drop the old value.

## Step 8 — Repo, docs and memory (after 5.4 passes)

- [ ] **`AGENTS.md`**, in the Email line and Gotchas:
  - The Apps Script lives in the `hello@boardgamecompany.in` Workspace account and sends with MailApp. MailApp ignores `from`; the sender is whichever account runs the script.
  - The secret travels in the request body and is checked against Script Property `SHARED_SECRET`.
  - Update live code only via *Manage deployments → edit → New version*. Never use *New deployment*, which changes the URL.
  - Test any endpoint with `scripts/apps-script-smoke.sh`.
  - **A `wrangler rollback` to any version older than the cutover's `V_POST` (record its ID here) brings back the old, archived `APPS_SCRIPT_URL`.** After any such rollback, `wrangler secret put APPS_SCRIPT_URL` again.
  - **After any `hello@` password or security change, re-run the smoke test.** OAuth grants can be revoked by password changes.
- [ ] **`docs/store-link-apps-script-snippet.md:159-162`** — replace "edits are live on save — there is no deploy step" with the *Manage deployments → edit → New version* instruction.
- [ ] **`docs/dd-apps-script-snippet.md`** — line 8's fallback recipient and line 46's smoke-test inbox → `hello@boardgamecompany.in`.
- [ ] *(Separate, optional)* `DD_SUBMISSION_EMAILS` (`worker/wrangler.toml:25`) and the `dd-submit.ts:103` fallback → `hello@`. This needs a full `wrangler deploy` of local code: do it from an up-to-date `main`, not on cutover day.
- [ ] Commit `scripts/apps-script-smoke.sh`, this plan, and the doc edits.
- [ ] Update Claude's memory: BGC's sender is now `hello@`; the old "send-as alias" claim was wrong for BGC and right for REPLAY.

## Out of scope / follow-ups

- **REPLAY's script and marketing move.** This is a separate plan, but it **gates** 7.2 and 7.4.
- **Put BGC's `Code.gs` under version control** (clasp → `apps-script/`), as REPLAY already has. Confirm no secrets in the code first (the repo is public).
- **Undeployed edits found in 1.6,** if any.
- **Persistent worker logs:** add `[observability]` `enabled = true` to `worker/wrangler.toml`, then commit and push **before** deploying. A deploy from a config without the block switches logs off again. Deploy only after confirming no worker commit is newer than the live version's "Created" time in `wrangler deployments status`, so the deploy ships nothing but the logs block. Keep this off cutover day.
- Phase 5: mail import, forwarding, and moving service logins.

## Risks and how this plan covers them

| Risk | Covered by |
|---|---|
| Email failure is silent (`waitUntil`, logs only and not stored, DD swallows errors) | Endpoint parity before the flip (4.3); tail on cutover day (5.3); E2E (5.4); daily reconciliation against the Sent folder (5.5) |
| A code deploy slipping into the cutover | The cutover is secret-only (5.2); persistent logs are a separate follow-up with a check against live |
| "Completed" executions hide failed sends | Emails and the Sent folder are the proof (4.3, 5.4, 5.5), not Executions |
| Deploying untested saved-but-undeployed code | 1.5–1.6, 2.4–2.5: copy the **deployed version** |
| The copy misses properties, triggers, files, libraries | 1.1–1.4, 1.8, 2.5–2.7, wrong- and right-secret probes |
| A type the live router doesn't handle | 1.7; parity (`diff`) instead of absolute expectations |
| The web app isn't reachable anonymously | P3, 4.2; JSON-not-HTML check |
| New sender identity lands in spam | P2; header check and non-Gmail inbox test (4.3) |
| Quota too low on a new or trial domain | P1, 3.3 (≥ 60 against a ~31 peak) |
| Subscription lapses → inbox and email both stop | P1 |
| Losing the rollback path (secrets are write-only) | 1.5 `OLD_URL`; 5.1 `V_PRE` |
| A future worker rollback silently restores the archived URL | AGENTS.md gotcha before 7.1 |
| A `hello@` password change revokes the script's authorization | AGENTS.md gotcha; re-run the smoke test |
| Breaking REPLAY or marketing mail by removing the alias or tightening DMARC | Step 7 gate |
| Replies and bounces unread in the new inbox | P6 |
| Wrong Google account in the editor | Ground rule 2 |
| The secret leaking into history, `ps`, chat or the repo | Ground rule 3; the script passes the secret only on stdin |
| The E2E booking costs someone credits, a promo or a seat | 5.4 conditions and cleanup |
| Template edits landing in one project only | Ground rule 1 |

---

## Appendix A — `scripts/apps-script-smoke.sh`

```bash
#!/usr/bin/env bash
# Smoke-test a BGC email Apps Script web app directly, without the worker.
#
#   bash scripts/apps-script-smoke.sh > smoke-old.txt   # against the old URL
#   bash scripts/apps-script-smoke.sh > smoke-new.txt   # against the new URL
#   diff smoke-old.txt smoke-new.txt                    # parity: expect no output
#
# Sends one real email of every type the worker uses to the address you give,
# plus a wrong-secret probe that must be refused. Stdout carries one line per
# probe ("label<TAB>reply") so two runs can be diffed; prompts, timings and
# warnings go to stderr. The secret is read silently and reaches curl only via
# stdin, so it never appears in shell history, on a command line, in an
# environment block, or in the output. Every name is prefixed [TEST].
#
# Exit status is non-zero if any reply is not JSON (e.g. a Google sign-in page,
# meaning the deployment is not anonymously reachable) or the wrong secret was
# accepted. Everything else (the exact refusal text, whether each type
# succeeded) is judged by diffing two runs: the new endpoint must answer
# exactly as the old one does.
set -euo pipefail

read -rp  "Web app URL (ends in /exec): " URL
read -rsp "SHARED_SECRET: " SECRET; echo >&2
read -rp  "Send test emails to: " TO
# Distinguishes the two runs at a glance without printing the whole URL.
printf 'Testing URL ending …%s\n' "$(printf '%s' "$URL" | tail -c 16)" >&2

PROBLEMS=0

# $1 label, $2 JSON payload (no secret), $3 secret, $4 "refuse" for the wrong-secret probe
probe() {
  local out reply meta code secs
  out=$(printf '%s' "$3" |
    jq -Rc --argjson p "$2" '$p + {secret: .}' |
    curl -sS -L --max-time 60 -H 'Content-Type: application/json' \
      --data-binary @- -w '\n%{http_code} %{time_total}' "$URL") || out=$'<request failed>\n000 0'
  # No -X POST above: on Apps Script's 302, curl must switch to GET to fetch the result.
  meta=${out##*$'\n'}
  reply=${out%$'\n'*}
  code=${meta%% *}
  secs=${meta##* }

  printf '%s\t%s\n' "$1" "$reply"

  if ! jq -e . >/dev/null 2>&1 <<<"$reply"; then
    printf 'NOT JSON  %-32s http=%s  %.160s\n' "$1" "$code" "$reply" >&2
    PROBLEMS=$((PROBLEMS + 1))
  elif [ "${4:-}" = refuse ] && ! jq -e '(.success == true) | not' >/dev/null <<<"$reply"; then
    printf 'ACCEPTED A WRONG SECRET %-18s %s\n' "$1" "$reply" >&2
    PROBLEMS=$((PROBLEMS + 1))
  else
    printf 'answered  %-32s http=%s  %ss\n' "$1" "$code" "$secs" >&2
  fi
  if awk -v s="$secs" 'BEGIN { exit !(s > 20) }'; then
    printf 'slow      %-32s %ss (worker cuts waitUntil work at 30s)\n' "$1" "$secs" >&2
  fi
}

UPI='{"id":"suranjanadatta24-1@okaxis","payee_name":"Board Game Company"}'

EVENT=$(jq -n --arg to "$TO" --argjson upi "$UPI" '{
  type: "event_registration", to: $to, name: "[TEST] Cutover",
  event: { name: "[TEST] Workspace cutover", date: "2026-11-08T19:00:00+05:30",
           end_date: null, is_all_day: false, venue_name: "Test Venue",
           venue_area: "Indiranagar", price_includes: "Snacks and one drink" },
  seats: 2, total_amount: 900, discount_applied: null,
  custom_questions: [ { id: "q1", label: "Played before?", answer: "Yes" },
                      { id: "q2", label: "Need a teach?", answer: true } ],
  upi: $upi,
  payment_url: "https://boardgamecompany.in/pay?amount=900&for=%5BTEST%5D%20Workspace%20cutover" }')

EVENT_MULTIDAY=$(jq -c '.event.name = "[TEST] Multi-day all-day"
  | .event.date = "2026-11-13T00:00:00+05:30" | .event.end_date = "2026-11-15T00:00:00+05:30"
  | .event.is_all_day = true | .seats = 1 | .total_amount = 0
  | .payment_url = "https://boardgamecompany.in/pay?amount=0&for=%5BTEST%5D%20Multi-day%20all-day"' <<<"$EVENT")

GUILD=$(jq -n --arg to "$TO" --argjson upi "$UPI" '{
  type: "guild_purchase", to: $to, name: "[TEST] Cutover",
  tier_key: "adventurer", tier_name: "Adventurer", period_months: 3,
  starts_at: "2026-10-23", expires_at: "2027-01-23", total_amount: 1500,
  upi: $upi,
  payment_url: "https://boardgamecompany.in/pay?amount=1500&for=Adventurer%20(Guild%20Path)" }')

WAITLIST=$(jq -n --arg to "$TO" '{
  type: "event_waitlist", to: $to, name: "[TEST] Cutover", seats: 1,
  event: { name: "[TEST] Waitlist", date: "2026-11-08T19:00:00+05:30", end_date: null,
           is_all_day: false, venue_name: "Test Venue", venue_area: "Indiranagar" } }')

DD=$(jq -n --arg to "$TO" '{
  type: "dd_submission", to: [$to], name: "[TEST] Cutover", phone: "0000000000",
  email: $to, submission_id: "00000000-0000-0000-0000-000000000000",
  script_json: [ { id: "_meta", name: "[TEST] Cutover script", author: "BGC" }, "washerwoman", "imp" ] }')

probe "wrong secret"                   "$EVENT"          "not-the-secret" refuse
probe "event_registration"             "$EVENT"          "$SECRET"
probe "event_registration (multi-day)" "$EVENT_MULTIDAY" "$SECRET"
probe "guild_purchase"                 "$GUILD"          "$SECRET"
probe "event_waitlist"                 "$WAITLIST"       "$SECRET"
probe "dd_submission"                  "$DD"             "$SECRET"

echo >&2
if [ "$PROBLEMS" -eq 0 ]; then
  echo "Every probe answered with JSON and the wrong secret was not accepted." >&2
  echo "Now diff this run's stdout against the other URL's, and compare the emails at $TO." >&2
else
  echo "$PROBLEMS problem(s) above — do not cut over." >&2
  exit 1
fi
```
