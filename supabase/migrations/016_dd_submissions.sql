-- 016_dd_submissions.sql
-- Stores Demon's Draft (BotC script contest) entries submitted via the /dd page.
-- Identity (name/phone/email) is captured separately from the script so judges
-- only ever see script_json under an organizer-assigned code_name. Worker
-- (service role) writes only; the browser never reads this table directly.

create table dd_submissions (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  phone text not null,
  email text not null,
  script_json jsonb not null,
  code_name text,            -- assigned offline by organizers before judging
  created_at timestamptz not null default now()
);

create index dd_submissions_created_at_idx on dd_submissions (created_at desc);

alter table dd_submissions enable row level security;
-- No public policies — Worker (service role) only.

-- New-table grants required from migration 014+ (Supabase stops auto-exposing
-- public tables to PostgREST; this hits service_role too). Browser never reads
-- this table, so no anon grant.
grant all on public.dd_submissions to authenticated, service_role;
