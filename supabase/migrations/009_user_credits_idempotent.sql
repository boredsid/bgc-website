-- 009_user_credits_idempotent.sql
-- Each registration can have at most one cancellation row and one reversal row.
-- Prevents double-credit if /api/admin/cancel-registration and PATCH
-- /api/admin/registrations/:id race against the same registration.

create unique index if not exists user_credits_one_cancellation_per_reg
  on user_credits (registration_id)
  where reason = 'cancellation';

create unique index if not exists user_credits_one_reversal_per_reg
  on user_credits (registration_id)
  where reason = 'cancellation_reversal';
