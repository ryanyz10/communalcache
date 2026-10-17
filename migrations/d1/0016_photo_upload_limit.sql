-- Abuse admission uses the same reusable per-user counters, not plan entitlements.
CREATE TABLE write_limits_next (
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  route TEXT NOT NULL CHECK(route IN ('join', 'join_decision', 'request', 'request_decision', 'photo_upload')),
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL CHECK(count > 0),
  PRIMARY KEY(user_id, route)
);
INSERT INTO write_limits_next(user_id,route,window_start,count)
  SELECT user_id,route,window_start,count FROM write_limits;
DROP TABLE write_limits;
ALTER TABLE write_limits_next RENAME TO write_limits;
CREATE INDEX r2_cleanup_created_at ON r2_cleanup(created_at);
