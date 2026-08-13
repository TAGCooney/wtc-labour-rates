-- Adds an 'owner' role (protected -- can't be deactivated/demoted by anyone,
-- only owner can promote/demote admins), an 'active' flag for soft-deactivating
-- accounts (not hard delete, so past quotes stay correctly attributed), and an
-- app_settings table so the on-cost floor % and default margin % can be edited
-- by an owner instead of living as hardcoded constants in the code.

-- SQLite can't ALTER a CHECK constraint in place, so recreate the table.
-- quotes.staff_id references staff_users(id) -- disable FK checks for the swap.
PRAGMA foreign_keys=OFF;

CREATE TABLE staff_users_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner','admin','staff')),
  pw_salt TEXT NOT NULL,
  pw_hash TEXT NOT NULL,
  pw_iter INTEGER NOT NULL DEFAULT 100000,
  must_change INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  invite_token_hash TEXT,
  invite_expires_at TEXT,
  active INTEGER NOT NULL DEFAULT 1
);
INSERT INTO staff_users_new (id, email, name, role, pw_salt, pw_hash, pw_iter, must_change, created_at, invite_token_hash, invite_expires_at, active)
  SELECT id, email, name, role, pw_salt, pw_hash, pw_iter, must_change, created_at, invite_token_hash, invite_expires_at, 1 FROM staff_users;
DROP TABLE staff_users;
ALTER TABLE staff_users_new RENAME TO staff_users;

CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT INTO app_settings (key, value) VALUES ('oncost_floor_pct', '22.7'), ('default_margin_pct', '15');

PRAGMA foreign_keys=ON;
