-- App-owned chosen contact, never part of Better Auth's user/session output.
CREATE TABLE user_contacts (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('sms','whatsapp','signal','messenger','instagram','email')),
  value TEXT NOT NULL CHECK(length(value) BETWEEN 1 AND 254)
);
ALTER TABLE requests ADD COLUMN approval_message TEXT
  CHECK(approval_message IS NULL OR (status='approved' AND length(approval_message)<=500));
