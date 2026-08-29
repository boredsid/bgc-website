-- 022_community_hosts.sql
-- Community Hosts: people from the community who keep hosting BGC sessions.
--
-- Three parts:
--   1. A flag on `users` marking someone a community host.
--   2. A `never_expires` flag on `guild_path_members` so a host's free Initiate
--      membership never lapses.
--   3. A flag on `registrations` marking a seat as "here to host", which is
--      free and skips the whole discount pipeline.
--
-- No new tables, so no new Data API grants are needed (see AGENTS.md).

-- ============================================
-- USERS
-- ============================================
alter table users
  add column if not exists is_community_host boolean not null default false,
  add column if not exists community_host_since date,
  add column if not exists community_host_notes text;

-- Hosts are a small subset of users; a partial index keeps the roster lookup
-- cheap without weighing down the main users table.
create index if not exists users_community_host_idx
  on users (id)
  where is_community_host;

-- ============================================
-- GUILD PATH MEMBERS
-- ============================================
-- A community host's Initiate membership is free and open-ended. Rather than
-- teach every "is this membership still active?" query about NULL expiry, the
-- row carries a far-future `expires_at` sentinel so the existing
-- `expires_at >= today` filters keep working untouched. `never_expires` is what
-- the UI and exports read, so nobody is ever shown "expires 31 Dec 2999".
--
-- Because a host can also buy a real upgrade, a user may now hold more than one
-- active membership. Callers must pick the *best* one (highest tier, then
-- latest expiry) rather than simply the latest-expiring — see
-- `getActiveMembership` in worker/src/guild.ts.
alter table guild_path_members
  add column if not exists never_expires boolean not null default false;

-- ============================================
-- REGISTRATIONS
-- ============================================
-- A host seat consumes event capacity like any other seat, but is always ₹0 and
-- never touches Guild discounts, REPLAY passes, giveaway promos, or credits.
alter table registrations
  add column if not exists is_community_host boolean not null default false;

create index if not exists registrations_community_host_idx
  on registrations (event_id)
  where is_community_host;
