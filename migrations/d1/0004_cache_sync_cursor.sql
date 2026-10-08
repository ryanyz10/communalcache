-- Registry sweeps discover work only; this cursor never authorizes membership.
CREATE TABLE cache_sync_cursor (
  singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
  cache_id TEXT
);
INSERT INTO cache_sync_cursor(singleton, cache_id) VALUES (1, NULL);
