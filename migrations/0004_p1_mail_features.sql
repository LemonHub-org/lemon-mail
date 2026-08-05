-- P1: richer email metadata (display name, recipients, message-id, attachment meta)

ALTER TABLE emails ADD COLUMN sender_name TEXT;
ALTER TABLE emails ADD COLUMN to_addrs TEXT;
ALTER TABLE emails ADD COLUMN cc_addrs TEXT;
ALTER TABLE emails ADD COLUMN message_id TEXT;
ALTER TABLE emails ADD COLUMN attachments_json TEXT;
