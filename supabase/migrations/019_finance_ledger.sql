-- 019_finance_ledger.sql
-- Private cash-basis finance ledger for the BGC admin app.
--
-- Income and expenses affect operating results. Transfers only move money
-- between BGC/founder accounts and never count as operating income/expense.
-- Confirming a paid registration or Guild Path purchase posts its income in
-- the same database transaction through the triggers at the end of this file.

create table finance_accounts (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  account_type text not null default 'person'
    check (account_type in ('person', 'bank', 'upi', 'cash', 'other')),
  is_active boolean not null default true,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index finance_accounts_name_unique
  on finance_accounts (lower(name));
create unique index finance_accounts_one_default
  on finance_accounts (is_default)
  where is_default = true;

create or replace function finance_enforce_default_account()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.is_default and not new.is_active then
    raise exception 'The default finance account must be active';
  end if;

  if new.is_default then
    update finance_accounts
    set is_default = false, updated_at = now()
    where id <> new.id and is_default = true;
  end if;

  return new;
end;
$$;

create trigger finance_accounts_enforce_default
before insert or update of is_default, is_active on finance_accounts
for each row execute function finance_enforce_default_account();

create table finance_categories (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  transaction_type text not null
    check (transaction_type in ('income', 'expense')),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index finance_categories_name_type_unique
  on finance_categories (transaction_type, lower(name));

create table finance_import_batches (
  id uuid primary key default uuid_generate_v4(),
  source_name text not null,
  source_sha256 text not null unique,
  row_count integer not null check (row_count >= 0),
  control_total integer not null default 0,
  imported_by text not null,
  created_at timestamptz not null default now()
);

create table finance_transactions (
  id uuid primary key default uuid_generate_v4(),
  transaction_type text not null
    check (transaction_type in ('income', 'expense', 'transfer')),
  occurred_on date not null,
  amount integer not null check (amount > 0),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  category_id uuid references finance_categories(id) on delete restrict,
  from_account_id uuid references finance_accounts(id) on delete restrict,
  to_account_id uuid references finance_accounts(id) on delete restrict,
  payment_method text
    check (payment_method is null or payment_method in ('upi', 'cash', 'bank_transfer', 'card', 'other')),
  event_id uuid references events(id) on delete set null,
  registration_id uuid references registrations(id) on delete set null,
  guild_member_id uuid references guild_path_members(id) on delete set null,
  corporate_event_id uuid references corporate_events(id) on delete set null,
  game_id uuid references games(id) on delete set null,
  notes text,
  receipt_url text,
  source text not null default 'manual'
    check (source in ('manual', 'registration', 'guild', 'import', 'adjustment', 'refund')),
  source_key text,
  import_batch_id uuid references finance_import_batches(id) on delete restrict,
  source_row integer,
  created_by text not null,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by text,
  void_reason text,
  constraint finance_transactions_accounts_check check (
    (transaction_type = 'income'
      and to_account_id is not null
      and from_account_id is null
      and category_id is not null)
    or
    (transaction_type = 'expense'
      and from_account_id is not null
      and to_account_id is null
      and category_id is not null)
    or
    (transaction_type = 'transfer'
      and from_account_id is not null
      and to_account_id is not null
      and from_account_id <> to_account_id
      and category_id is null)
  )
);

create unique index finance_transactions_source_key_unique
  on finance_transactions (source_key)
  where source_key is not null;
create index finance_transactions_occurred_on_idx
  on finance_transactions (occurred_on desc);
create index finance_transactions_category_idx
  on finance_transactions (category_id);
create index finance_transactions_from_account_idx
  on finance_transactions (from_account_id);
create index finance_transactions_to_account_idx
  on finance_transactions (to_account_id);
create index finance_transactions_event_idx
  on finance_transactions (event_id)
  where event_id is not null;
create index finance_transactions_registration_idx
  on finance_transactions (registration_id)
  where registration_id is not null;
create index finance_transactions_guild_member_idx
  on finance_transactions (guild_member_id)
  where guild_member_id is not null;

-- Historical spreadsheet rows are often event-level or otherwise aggregate
-- several app records. These links mark the underlying registration/Guild
-- records as represented by an imported transaction without posting the same
-- cash twice.
create table finance_reconciliation_links (
  id uuid primary key default uuid_generate_v4(),
  source_type text not null
    check (source_type in ('registration', 'guild')),
  source_id uuid not null,
  transaction_id uuid not null references finance_transactions(id) on delete restrict,
  notes text,
  created_by text not null,
  created_at timestamptz not null default now(),
  unique (source_type, source_id)
);

create index finance_reconciliation_links_transaction_idx
  on finance_reconciliation_links (transaction_id);

create table finance_transaction_history (
  id uuid primary key default uuid_generate_v4(),
  transaction_id uuid not null references finance_transactions(id) on delete restrict,
  action text not null check (action in ('created', 'updated', 'voided', 'restored')),
  snapshot jsonb not null,
  actor text not null,
  created_at timestamptz not null default now()
);

create index finance_transaction_history_transaction_idx
  on finance_transaction_history (transaction_id, created_at desc);

create or replace function finance_import_transactions(
  p_source_name text,
  p_source_sha256 text,
  p_control_total integer,
  p_imported_by text,
  p_rows jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  batch_id uuid;
begin
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) < 1 then
    raise exception 'Finance import requires at least one row';
  end if;

  insert into finance_import_batches (
    source_name,
    source_sha256,
    row_count,
    control_total,
    imported_by
  ) values (
    p_source_name,
    p_source_sha256,
    jsonb_array_length(p_rows),
    p_control_total,
    p_imported_by
  )
  returning id into batch_id;

  insert into finance_transactions (
    transaction_type,
    occurred_on,
    amount,
    title,
    category_id,
    from_account_id,
    to_account_id,
    payment_method,
    event_id,
    registration_id,
    guild_member_id,
    corporate_event_id,
    game_id,
    notes,
    receipt_url,
    source,
    source_key,
    import_batch_id,
    source_row,
    created_by
  )
  select
    row.transaction_type,
    row.occurred_on,
    row.amount,
    row.title,
    row.category_id,
    row.from_account_id,
    row.to_account_id,
    row.payment_method,
    row.event_id,
    row.registration_id,
    row.guild_member_id,
    row.corporate_event_id,
    row.game_id,
    row.notes,
    row.receipt_url,
    'import',
    'import:' || p_source_sha256 || ':' || row.source_row::text,
    batch_id,
    row.source_row,
    p_imported_by
  from jsonb_to_recordset(p_rows) as row (
    transaction_type text,
    occurred_on date,
    amount integer,
    title text,
    category_id uuid,
    from_account_id uuid,
    to_account_id uuid,
    payment_method text,
    event_id uuid,
    registration_id uuid,
    guild_member_id uuid,
    corporate_event_id uuid,
    game_id uuid,
    notes text,
    receipt_url text,
    source_row integer
  );

  return batch_id;
end;
$$;

-- Existing spreadsheet account holders. No default is assumed: admins choose
-- the receiving/paying account when they first post a payment.
insert into finance_accounts (name, account_type)
values
  ('Amrit Kochar', 'person'),
  ('Siddhant Narula', 'person'),
  ('Suranjana Datta', 'person'),
  ('Swapnil Raj', 'person')
on conflict do nothing;

insert into finance_categories (name, transaction_type)
values
  ('Event registrations', 'income'),
  ('Guild Path', 'income'),
  ('Corporate events', 'income'),
  ('Other income', 'income'),
  ('Venue Payout', 'expense'),
  ('Special Event', 'expense'),
  ('Games Purchase', 'expense'),
  ('Miscellaneous', 'expense'),
  ('Advertising', 'expense'),
  ('Marketing', 'expense'),
  ('Travel', 'expense'),
  ('Food', 'expense'),
  ('Refunds', 'expense'),
  ('Sponsorship', 'expense'),
  ('Rentals and Courier', 'expense'),
  ('Play Test', 'expense')
on conflict do nothing;

alter table registrations
  add column payment_account_id uuid references finance_accounts(id) on delete restrict,
  add column paid_at timestamptz,
  add column payment_method text
    check (payment_method is null or payment_method in ('upi', 'cash', 'bank_transfer', 'card', 'other')),
  add column payment_recorded_by text;

alter table guild_path_members
  add column payment_account_id uuid references finance_accounts(id) on delete restrict,
  add column paid_at timestamptz,
  add column payment_method text
    check (payment_method is null or payment_method in ('upi', 'cash', 'bank_transfer', 'card', 'other')),
  add column payment_recorded_by text;

create or replace function finance_audit_transaction()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  audit_action text;
  audit_actor text;
begin
  if tg_op = 'INSERT' then
    audit_action := 'created';
  elsif old.voided_at is null and new.voided_at is not null then
    audit_action := 'voided';
  elsif old.voided_at is not null and new.voided_at is null then
    audit_action := 'restored';
  else
    audit_action := 'updated';
  end if;

  audit_actor := coalesce(
    new.voided_by,
    new.updated_by,
    new.created_by,
    'system'
  );

  insert into finance_transaction_history (
    transaction_id, action, snapshot, actor
  ) values (
    new.id, audit_action, to_jsonb(new), audit_actor
  );
  return new;
end;
$$;

create trigger finance_transactions_audit
after insert or update on finance_transactions
for each row execute function finance_audit_transaction();

create or replace function sync_registration_finance_income()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  income_category_id uuid;
  event_name text;
  actor text;
begin
  -- A paid cash registration must say where and when the money landed.
  if new.payment_status = 'confirmed'
    and new.total_amount > 0
    and (
      tg_op = 'INSERT'
      or old.payment_status is distinct from 'confirmed'
      or old.total_amount is distinct from new.total_amount
      or old.payment_account_id is distinct from new.payment_account_id
      or old.paid_at is distinct from new.paid_at
      or old.payment_method is distinct from new.payment_method
    )
  then
    if new.payment_account_id is null or new.paid_at is null or new.payment_method is null then
      raise exception 'Payment account, payment date, and payment method are required before confirming a paid registration';
    end if;

    select id into income_category_id
    from finance_categories
    where transaction_type = 'income' and name = 'Event registrations';

    select name into event_name from events where id = new.event_id;
    actor := coalesce(new.payment_recorded_by, 'system:registration');

    insert into finance_transactions (
      transaction_type,
      occurred_on,
      amount,
      title,
      category_id,
      to_account_id,
      payment_method,
      event_id,
      registration_id,
      source,
      source_key,
      created_by,
      updated_by,
      voided_at,
      voided_by,
      void_reason
    ) values (
      'income',
      new.paid_at::date,
      new.total_amount,
      coalesce(event_name, 'Event') || ' — ' || new.name,
      income_category_id,
      new.payment_account_id,
      new.payment_method,
      new.event_id,
      new.id,
      'registration',
      'registration:' || new.id::text,
      actor,
      actor,
      null,
      null,
      null
    )
    on conflict (source_key) where source_key is not null
    do update set
      occurred_on = excluded.occurred_on,
      amount = excluded.amount,
      title = excluded.title,
      category_id = excluded.category_id,
      to_account_id = excluded.to_account_id,
      payment_method = excluded.payment_method,
      event_id = excluded.event_id,
      registration_id = excluded.registration_id,
      updated_by = excluded.updated_by,
      updated_at = now(),
      voided_at = null,
      voided_by = null,
      void_reason = null;
  end if;

  -- Reverting a confirmation is a correction, so remove it from cash totals.
  -- Cancelling is intentionally different: BGC issues credit and cash stays put.
  if tg_op = 'UPDATE'
    and old.payment_status = 'confirmed'
    and new.payment_status = 'pending'
  then
    update finance_transactions
    set
      voided_at = now(),
      voided_by = 'system:registration',
      void_reason = 'Registration payment moved back to pending',
      updated_by = 'system:registration',
      updated_at = now()
    where source_key = 'registration:' || new.id::text
      and voided_at is null;
  end if;

  return new;
end;
$$;

create trigger registrations_finance_income
after insert or update of payment_status, total_amount, payment_account_id, paid_at, payment_method, payment_recorded_by
on registrations
for each row execute function sync_registration_finance_income();

create or replace function sync_guild_finance_income()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  income_category_id uuid;
  member_name text;
  actor text;
begin
  if new.status = 'paid'
    and new.amount > 0
    and (
      tg_op = 'INSERT'
      or old.status is distinct from 'paid'
      or old.amount is distinct from new.amount
      or old.payment_account_id is distinct from new.payment_account_id
      or old.paid_at is distinct from new.paid_at
      or old.payment_method is distinct from new.payment_method
    )
  then
    if new.payment_account_id is null or new.paid_at is null or new.payment_method is null then
      raise exception 'Payment account, payment date, and payment method are required before marking a paid Guild membership';
    end if;

    select id into income_category_id
    from finance_categories
    where transaction_type = 'income' and name = 'Guild Path';

    select name into member_name from users where id = new.user_id;
    actor := coalesce(new.payment_recorded_by, 'system:guild');

    insert into finance_transactions (
      transaction_type,
      occurred_on,
      amount,
      title,
      category_id,
      to_account_id,
      payment_method,
      guild_member_id,
      source,
      source_key,
      created_by,
      updated_by,
      voided_at,
      voided_by,
      void_reason
    ) values (
      'income',
      new.paid_at::date,
      new.amount,
      'Guild Path — ' || coalesce(member_name, initcap(new.tier)),
      income_category_id,
      new.payment_account_id,
      new.payment_method,
      new.id,
      'guild',
      'guild:' || new.id::text,
      actor,
      actor,
      null,
      null,
      null
    )
    on conflict (source_key) where source_key is not null
    do update set
      occurred_on = excluded.occurred_on,
      amount = excluded.amount,
      title = excluded.title,
      category_id = excluded.category_id,
      to_account_id = excluded.to_account_id,
      payment_method = excluded.payment_method,
      guild_member_id = excluded.guild_member_id,
      updated_by = excluded.updated_by,
      updated_at = now(),
      voided_at = null,
      voided_by = null,
      void_reason = null;
  end if;

  if tg_op = 'UPDATE'
    and old.status = 'paid'
    and new.status = 'pending'
  then
    update finance_transactions
    set
      voided_at = now(),
      voided_by = 'system:guild',
      void_reason = 'Guild payment moved back to pending',
      updated_by = 'system:guild',
      updated_at = now()
    where source_key = 'guild:' || new.id::text
      and voided_at is null;
  end if;

  return new;
end;
$$;

create trigger guild_members_finance_income
after insert or update of status, amount, payment_account_id, paid_at, payment_method, payment_recorded_by
on guild_path_members
for each row execute function sync_guild_finance_income();

alter table finance_accounts enable row level security;
alter table finance_categories enable row level security;
alter table finance_import_batches enable row level security;
alter table finance_transactions enable row level security;
alter table finance_reconciliation_links enable row level security;
alter table finance_transaction_history enable row level security;

grant all on public.finance_accounts to authenticated, service_role;
grant all on public.finance_categories to authenticated, service_role;
grant all on public.finance_import_batches to authenticated, service_role;
grant all on public.finance_transactions to authenticated, service_role;
grant all on public.finance_reconciliation_links to authenticated, service_role;
grant all on public.finance_transaction_history to authenticated, service_role;

revoke all on function finance_import_transactions(text, text, integer, text, jsonb) from public;
grant execute on function finance_import_transactions(text, text, integer, text, jsonb) to service_role;
