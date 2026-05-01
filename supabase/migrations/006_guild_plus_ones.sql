-- Track plus-one event entries used by guild path members.
-- Adventurers get 1 plus-one over 3 months; guildmasters get 5 over 12 months.
alter table guild_path_members
  add column plus_ones_used int not null default 0 check (plus_ones_used >= 0);
