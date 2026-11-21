-- 025_finance_account_types.sql
-- Finance accounts are now only people, organisations (such as BGC's own
-- bank account), or other. The old bank, UPI, and cash types are folded in:
-- bank becomes organisation, and UPI and cash become other.
alter table finance_accounts
  drop constraint finance_accounts_account_type_check;

update finance_accounts
set account_type = case account_type
    when 'bank' then 'organisation'
    else 'other'
  end,
  updated_at = now()
where account_type in ('bank', 'upi', 'cash');

alter table finance_accounts
  add constraint finance_accounts_account_type_check
  check (account_type in ('person', 'organisation', 'other'));
