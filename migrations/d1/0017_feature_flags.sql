CREATE TABLE feature_flags (
  key TEXT PRIMARY KEY NOT NULL CHECK(key IN ('google_sign_in')),
  enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
  updated_at INTEGER NOT NULL,
  updated_by TEXT NULL
);
INSERT INTO feature_flags(key,enabled,updated_at,updated_by)
  VALUES ('google_sign_in',1,unixepoch()*1000,NULL);
