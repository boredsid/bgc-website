-- Events can now run all day (no meaningful clock time) and span several days.
--
-- `date` stays the canonical start instant, so every existing sort still works.
-- `end_date` is the optional last instant; null keeps the pre-existing
-- single-slot behaviour where an event "ends" when it starts.
-- `ends_at` is the derived instant that every "is this event over?" query must
-- use, so a multi-day or all-day event that is currently running stays in the
-- upcoming lists instead of vanishing at its start time.
--
-- `ends_at` is trigger-maintained rather than a generated column because
-- `timestamptz + interval` is only STABLE, which generated columns reject.

alter table events
  add column end_date timestamptz,
  add column is_all_day boolean not null default false,
  add column ends_at timestamptz;

alter table events
  add constraint events_end_date_after_start_check
  check (end_date is null or end_date >= date);

create or replace function events_sync_ends_at() returns trigger
language plpgsql
as $$
begin
  if new.is_all_day then
    -- An all-day event runs until the end of its last calendar day in
    -- Bangalore, not until the midnight its start instant sits on.
    new.ends_at := (
      date_trunc('day', (coalesce(new.end_date, new.date) at time zone 'Asia/Kolkata'))
      + interval '1 day' - interval '1 second'
    ) at time zone 'Asia/Kolkata';
  else
    new.ends_at := coalesce(new.end_date, new.date);
  end if;
  return new;
end;
$$;

create trigger events_sync_ends_at_trigger
  before insert or update of date, end_date, is_all_day on events
  for each row execute function events_sync_ends_at();

-- Every existing event is single-slot and timed, so its end is its start.
update events set ends_at = date where ends_at is null;

alter table events alter column ends_at set not null;

create index events_ends_at_idx on events (ends_at);

comment on column events.end_date is
  'Optional last instant of the event. Null means a single-slot event that ends when it starts. Never before date.';

comment on column events.is_all_day is
  'True when the event has no meaningful clock time; the public site shows dates only.';

comment on column events.ends_at is
  'Derived and trigger-maintained. Filter upcoming/past on this, never on date, so a running multi-day or all-day event stays listed.';
