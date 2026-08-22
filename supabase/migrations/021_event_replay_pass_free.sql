-- REPLAY pass perk: when true, anyone holding a confirmed registration for the
-- latest REPLAY edition gets one free seat on this event. The pass belongs to a
-- person, so it covers the holder's own seat only — companion seats still pay.
--
-- Pass ownership lives in the REPLAY Supabase project, not this one. The worker
-- asks the REPLAY worker (/api/pass-status) at registration time; there is no
-- column here mirroring who holds a pass.
alter table events
  add column replay_pass_free boolean not null default false;
