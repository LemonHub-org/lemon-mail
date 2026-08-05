ALTER TABLE mailboxes ADD COLUMN password_salt TEXT NOT NULL DEFAULT '';
ALTER TABLE mailboxes ADD COLUMN password_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE mailboxes DROP COLUMN destination;

CREATE TABLE emails (
  id TEXT PRIMARY KEY,
  mailbox_id TEXT NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
  sender TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  body_text TEXT,
  body_html TEXT,
  size INTEGER NOT NULL,
  is_read INTEGER NOT NULL DEFAULT 0,
  received_at TEXT NOT NULL
);
CREATE INDEX idx_emails_mailbox ON emails(mailbox_id, received_at DESC);

CREATE TABLE auth_sessions (
  token TEXT PRIMARY KEY,
  mailbox_id TEXT NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
