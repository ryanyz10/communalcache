-- NULL secrets identify legacy registry rows, not usable D1 caches.
-- Existing DO data is not silently migrated or reset by this additive migration.
ALTER TABLE caches ADD COLUMN join_secret TEXT CHECK(join_secret IS NULL OR length(join_secret) = 43);
ALTER TABLE caches ADD COLUMN requires_approval INTEGER NOT NULL DEFAULT 0 CHECK(requires_approval IN (0,1));
ALTER TABLE caches ADD COLUMN operation_token TEXT;
CREATE TABLE memberships (
  cache_id TEXT NOT NULL REFERENCES caches(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id),
  role TEXT NOT NULL CHECK(role IN ('owner','member')),
  status TEXT NOT NULL CHECK(status IN ('active','pending','removed')),
  created_at INTEGER NOT NULL,
  operation_token TEXT,
  PRIMARY KEY(cache_id,user_id),
  CHECK(role <> 'owner' OR status = 'active')
);
CREATE UNIQUE INDEX one_cache_owner ON memberships(cache_id) WHERE role = 'owner';
CREATE INDEX memberships_user ON memberships(user_id,status,cache_id);
