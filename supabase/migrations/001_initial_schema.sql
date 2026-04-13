-- Enable UUID generation
create extension if not exists "uuid-ossp";

-- ============================================
-- USERS
-- ============================================
create table users (
  id uuid primary key default uuid_generate_v4(),
  phone text not null,
  name text,
  email text,
  first_registered_at timestamptz not null default now(),
  last_registered_at timestamptz not null default now()
);

create unique index users_phone_idx on users (phone);

alter table users enable row level security;
-- No public access — Worker only

-- ============================================
-- GAMES
-- ============================================
create table games (
  id uuid primary key default uuid_generate_v4(),
  title text not null,
  player_count text,
  max_players int,
  avg_rating decimal,
  weight decimal,
  complexity text,
  play_time text,
  max_play_time int,
  length text,
  owned_by text,
  currently_with text
);

alter table games enable row level security;

create policy "Games are publicly readable"
  on games for select
  to anon
  using (true);

-- ============================================
-- EVENTS
-- ============================================
create table events (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  description text,
  date timestamptz not null,
  venue_name text,
  venue_area text,
  price int not null default 0,
  capacity int not null default 0,
  custom_questions jsonb,
  is_published boolean not null default false,
  created_at timestamptz not null default now()
);

alter table events enable row level security;

create policy "Published events are publicly readable"
  on events for select
  to anon
  using (is_published = true);

-- ============================================
-- GUILD MEMBERS
-- ============================================
create table guild_members (
  id uuid primary key default uuid_generate_v4(),
  name text,
  phone text not null,
  email text,
  tier text not null check (tier in ('initiate', 'adventurer', 'guildmaster')),
  starts_at date not null,
  expires_at date not null,
  events_attended int not null default 0,
  created_at timestamptz not null default now()
);

create unique index guild_members_phone_idx on guild_members (phone);

alter table guild_members enable row level security;
-- No public access — Worker only

-- ============================================
-- REGISTRATIONS
-- ============================================
create table registrations (
  id uuid primary key default uuid_generate_v4(),
  event_id uuid not null references events(id),
  name text not null,
  phone text not null,
  email text,
  seats int not null default 1,
  total_amount int not null default 0,
  discount_applied text,
  custom_answers jsonb,
  payment_status text not null default 'pending' check (payment_status in ('pending', 'confirmed')),
  created_at timestamptz not null default now()
);

create index registrations_event_id_idx on registrations (event_id);

alter table registrations enable row level security;
-- No public access — Worker only
