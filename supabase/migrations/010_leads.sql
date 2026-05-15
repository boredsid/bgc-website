-- 010_leads.sql
-- Captures partial registration attempts. Created when a visitor types a valid
-- phone in the registration form; updated as they progress; marked converted
-- when a matching registration succeeds. Admin can soft-delete via junk_at.

create table leads (
  id uuid primary key default uuid_generate_v4(),
  phone text not null,
  name text,
  event_id uuid not null references events(id) on delete cascade,
  last_step text not null check (last_step in (
    'phone_entered',
    'name_entered',
    'details_entered'
  )),
  source jsonb,
  user_agent text,
  converted_at timestamptz,
  registration_id uuid references registrations(id) on delete set null,
  junk_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (phone, event_id)
);

create index leads_created_at_idx on leads (created_at desc);
create index leads_open_idx on leads (created_at desc)
  where converted_at is null and junk_at is null;

alter table leads enable row level security;
-- No public policies — Worker (service role) only.
