CREATE TABLE requests (
  id TEXT PRIMARY KEY NOT NULL,
  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  cache_id TEXT NOT NULL REFERENCES caches(id),
  requester_id TEXT NOT NULL REFERENCES user(id),
  quantity INTEGER,
  status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected')),
  decision_reason TEXT, decided_at INTEGER, created_at INTEGER NOT NULL,
  creation_token TEXT NOT NULL, decision_token TEXT,
  CHECK(quantity IS NULL OR (typeof(quantity)='integer' AND quantity BETWEEN 1 AND 9999)),
  CHECK((status='pending')=(decided_at IS NULL)),
  CHECK(status<>'rejected' OR decision_reason IS NOT NULL)
);
CREATE INDEX pending_requests ON requests(item_id) WHERE status='pending';
CREATE INDEX requests_cache_item ON requests(cache_id,item_id,status);
CREATE INDEX requests_requester ON requests(requester_id,created_at DESC,id DESC);
CREATE INDEX requests_item_history ON requests(item_id,created_at DESC,id DESC);
