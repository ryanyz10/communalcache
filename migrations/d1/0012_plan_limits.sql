CREATE TABLE plan_limits (
  plan TEXT PRIMARY KEY NOT NULL CHECK(plan IN ('free','plus')),
  owned_caches INTEGER NOT NULL CHECK(typeof(owned_caches)='integer' AND owned_caches>=0),
  new_caches_per_day INTEGER NOT NULL CHECK(typeof(new_caches_per_day)='integer' AND new_caches_per_day>=0),
  member_caches INTEGER NOT NULL CHECK(typeof(member_caches)='integer' AND member_caches>=0),
  cache_members INTEGER NOT NULL CHECK(typeof(cache_members)='integer' AND cache_members>=0),
  owned_items INTEGER NOT NULL CHECK(typeof(owned_items)='integer' AND owned_items>=0),
  open_requests INTEGER NOT NULL CHECK(typeof(open_requests)='integer' AND open_requests>=0),
  photos_per_item INTEGER NOT NULL CHECK(typeof(photos_per_item)='integer' AND photos_per_item>=0),
  profile_photos INTEGER NOT NULL CHECK(typeof(profile_photos)='integer' AND profile_photos>=0)
);
-- Plus is a placeholder: 3 owned caches and 100 cache members; other limits match free.
INSERT INTO plan_limits VALUES ('free',1,2,20,30,100,20,1,1),('plus',3,2,20,100,100,20,1,1);
ALTER TABLE caches ADD COLUMN plan TEXT NOT NULL DEFAULT 'free' CHECK(plan IN ('free','plus'));
ALTER TABLE user ADD COLUMN plan TEXT NOT NULL DEFAULT 'free' CHECK(plan IN ('free','plus'));
CREATE INDEX requests_pending_requester ON requests(requester_id) WHERE status='pending';
