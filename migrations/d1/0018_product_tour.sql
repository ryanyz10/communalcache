ALTER TABLE user ADD COLUMN tour_completed_at INTEGER
  CHECK (tour_completed_at IS NULL OR (typeof(tour_completed_at) = 'integer' AND tour_completed_at >= 0));
