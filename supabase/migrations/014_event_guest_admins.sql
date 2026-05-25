-- 014_event_guest_admins.sql
-- Guest admins: event-scoped, time-bound admin access for collaboration partners.

alter table events
  add column if not exists is_collaboration boolean not null default false;

create table if not exists event_guest_admins (
  id uuid primary key default uuid_generate_v4(),
  event_id uuid not null references events(id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now(),
  created_by text,
  unique (event_id, email)
);

create index if not exists event_guest_admins_email_idx on event_guest_admins (email);

-- Service-role only (worker holds the service key). No public/anon policies.
alter table event_guest_admins enable row level security;
