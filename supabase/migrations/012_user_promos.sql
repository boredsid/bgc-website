-- 012_user_promos.sql
-- One-time promo grants: a user gets N free event registrations for events
-- up to a max event price. Used for giveaways without flipping events to free.

create table user_promos (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references users(id) on delete cascade,
  remaining_uses int not null check (remaining_uses >= 0),
  max_event_price int not null check (max_event_price >= 0),
  expires_at date,
  notes text,
  created_by text,
  created_at timestamptz not null default now()
);

create index user_promos_user_active_idx
  on user_promos (user_id)
  where remaining_uses > 0;

alter table user_promos enable row level security;
-- No public policies — Worker (service role) only.

alter table registrations
  add column if not exists promo_id uuid references user_promos(id) on delete set null,
  add column if not exists promo_uses_consumed int not null default 0
    check (promo_uses_consumed >= 0);
