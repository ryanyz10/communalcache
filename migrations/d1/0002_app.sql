CREATE TABLE caches (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE my_caches (
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  cache_id TEXT NOT NULL REFERENCES caches(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, cache_id)
);
CREATE INDEX my_caches_cache ON my_caches(cache_id);
CREATE TABLE push_subscriptions (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  endpoint TEXT UNIQUE NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX push_subscriptions_user ON push_subscriptions(user_id);
CREATE TABLE outbox (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL,
  dedupe_key TEXT NOT NULL,
  payload TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0),
  claim_until INTEGER,
  claim_token TEXT,
  sent_at INTEGER,
  failed_at INTEGER,
  created_at INTEGER NOT NULL,
  UNIQUE(kind, dedupe_key),
  CHECK(sent_at IS NULL OR failed_at IS NULL)
);
CREATE INDEX outbox_unsent ON outbox(created_at, claim_until)
  WHERE sent_at IS NULL AND failed_at IS NULL;
