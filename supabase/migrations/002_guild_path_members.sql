-- Drop the old guild_members table
drop table if exists guild_members;

-- Create the new guild_path_members table
create table guild_path_members (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references users(id),
  tier text not null check (tier in ('initiate', 'adventurer', 'guildmaster')),
  amount int not null,
  status text not null default 'pending' check (status in ('pending', 'paid')),
  starts_at date not null,
  expires_at date not null
);

create index guild_path_members_user_id_idx on guild_path_members (user_id);

alter table guild_path_members enable row level security;
-- No public access — Worker only
