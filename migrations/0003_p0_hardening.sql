-- P0: rate limits, mailbox used_bytes for atomic quota, session expiry index

CREATE TABLE rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  window_start INTEGER NOT NULL
);

ALTER TABLE mailboxes ADD COLUMN used_bytes INTEGER NOT NULL DEFAULT 0;

UPDATE mailboxes SET used_bytes = COALESCE(
  (SELECT SUM(size) FROM emails WHERE emails.mailbox_id = mailboxes.id),
  0
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires ON auth_sessions (expires_at);
