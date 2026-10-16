ALTER TABLE user ADD COLUMN cat_coat TEXT
  CHECK(cat_coat IS NULL OR cat_coat IN ('ginger','grey','dusk','oat','ash','toffee'));
