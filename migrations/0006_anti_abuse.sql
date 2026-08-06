ALTER TABLE mailboxes ADD COLUMN device_id TEXT;
ALTER TABLE mailboxes ADD COLUMN creator_ip TEXT;
CREATE INDEX idx_mailboxes_device ON mailboxes(device_id);

CREATE TABLE registrations (
  id TEXT PRIMARY KEY,
  local_part TEXT NOT NULL,
  device_id TEXT,
  ip TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'accepted',
  created_at TEXT NOT NULL
);
CREATE INDEX idx_registrations_ip ON registrations(ip, created_at DESC);
