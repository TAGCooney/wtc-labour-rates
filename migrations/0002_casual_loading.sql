-- Per-award casual loading %, sourced from each award's own casual employment
-- clause (see scripts/casual_loading_data.py). NULL pct means no single flat %
-- applies -- the app must not silently default this to 25.

ALTER TABLE awards ADD COLUMN casual_loading_pct REAL;
ALTER TABLE awards ADD COLUMN casual_loading_clause TEXT;
ALTER TABLE awards ADD COLUMN casual_loading_confidence TEXT; -- confirmed | uncertain | complex | not_found
ALTER TABLE awards ADD COLUMN casual_loading_note TEXT;
