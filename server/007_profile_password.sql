-- Existing rows are backfilled with individual salts by migrate.js before
-- this column becomes NOT NULL. New accounts must supply their own password.
ALTER TABLE profiles ADD COLUMN password_hash text;
