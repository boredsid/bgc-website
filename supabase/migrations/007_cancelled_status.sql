-- Allow cancelling registrations and guild memberships.
-- Cancelled rows are excluded from all read-side logic (spots, discounts, member status).

alter table registrations
  drop constraint if exists registrations_payment_status_check;

alter table registrations
  add constraint registrations_payment_status_check
  check (payment_status in ('pending', 'confirmed', 'cancelled'));

alter table guild_path_members
  drop constraint if exists guild_path_members_status_check;

alter table guild_path_members
  add constraint guild_path_members_status_check
  check (status in ('pending', 'paid', 'cancelled'));

-- Track plus-ones consumed by each registration so cancellations can refund them
-- to the guild membership's plus_ones_used counter without needing to re-derive
-- the value from event price + sibling registrations.
alter table registrations
  add column if not exists plus_ones_consumed int not null default 0;
