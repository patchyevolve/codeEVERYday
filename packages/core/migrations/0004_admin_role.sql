-- Add is_admin column to users table.
-- Idempotent: this table/column may already exist when the database was
-- provisioned by `drizzle-kit push` instead of `db:migrate`.
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT false;

-- Promote the first registered user to admin, but NEVER demote an admin that
-- was already granted (re-running this migration must be a no-op).
UPDATE users SET is_admin = true
WHERE id = (SELECT id FROM users ORDER BY created_at ASC LIMIT 1)
  AND NOT EXISTS (SELECT 1 FROM users WHERE is_admin = true);
