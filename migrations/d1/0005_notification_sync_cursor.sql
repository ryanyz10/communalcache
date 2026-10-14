CREATE TABLE notification_sync_cursor (
  singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
  outbox_id TEXT
);
INSERT INTO notification_sync_cursor(singleton, outbox_id) VALUES (1, NULL);
