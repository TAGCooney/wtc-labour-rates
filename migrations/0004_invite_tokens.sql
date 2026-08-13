-- Replaces the "temp password shown once" account-creation flow with a secure
-- setup link: a one-time token the new user clicks to set their own password,
-- so no password (temp or real) ever has to travel through email/chat.
ALTER TABLE staff_users ADD COLUMN invite_token_hash TEXT;
ALTER TABLE staff_users ADD COLUMN invite_expires_at TEXT;
