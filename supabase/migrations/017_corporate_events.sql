-- 017_corporate_events.sql
-- Corporate (B2B) events shown on the public /corporate page. Display-only:
-- no registration flow, no capacity math — admins log past and upcoming
-- events and the site renders them. Company logos live in the public
-- `corporate-logos` storage bucket; logo_url stores the public object URL.

create table corporate_events (
  id uuid primary key default uuid_generate_v4(),
  company_name text not null,
  title text,                -- e.g. "Game Night Offsite"; page falls back to company_name
  event_date date not null,  -- upcoming vs past is derived from this, no status column
  headcount integer,
  description text,
  logo_url text,
  testimonial text,
  is_published boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index corporate_events_date_idx on corporate_events (event_date desc);

alter table corporate_events enable row level security;

-- Browser reads published rows directly via the anon key.
create policy "Public can read published corporate events"
  on corporate_events for select
  using (is_published = true);

-- New-table grants required from migration 014+ (Supabase stops auto-exposing
-- public tables to PostgREST; this hits service_role too).
grant all on public.corporate_events to authenticated, service_role;
grant select on public.corporate_events to anon;

-- Public bucket for company logos; worker (service role) uploads, site reads
-- via the public object URL.
insert into storage.buckets (id, name, public)
values ('corporate-logos', 'corporate-logos', true)
on conflict (id) do nothing;
