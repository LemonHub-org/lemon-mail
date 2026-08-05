CREATE TABLE mailboxes (
  id TEXT PRIMARY KEY,
  local_part TEXT NOT NULL UNIQUE,
  destination TEXT NOT NULL,
  created_at TEXT NOT NULL
);
