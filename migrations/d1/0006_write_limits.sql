-- Four reusable counters per user, not one row per URL or time window.
CREATE TABLE write_limits (
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  route TEXT NOT NULL CHECK(route IN ('join', 'join_decision', 'request', 'request_decision')),
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL CHECK(count > 0),
  PRIMARY KEY(user_id, route)
);
