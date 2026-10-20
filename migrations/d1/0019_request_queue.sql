-- Keep pending stock lookups and queue-position counts on the same item-first index.
DROP INDEX pending_requests;
CREATE INDEX pending_requests ON requests(item_id,created_at,id) WHERE status='pending';
