# Demon's Draft — BotC Script Contest Page (`/dd`)

**Date:** 2026-06-07
**Status:** Design — approved for planning
**Theme:** *The Bootlegger's Gambit* — Blood on the Clocktower homebrew-rule script contest.

## Summary

A standalone public page at `boardgamecompany.in/dd` (not in nav, like `/zombie-rules`)
presenting the contest rules in a dark gothic style matching the social creative, plus an
in-page submission form. Creators build a script on the official BotC script tool, export
its JSON, and paste it into the form along with their contact details. On submit, the entry
is stored in a new `dd_submissions` Supabase table (source of truth) and a notification
email with the script JSON is sent to the organizers.

Deadline shown: **15 Jun 2026**.

## Goals

- A polished, on-brand rules page that reads cleanly and fixes the ambiguities in the rough draft.
- A low-friction submission form: name, phone, email, pasted script JSON.
- Reliable capture: every submission persisted to Supabase, with an email notification.
- Anonymity preserved: identity captured separately from the script; judges only ever see the JSON.

## Non-goals

- No admin UI for managing submissions in this iteration (organizers read via Supabase dashboard / email).
- No automated validation of the 13/4/4/4 composition or homebrew-rule presence (judges enforce; would
  require a full character-team roster we don't maintain).
- No code-name auto-assignment (organizers assign offline).
- No payment, login, or registration integration.

## Rules — corrected content

The page presents the contest in the existing rough-draft structure, with these corrections
baked in (these resolve real ambiguities/gaps in the draft):

1. **The Bootlegger Constraint** — Every script must include **at least one homebrew rule**
   (added via the *Bootlegger* feature in the official script tool). The script's mechanics
   and balance must revolve around or complement this rule. **Homebrew characters are NOT
   allowed** — all 25 characters must be official.

2. **Standard Composition** — Exactly **13 Townsfolk, 4 Outsiders, 4 Minions, 4 Demons
   (25 official characters total)**.

3. **Total Anonymity** — Submissions go through the form on this page; identity (name/phone/email)
   is captured separately from the script. Creators **must not identify themselves inside the
   script JSON** (leave the author/name `_meta` field blank or generic). Organizers assign each
   script a random code name before handing scripts to judges and players.

4. **How to build & submit** — Create the script on
   `https://script.bloodontheclocktower.com/`, add the homebrew rule via the Bootlegger feature,
   then **Export → JSON** and paste the JSON into the submission form. One submission per form
   send; deadline **15 Jun 2026**.

5. **Separation of roles** (unchanged intent, three non-overlapping groups):
   - *Creators* — submit scripts; cannot judge, ST, or play. Spectators only.
   - *Playtesters & Storytellers* — fixed group of 12–15 players + 2–3 STs; cannot submit;
     play every finalist blind.
   - *Judging Panel* — 3–5 experienced players/STs; cannot submit or play; score raw scripts in Phase 1.

6. **Phase 1 — Blind Paper Test** — Judges score each anonymized script out of **20**:
   - Synergy & Bluff Lines (5)
   - **Homebrew Rule Integration (5)** — does the custom rule fit naturally / is it not game-breaking
     (renamed from "Bootleg Integration")
   - Mechanical Integrity (5)
   - Theme & Flow (5)

   Top 4 by average score advance.

7. **Phase 2 — Blind Playtests (online)** — Top 4 scripts, each played **twice back-to-back**:
   - Game 1 (small): 9–10 players.
   - Game 2 (large): 12–14 players.

   Played online, labelled by code name only.

8. **Phase 3 — Final Scoring** — After each script's second game, playtesters/STs fill an
   anonymous form rating **1–10** on:
   - Fun Factor
   - Information Balance
   - ST Flow (STs only)

   **Aggregation (newly specified):** a script's final score = mean of three axes.
   Fun and Balance axes = mean of all player + ST responses across both games. ST Flow axis =
   mean of ST responses across both games. Overall = average of the three axis means.
   **Tie-break:** higher Fun Factor, then higher Information Balance.

9. **Grand Finale** — Organizer locks the math, then reveals creator identities. Highest overall
   score is crowned **Community Script Champion**. Prize: the title **plus the winning script is
   run as a featured BGC (online) event.**

## Architecture

Three deployables touched: site (Astro page + React island), worker (new endpoint), Supabase
(new table).

### 1. Supabase — `supabase/migrations/016_dd_submissions.sql`

```sql
create table dd_submissions (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  phone text not null,
  email text not null,
  script_json jsonb not null,
  code_name text,           -- assigned offline by organizers
  created_at timestamptz not null default now()
);

create index dd_submissions_created_at_idx on dd_submissions (created_at desc);

alter table dd_submissions enable row level security;
-- No public policies — Worker (service role) only.

-- New-table grants required from migration 014+ (browser never reads this table,
-- so no anon grant):
grant all on public.dd_submissions to authenticated, service_role;
```

### 2. Worker — `POST /api/dd-submit`

New handler `worker/src/dd-submit.ts`, wired into the `if/else` chain in `worker/src/index.ts`
alongside the other public endpoints.

Request body: `{ name, phone, email, script_json }` where `script_json` is the raw exported
JSON (string or parsed). Handler:

1. Parse request JSON; 400 on failure.
2. Validate: `name` non-empty (≤200 chars), `email` looks like an email, `phone` via existing
   `sanitizePhone`. `script_json`: parse if string; must be a non-empty **array**; reject if
   serialized size > ~256 KB.
3. Per-isolate rate-limit keyed by `phone` (mirror `lead.ts`, ~2 s window) to absorb double-clicks.
4. Insert row into `dd_submissions` (service role). On DB error, return an error (so the user can
   retry) — unlike `lead.ts` which swallows errors, this is a real submission.
5. Fire notification email via Apps Script (best-effort, `ctx.waitUntil`): `type: 'dd_submission'`
   with `{ to, name, phone, email, script_json, submission_id }`. `to` comes from a new worker var
   `DD_SUBMISSION_EMAILS` (comma-separated; default `boardgamecompany2024@gmail.com`).
6. Return `{ ok: true, id }`.

Add `DD_SUBMISSION_EMAILS: string` to the `Env` interface and to `worker/wrangler.toml` `[vars]`.

New email helper in `worker/src/email.ts`: `sendDdSubmissionEmail(payload, env)` → `postToAppsScript({ type: 'dd_submission', ... })`.

### 3. Apps Script (external — manual step for the user)

The Google Apps Script behind `APPS_SCRIPT_URL` must gain a `dd_submission` branch that emails
each address in `to` with the contact details and the script JSON (as body + `.json` attachment).
**Deliverable:** provide the exact snippet for the user to paste. Until pasted, submissions still
persist to Supabase (email is best-effort).

### 4. Site — `src/pages/dd.astro` + `src/components/DemonsDraftForm.tsx`

- `dd.astro`: self-contained page mirroring `zombie-rules.astro` structure (hero → TOC → prose
  body → scoped `<style>`). Dark gothic palette: charcoal-grain background (`#1A1A1A`/grain),
  blood-red display heading (`#B11A1A`-ish red from the creative) over the BGC orange accents,
  parchment text (`#FFF8F0`). Reuse the section/TOC/table/callout patterns from zombie-rules,
  restyled for the gothic theme. Renders all rules sections above, then the form island.
- `DemonsDraftForm.tsx`: controlled form (name, phone, email, script JSON textarea). Client-side:
  trim inputs; on the JSON field, attempt `JSON.parse` and require an array before enabling submit,
  with an inline "valid script detected / not valid JSON" hint. Reads `PUBLIC_WORKER_URL` for the
  POST target. Shows submitting / success / error states. On success, replaces the form with a
  confirmation message.

## Data flow

Creator builds script on official tool → exports JSON → pastes into form on `/dd` →
React island POSTs `{name, phone, email, script_json}` to `api.boardgamecompany.in/api/dd-submit`
→ worker validates + inserts into `dd_submissions` → worker emails organizers (`DD_SUBMISSION_EMAILS`)
via Apps Script → form shows success.

## Error handling

- Invalid request JSON / missing fields / bad email/phone / non-array or oversized script → 400 with message; form shows it inline.
- DB insert failure → 5xx/error response; form invites retry (submission not silently lost).
- Apps Script email failure → logged, does not fail the request (row already persisted).
- Rate-limited duplicate within window → treated as success (idempotent UX), no duplicate insert beyond the window.

## Testing

- `worker/src/dd-submit.test.ts` (Vitest, mirror `lead.test.ts`): valid submission inserts + returns id;
  rejects bad email, bad phone, empty name, non-array JSON, oversized JSON, invalid request JSON;
  rate-limit dedup; email send invoked with recipients from `DD_SUBMISSION_EMAILS`.
- Manual: build a real script on the tool, export, paste, submit; confirm row in Supabase + email received.

## Deployment notes

- Site auto-deploys on push to `main`.
- Worker is manual: `cd worker && npx wrangler deploy`. Set `DD_SUBMISSION_EMAILS` in `wrangler.toml` `[vars]`.
- Run migration `016` against Supabase.
- Paste the `dd_submission` branch into the external Apps Script.
