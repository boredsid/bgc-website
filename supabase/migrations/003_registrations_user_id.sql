-- Link registrations to users so they can be cross-referenced.
-- The column is nullable: a registration may exist without a matching
-- users row in transient states, and we never want a user delete to
-- cascade away their registration history (ON DELETE SET NULL).

ALTER TABLE registrations
  ADD COLUMN user_id uuid REFERENCES users(id) ON DELETE SET NULL;

UPDATE registrations r
  SET user_id = u.id
  FROM users u
  WHERE r.phone = u.phone;

CREATE INDEX IF NOT EXISTS registrations_user_id_idx ON registrations(user_id);
