CREATE TABLE items (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL REFERENCES user(id),
  title TEXT NOT NULL, description TEXT, photo_path TEXT,
  is_consumable INTEGER NOT NULL CHECK(is_consumable IN (0,1)),
  quantity INTEGER,
  available INTEGER NOT NULL DEFAULT 1 CHECK(available IN (0,1)),
  unavailable_note TEXT, created_at INTEGER NOT NULL, operation_token TEXT,
  CHECK(is_consumable = (quantity IS NOT NULL)),
  CHECK(quantity IS NULL OR (typeof(quantity) = 'integer' AND quantity BETWEEN 0 AND 9999))
);
CREATE INDEX items_owner ON items(owner_id,created_at,id);
CREATE INDEX items_photo ON items(photo_path) WHERE photo_path IS NOT NULL;
CREATE TABLE item_caches (
  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  cache_id TEXT NOT NULL REFERENCES caches(id) ON DELETE CASCADE,
  attached_at INTEGER NOT NULL, operation_token TEXT,
  PRIMARY KEY(item_id,cache_id)
);
CREATE INDEX item_caches_cache ON item_caches(cache_id,item_id);
-- No source-item FK: cleanup must survive item deletion.
CREATE TABLE r2_cleanup (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL, item_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('exact','prefix')),
  target TEXT NOT NULL, created_at INTEGER NOT NULL,
  claim_token TEXT, claim_until INTEGER,
  UNIQUE(kind,target)
);
CREATE TABLE r2_cleanup_cursor (
  singleton INTEGER PRIMARY KEY CHECK(singleton=1),
  cleanup_id TEXT
);
INSERT INTO r2_cleanup_cursor(singleton,cleanup_id) VALUES (1,NULL);
