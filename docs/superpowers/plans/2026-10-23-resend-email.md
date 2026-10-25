# Send BGC's emails through Resend (replaces the Apps Script)

**Goal:** the worker sends BGC's transactional emails (event registration, waitlist, Guild purchase, Demon's Draft notification) **itself, through Resend**, from `Board Game Company <hello@boardgamecompany.in>`.
- Emails are DKIM-signed by `boardgamecompany.in`.
- The templates live in this repo, under version control and covered by tests.
- The Google Apps Script and its Gmail account drop out of the sending path.

**Supersedes** `2026-10-23-apps-script-workspace-move.md`, which copied the Apps Script into the Workspace account. That plan's analysis still applies: the REPLAY gate for removing the Gmail alias and tightening DMARC, and the silent-failure risks.

**Shape of the change:**
1. Port `Code.gs` into the worker as pure TypeScript template functions. The port is faithful: the same HTML byte for byte, the same subjects.
2. Add a small Resend client, and a router controlled by **one secret, `EMAIL_PROVIDER`**:
   - Unset: today's Apps Script path, with the same request as before.
   - `resend`: Resend, falling back to the Apps Script if Resend fails.
3. Deploy with the switch unset, which changes nothing in behaviour. Test Resend directly, then flip the secret.

Rollback is clearing the secret, with no code deploy.

**Operator split:**
- **Claude** writes the code, tests and parity checks.
- **Siddhant** creates the Resend account (Claude can't create accounts), adds 3 DNS records, creates the API key, and runs every `wrangler` command and the live test.

**Status (2026-10-23):** Part C is done and verified (see Verification results). Nothing is committed, deployed or configured yet. The plan was independently reviewed: no blockers, and 13 findings, all folded in below.

---

## Facts this plan relies on (verified 2026-10-23)

| Fact | Source |
|---|---|
| The live Apps Script (**BGC Registration Email**, last edited 2026-08-31) has been exported: 400 lines, plus a manifest with `timeZone: Asia/Kolkata`, V8, `executeAs: USER_DEPLOYING`, `access: ANYONE_ANONYMOUS`. It parses as JS, and the JSON export decoded with no corrupt characters. **This is the source of the port.** | Drive export via the connector; kept in the scratchpad, not the repo |
| **Live router:** `dd_submission` → plain-text email with a JSON attachment, no sender name. `guild_purchase` → subject `[BGC] Welcome to the Guild — <tier>!`. `event_waitlist` → `[BGC] You're on the waitlist for <event>`. Everything else → `[BGC] You're registered for <event>!`. Sender name `Board Game Company`. | live `Code.gs:6-49, 253-272` |
| Today's emails come **from `boardgamecompany2024@gmail.com`**, signed `d=gmail.com`; MailApp ignores `from`. They're multipart, with an auto-generated text/plain part. | Raw headers of a confirmation sent 2026-10-22 |
| **Resend API:** `POST https://api.resend.com/emails` with `Authorization: Bearer`. It **generates the text part from the HTML** when `text` is omitted, so the plain-text version will be worded slightly differently from MailApp's. The HTML is identical. Attachments take `{ filename, content: base64 }`. | resend.com/docs: send-email |
| **Resend behaviour:** `Idempotency-Key` is kept for 24 h, and returns 409 if the key is reused with a different payload or while the first request is still running. The rate limit is 10 requests/s per team. Quota errors come back as 429 `daily_quota_exceeded` / `monthly_quota_exceeded`. **A missing `User-Agent` gets a 403 (error 1010).** | resend.com/docs: idempotency-keys, api introduction |
| **Resend DNS on Cloudflare:** TXT `resend._domainkey` (DKIM) plus the return-path records on `send`, all **DNS only**. The docs list an MX and a TXT; what Resend actually issued on 2026-10-25 is a CNAME `send` → `send.forge.rmta.net` (see R2). **Turning on Inbound adds a root MX record and takes over all incoming mail, so never turn it on.** Resend recommends sending from a subdomain; here the root domain is chosen deliberately, so the visible address stays `hello@boardgamecompany.in`, and it shares reputation with the Workspace mailbox. | resend.com/docs: knowledge-base/cloudflare, custom-return-path |
| **Free plan:** 3,000 emails a month, 100 a day, 30-day log retention. BGC's busiest day was about 31 recipients. | resend.com/pricing |
| **Time limit:** every email send runs in `ctx.waitUntil`, which stops 30 s after the response. The call sites are unchanged. | Cloudflare docs; `register.ts:396`, `admin/register-manual.ts:402`, `guild-purchase.ts:134`, `waitlist.ts:135`, `dd-submit.ts:109` |
| **`main` matches production:** the live version `ba2be757` was created 2026-10-22 21:01 IST, and the newest worker commit `cc189eb` is from 21:00 IST that day. | `wrangler deployments status`, `git log -- worker/` |
| **Logs:** Workers Logs keep 3 days on the free Workers plan (7 on paid). A deploy whose config lacks `[observability]` turns them off again. | Cloudflare docs; wrangler 4.81.1 source |
| **Secrets and versions:** secrets are stored per worker version. `wrangler rollback` restores the old version's secrets. `wrangler secret put` / `delete` refuse when the latest version isn't the deployed one (error 10215). | wrangler 4.81.1 source |
| The repo is **public**. No API key, URL or real customer data goes into it. | `gh repo view` |

---

## Design (implemented)

### Files
- **`worker/src/email-templates.ts`** (new, pure): a port of the live `Code.gs`.
  - `render*Email(payload)` returns `{ to[], subject, html | text, attachments? }`. The builder functions keep the script's concatenation, line for line.
  - **IST formatting uses arithmetic, not `Intl`:** shift by +5:30, which is exact since India has no daylight saving, and use fixed English names. This reproduces Java's `SimpleDateFormat` exactly: `Sep` not `Sept`, `6:00 PM` with an ordinary space, not U+202F.
  - An invalid date **throws**, as the script did, rather than rendering `NaN`.
  - The WhatsApp constants now live here; they're in the repo and findable with grep, so they can't drift silently.
- **`worker/src/resend.ts`** (new): `sendViaResend(apiKey, email, type)`, which **never throws**.
  - Sends `User-Agent: bgc-worker` and one `Idempotency-Key` (a random UUID) per email, reused on the retry.
  - Each attempt has a **4 s** timeout, using a plain timer so tests can fake the clock.
  - **Retries:** one retry after 1 s on no reply, a timeout, 429 or 5xx. Never on 400/401/403/404/422 or other 409s.
  - **A third attempt**, after 2.5 s, only when the second gets 409 `concurrent_idempotent_requests`. That's the realistic case: attempt 1 timed out on our side but reached Resend. Waiting returns its outcome instead of falling back and sending twice. A fresh key can't get this 409 on attempt 1.
  - Worst case is 15.5 s: timeout, then a late 409, then a timeout.
  - The result says `ambiguous: true` when Resend **may** have accepted the email: no reply, a timeout, a 5xx, or a concurrent 409.
  - Email addresses are redacted from error text, and the text is capped at 300 characters.
- **`worker/src/email.ts`** (changed): the `send*Email(payload, env)` exports keep their signatures and payload types. The types are re-exported, so call sites don't change.
  - `EMAIL_PROVIDER` is compared after trimming and lowercasing. Only `resend` means Resend. An unknown value logs a warning and uses the Apps Script.
  - `RESEND_API_KEY` is trimmed, since a pasted secret can carry a newline.
  - **Resend path:** render inside try/catch, then send.
    - On success, log `[email] sent via resend type=<t> id=<id>`.
    - On failure, or if rendering threw, fall back to the Apps Script with a **12 s timeout**, and log the start and the result (`sent via apps script fallback`).
    - An ambiguous failure logs `possible duplicate`: **a duplicate is preferred to a lost email**.
    - Any path where the email doesn't go out logs **`email not sent`**: the fallback refused it, the fallback failed, or no fallback is configured.
  - **Apps Script as the primary sender:** the request and its behaviour are **unchanged**, pinned by a strict-equality test, including no timeout and a thrown network error reaching the caller's `.catch`.
    - The only difference is that its error replies are now **redacted** before logging, since MailApp errors can quote the address and the logs are now kept.
  - **Worst case:** 15.5 s of Resend plus 12 s of fallback is 27.5 s, under 28 s, proven with fake-clock tests for both the all-hang path and the slowest timeout, late-409, timeout path.
- **`worker/src/index.ts`**: `Env` gains `EMAIL_PROVIDER?`, `RESEND_API_KEY?`.
- **`worker/wrangler.toml`**: `[observability] enabled = true`, with `[observability.logs] invocation_logs = false` (console output only, so no request metadata is stored). The secrets comment is updated.
- **`worker/src/email.live.test.ts`**: the gated live test, skipped unless `RESEND_LIVE_TEST=1`. With that set, it **fails** if the key or recipient is missing, and its failure messages show only the status and error.

### Message details
- From `Board Game Company <hello@boardgamecompany.in>` for all types, DD included; today's DD email has no sender name. No Reply-To: replies go to `hello@`.
- DD sends text plus `script-<id>.json`, as UTF-8 then base64. HTML emails omit `text`, so Resend generates it.
- Tags: `type=<payload type>`. Open and click tracking **off**.
- Recipient addresses are never logged, which a test asserts.

---

## Verification results (Part C, 2026-10-23)

1. **Live code vs port:** the live `Code.gs` was run in Node's `vm` with an `Intl`-based emulation of Java dates, independent of the port's arithmetic. Over **78 synthetic payloads**, subject, recipients and HTML (or DD text and attachment) are **all byte-identical**. That covers every date shape (midnight rollover, noon, same-day ranges, multi-day within a month, across months and across years, all-day), HTML escaping, every template branch, and Unicode attachments.
2. **Deployed output vs port:** **3 real sent emails** (a waitlist from 2026-10-23, a free Guild Path booking with selections, a paid booking with UPI and emoji) were reproduced **byte for byte**. All three include the store-link footer, so the deployed version matches the saved code.
   - The September abbreviation was checked against Siddhant's **own** confirmation from 2026-09-24, which reads `Sat, 26 Sep 2026 · 5:00 PM`: the deployed script writes `Sep`, as the port does.
   - **Privacy note:** the 3 emails were customers' bookings, so their first names and addresses passed through the Claude session. The scratch copies are deleted. Any later real-email check uses Siddhant's own bookings.
3. **Tests:** 69 new (27 templates, 20 Resend client, 22 router). The full worker suite passes and `tsc` is clean (counts in the final report).
4. **Mutation check:** 10 deliberate bugs, **all caught**:
   - no third attempt after a concurrent 409, or an attempt timeout too long for the budget;
   - no `User-Agent`;
   - Apps Script error logged unredacted, an untrimmed key, a silent fallback refusal, or an over-long fallback timeout;
   - a changed Apps Script request;
   - `pm` for `PM`, or `Sept`.
5. **Build:** `wrangler deploy --dry-run` builds and the config validates.
6. **Independent code review** (a separate agent, read-only):
   - It found that the 409 guard couldn't fire in the realistic case. The third attempt above fixes this.
   - It found that the Apps Script error replies were logged unredacted. Fixed.
   - Smaller items, all fixed: a terminal `email not sent` line, a strict-equality request test, key trimming, a smaller attachment chunk size, and capped error text.
   - It confirmed the template parity line by line, the Workers-runtime APIs, the retry classification, and the docs.

---

## Steps

### Part R — Resend setup (Siddhant; no production impact)
- [x] **R1.** Create a Resend account with `hello@boardgamecompany.in` and turn on two-factor authentication. Free plan. *(Done 2026-10-25.)*
- [x] **R2.** Domains → Add `boardgamecompany.in`, sending only. Pick a region; `ap-northeast-1` (Tokyo) is closest, but any works.
  - Add the records Resend shows in Cloudflare, **DNS only**. **Don't touch** the root MX, SPF, `_dmarc` or `google._domainkey` records, and **never enable Inbound**.
  - **What Resend actually issued** (2026-10-25), different from its older docs: TXT `resend._domainkey` (1024-bit DKIM key) and a **CNAME `send` → `send.forge.rmta.net`**. That one CNAME supplies the return path's MX (`feedback.forge.rmta.net`) and SPF, so there is no separate MX or TXT on `send`.
- [x] **R3.** Claude checked with `dig` (2026-10-25), against Cloudflare's servers and Google DNS:
  - DKIM resolves.
  - `send` is a CNAME, not proxied, and resolves to Resend's MX and SPF.
  - The root MX is still Google; the root SPF, `_dmarc` and `google._domainkey` are unchanged.
  - Still to confirm in the Resend dashboard: the domain shows **Verified**, and open and click tracking are **off**.
- [x] **R4.** API Keys → create `bgc-worker`, **Sending access**, restricted to `boardgamecompany.in`. Keep it only in your password manager. *(Done 2026-10-25.)*
- [x] **R5.** **Live test, before any deploy.** *(Passed 2026-10-25: all 5 accepted by Resend in under 0.5 s each, and Siddhant confirmed all 5 arrived and looked right.)* In zsh, run this in a subshell, so the key leaves with the subshell even after Ctrl-C:
  ```bash
  cd worker && ( read -rs "RESEND_API_KEY?Resend key: "; export RESEND_API_KEY; RESEND_LIVE_TEST=1 TEST_TO=you@example.com npx vitest run src/email.live.test.ts )
  ```
  It sends 5 emails: paid and free registration, a multi-day waitlist, Guild, and DD with an attachment. Pass:
  - All 5 arrive, **from `Board Game Company <hello@boardgamecompany.in>`**.
  - "Show original" shows SPF **PASS** (`send.boardgamecompany.in`), DKIM **PASS** `d=boardgamecompany.in`, DMARC **PASS**.
  - They look the same as today's emails.
  - They land in the **inbox** at Gmail **and** at one non-Gmail address (Outlook, Yahoo or iCloud).
  - The DD attachment opens as valid JSON.
  - The Resend dashboard shows 5 *Delivered*.
  - This runs under Node, whose `fetch` sends its own User-Agent. The worker's header is covered by a unit test and by D5.

### Part C — Code (Claude) — done; PR pending
- [x] **C1–C5.** Templates, Resend client, router, `Env`, `wrangler.toml`, and parity checks. Tests and typecheck pass.
- [x] **C6.** Docs: AGENTS.md (Email, env/secrets, gotchas); `docs/*-apps-script-snippet.md` marked as legacy, with the store-link doc's wrong "live on save" advice corrected; the copy plan marked as superseded.
- [x] **C7a.** Independent review of the code diff; findings fixed and re-verified.
- [ ] **C7b.** Commit on a branch and open a PR **when Siddhant says so**. Don't merge or deploy until Part D.

### Part D — Deploy and cut over (Siddhant runs; Claude guides and checks)
- [ ] **D0. Preconditions.**
  - R5 passed.
  - **Someone reads `hello@`.** Replies to "Questions? Reply to this email…" land there from D4 on; until now they reached the Gmail inbox. Use the Gmail app on your phone, or set forwarding. Staff also lose the Gmail Sent folder as a record of what went out; the Resend dashboard keeps 30 days.
  - From `worker/`: `npx wrangler deployments status` shows one version at 100%. Record it as **`V_PRE`**. `git log -- worker/` on `main` shows no worker commit after its Created time apart from this PR.
- [ ] **D1. Deploy the code with the switch unset.** Merge the PR, then from up-to-date `main` run `cd worker && npx wrangler deploy`. **Emails still go through the Apps Script.** Record **`V_CODE`**.
  - Check: the next real confirmation (or a free-event booking of your own) still comes from the Gmail address.
  - Workers Logs show `console` lines but no per-request invocation entries.
  - No `[email]` errors.
- [ ] **D2.** `cd worker && npx wrangler secret put RESEND_API_KEY` (paste the R4 key).
- [ ] **D3. Flip.** `cd worker && npx wrangler secret put EMAIL_PROVIDER`, entering `resend`. Record **`V_FLIP`** and **`T_FLIP`** (IST).
- [ ] **D4. End-to-end.** Book a **free** event on the site with your own phone, name and email; it must have spare seats and not clash with another booking. Then cancel it in the admin tool. Pass:
  - The email arrives from `hello@` within a minute.
  - Logs show `[email] sent via resend type=event_registration id=…` and no `falling back`.
  - The Resend dashboard shows it *Delivered*.
  - The old Apps Script project's Executions show no new run.
- [ ] **D5. Soak for 14 days, checking daily.** Logs only keep 3 days, so a daily check is the minimum.
  - Search the logs for `falling back`, `possible duplicate`, `email not sent` and `[email]` errors.
  - Compare the day's bookings (SQL in **Rollback**) with the Resend dashboard's emails.
  - Check bounces and complaints in Resend.
  - Any fallback → investigate. Any booking without an email → roll back.

### Rollback (any time) — order matters
1. **First, always clear the switch** while the latest version is still deployed. Without a code deploy, sending goes back to the Apps Script.
   ```bash
   cd worker && npx wrangler secret delete EMAIL_PROVIDER
   ```
2. **Only if the new code itself misbehaves,** run `npx wrangler rollback V_PRE`, *after* step 1. Rolling back first would block later `secret put/delete` until a new deploy (error 10215). A redeploy could also bring back a version where `EMAIL_PROVIDER=resend`.
3. **Who missed an email** between `T_FLIP` and the rollback. Supabase runs in UTC, so keep the `+05:30`. The Resend dashboard lists everything it accepted.
   ```sql
   select created_at, name, phone, email from registrations
    where email is not null and email <> ''
      and created_at between '<T_FLIP>+05:30' and '<T_ROLLBACK>+05:30' order by created_at;
   select updated_at, name, phone, email from leads
    where waitlist_at is not null
      and updated_at between '<T_FLIP>+05:30' and '<T_ROLLBACK>+05:30' order by updated_at;
   select g.starts_at, g.tier, u.name, u.phone, u.email
     from guild_path_members g join users u on u.id = g.user_id
    where coalesce(g.source,'') <> 'community_host'
      and g.starts_at between '<flip date, UTC>' and '<rollback date, UTC>';
   ```

### Part E — Cleanup after a clean soak (a separate PR) — order matters
**What this gives up:** once the fallback is gone, a Resend outage or a quota 429 (the daily quota resets at 05:30 IST) loses emails, with only a log line. Decide at that point whether to keep the fallback longer, or upgrade the plan if REPLAY joins.

1. Deploy code with the Apps Script path and fallback removed; Resend becomes the only sender, so `EMAIL_PROVIDER` is no longer read. Check that one real send works.
2. Only then delete the secrets `EMAIL_PROVIDER`, `APPS_SCRIPT_URL` and `APPS_SCRIPT_SECRET`. Deleting them earlier, while the router is still live, would send email back to an Apps Script that's no longer configured.
3. Archive the Apps Script web app deployment. Delete the unused `hello@` copy of the project, created 2026-10-23.
4. AGENTS.md gotcha: **`wrangler rollback` to any version older than this cleanup deploy brings back the router, and with the secrets gone it skips email entirely.** Clear `EMAIL_PROVIDER` first, roll back second.
5. **REPLAY gate, unchanged from the superseded plan.** Removing the Gmail "Send mail as hello@" alias and moving DMARC to `p=quarantine` both wait until REPLAY's script and marketing sends stop using that alias. REPLAY can move to this same Resend account and domain with its own plan. Its traffic can exceed the free plan's 100/day.

---

## Risks and how this plan covers them

| Risk | Covered by |
|---|---|
| Ported templates differ from what customers get today | Byte-identical parity with the live code (78 cases) and with deployed output (3 real emails) |
| Date and time drift (`Sept`, U+202F, midnight) | Arithmetic IST formatting plus tests; mutation-checked |
| A rendering bug loses an email | Render inside try/catch, with fallback to the Apps Script; tested |
| Resend outage or misconfiguration loses emails | Fallback during the soak; one-secret rollback |
| A hung Resend call starves the fallback | 4 s attempts and a 12 s fallback timeout, 27.5 s worst case; fake-clock tests |
| Duplicate on an ambiguous failure | The same idempotency key on every attempt, and a third attempt that waits out a timed-out first attempt; the rest is accepted and logged as `possible duplicate` |
| Resend rejects requests without `User-Agent` | Header always set; unit and mutation tested |
| DNS change breaks inbound mail | Only `resend._domainkey` and `send` records, added by hand; Inbound off; `dig` check |
| A code deploy ships unrelated changes | D0 checks that `main` matches live |
| Silent failures | Persistent console logs, success lines with Resend IDs, Resend dashboard, daily check |
| Rollback steps interfering | Rollback is ordered: secret first, code second |
| Part E removing the sender before its replacement | Deploy first, delete secrets second |
| Replies go unread | D0 precondition on reading `hello@` |
| API key or customer data leaks | Sending-only key for one domain, read silently in a subshell; logs redact addresses; parity data deleted |
| New sender identity lands in spam | DKIM/SPF/DMARC alignment and a two-provider inbox check (R5) |
| Hitting the 100/day free limit | Peak about 31/day; upgrade if REPLAY joins |
| REPLAY and marketing break when the alias goes | Part E gate |
