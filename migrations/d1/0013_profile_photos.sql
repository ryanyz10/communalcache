-- App-owned photo state stays separate from Better Auth's user output.
CREATE TABLE user_photos (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  photo_path TEXT NOT NULL UNIQUE,
  operation_token TEXT NOT NULL
);

-- Keep existing cleanup identities, claims and item scope; profile work is exact-key only.
CREATE TABLE r2_cleanup_next (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL, item_id TEXT,
  kind TEXT NOT NULL CHECK(kind IN ('exact','prefix')),
  target TEXT NOT NULL, created_at INTEGER NOT NULL,
  claim_token TEXT, claim_until INTEGER,
  scope TEXT NOT NULL DEFAULT 'item' CHECK(scope IN ('item','profile')),
  CHECK((scope='item' AND item_id IS NOT NULL) OR (scope='profile' AND item_id IS NULL AND kind='exact')),
  UNIQUE(kind,target)
);
INSERT INTO r2_cleanup_next(id,owner_id,item_id,kind,target,created_at,claim_token,claim_until,scope)
  SELECT id,owner_id,item_id,kind,target,created_at,claim_token,claim_until,'item' FROM r2_cleanup;
DROP TABLE r2_cleanup;
ALTER TABLE r2_cleanup_next RENAME TO r2_cleanup;
