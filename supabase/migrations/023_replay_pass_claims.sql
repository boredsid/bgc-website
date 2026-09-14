-- 023_replay_pass_claims.sql
-- REPLAY pass perk, extended from "the purchaser" to "any attendee".
--
-- On an event flagged `replay_pass_free` (migration 021), the person booking can
-- now name the phone numbers of the people sitting with them. Every number that
-- holds a confirmed pass for the latest REPLAY edition covers one seat in the
-- booking, the same way the purchaser's own pass always has.
--
-- A pass is one person's, so it is worth exactly one free seat per event no
-- matter whose booking it turns up in. That rule needs somewhere to live:
-- pass ownership is in the REPLAY project, and a companion's number is not a
-- `user_id` here, so "has this pass already been spent on this event?" cannot be
-- answered from `registrations` alone. This table answers it, and the unique
-- index is what settles two bookings racing for the same number.
--
-- Rows are written before the registration exists (the unique index is the
-- referee, so the price has to be decided after the claim is won), hence the
-- nullable `registration_id` — it is filled in a beat later. A claim outlives
-- the booking only if that fill-in fails; cancelling a registration releases its
-- claims so the pass can be used again.

create table replay_pass_claims (
  id uuid primary key default uuid_generate_v4(),
  event_id uuid not null references events (id) on delete cascade,
  -- 10-digit local form, exactly as `sanitizePhone` in the Worker produces it.
  phone text not null,
  registration_id uuid references registrations (id) on delete cascade,
  -- The purchaser's own claim vs. one made for someone sitting with them. Kept
  -- for admin/export legibility; the pricing rule treats both identically.
  is_purchaser boolean not null default false,
  claimed_at timestamptz not null default now()
);

-- One pass, one free seat, one event. This is load-bearing, not hygiene: the
-- Worker inserts speculatively and reads back which inserts survived.
create unique index replay_pass_claims_event_phone_unique
  on replay_pass_claims (event_id, phone);

-- Cancellation releases every claim a booking made.
create index replay_pass_claims_registration_idx
  on replay_pass_claims (registration_id);

alter table replay_pass_claims enable row level security;

-- New-table grants (see AGENTS.md): the Worker talks to this table as
-- `service_role` and the admin app as `authenticated`. The public site never
-- reads it directly — it asks the Worker — so `anon` gets nothing.
grant all on public.replay_pass_claims to authenticated, service_role;
