-- Add source attribution columns. All nullable — historical rows stay NULL.
alter table users add column source text;
alter table registrations add column source text;
alter table guild_path_members add column source text;
