-- Preserve memberships and owner constraints while distinguishing voluntary leave from removal.
CREATE TABLE memberships_new (
  cache_id TEXT NOT NULL REFERENCES caches(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id),
  role TEXT NOT NULL CHECK(role IN ('owner','member')),
  status TEXT NOT NULL CHECK(status IN ('active','pending','removed','left')),
  created_at INTEGER NOT NULL,
  operation_token TEXT,
  PRIMARY KEY(cache_id,user_id),
  CHECK(role <> 'owner' OR status='active')
);
INSERT INTO memberships_new(cache_id,user_id,role,status,created_at,operation_token)
  SELECT cache_id,user_id,role,status,created_at,operation_token FROM memberships;
DROP TABLE memberships;
ALTER TABLE memberships_new RENAME TO memberships;
CREATE UNIQUE INDEX one_cache_owner ON memberships(cache_id) WHERE role='owner';
CREATE INDEX memberships_user ON memberships(user_id,status,cache_id);
