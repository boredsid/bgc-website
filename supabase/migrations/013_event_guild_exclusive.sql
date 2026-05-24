-- Guild Path Exclusive events: when true, only active Guild Path members
-- can register via the public site. Server-enforced in the worker.
alter table events
  add column guild_path_exclusive boolean not null default false;
