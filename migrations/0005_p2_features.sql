-- P2: stars, folders, labels, filters, FTS, blocked prefixes (no R2 / no send)

ALTER TABLE emails ADD COLUMN is_starred INTEGER NOT NULL DEFAULT 0;
ALTER TABLE emails ADD COLUMN folder TEXT NOT NULL DEFAULT 'inbox';
ALTER TABLE emails ADD COLUMN labels_json TEXT;

CREATE INDEX IF NOT EXISTS idx_emails_mailbox_folder ON emails (mailbox_id, folder, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_emails_mailbox_starred ON emails (mailbox_id, is_starred);

CREATE TABLE mail_filters (
  id TEXT PRIMARY KEY,
  mailbox_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  match_field TEXT NOT NULL,
  match_op TEXT NOT NULL DEFAULT 'contains',
  match_value TEXT NOT NULL,
  action TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mail_filters_mailbox ON mail_filters (mailbox_id);

CREATE TABLE blocked_prefixes (
  local_part TEXT PRIMARY KEY,
  reason TEXT,
  created_at TEXT NOT NULL
);

CREATE VIRTUAL TABLE emails_fts USING fts5(
  email_id UNINDEXED,
  mailbox_id UNINDEXED,
  subject,
  sender,
  sender_name,
  body_text,
  tokenize = 'unicode61'
);

INSERT INTO emails_fts (email_id, mailbox_id, subject, sender, sender_name, body_text)
SELECT id, mailbox_id, subject, sender, IFNULL(sender_name, ''), IFNULL(body_text, '')
FROM emails;
