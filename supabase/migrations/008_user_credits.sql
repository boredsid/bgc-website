-- 008_user_credits.sql
-- Append-only ledger of user credit movements. Balance = sum(amount) per user.

create table user_credits (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references users(id) on delete cascade,
  amount int not null,
  reason text not null check (reason in (
    'cancellation',
    'cancellation_reversal',
    'registration_use',
    'guild_use',
    'admin_adjustment'
  )),
  registration_id uuid references registrations(id) on delete set null,
  guild_member_id uuid references guild_path_members(id) on delete set null,
  note text,
  created_by text,
  created_at timestamptz not null default now()
);

create index user_credits_user_id_idx on user_credits (user_id);
create index user_credits_registration_id_idx
  on user_credits (registration_id) where registration_id is not null;

alter table user_credits enable row level security;
-- No public policies — Worker (service role) only

alter table registrations
  add column if not exists credits_applied int not null default 0;
