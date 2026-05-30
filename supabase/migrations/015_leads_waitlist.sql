-- 015_leads_waitlist.sql
-- Extends the leads table to support event waitlists. When an event is sold out,
-- visitors join a waitlist instead of hitting a dead-end; the entry is a lead row
-- marked with waitlist_at (which also gives FIFO ordering). email + seats are
-- collected on the waitlist form. leads is an existing table, so it keeps its
-- existing grants — no new grant needed.

alter table leads add column email text;
alter table leads add column seats int;
alter table leads add column waitlist_at timestamptz;

-- Cheap lookups for the admin "waitlist only" view.
create index leads_waitlist_idx on leads (waitlist_at desc)
  where waitlist_at is not null and junk_at is null;
