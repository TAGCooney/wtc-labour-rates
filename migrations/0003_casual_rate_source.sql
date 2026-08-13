-- Records how the casual rate for a saved quote was determined: from the award's
-- own official casual pay table ('award_table'), from the fallback loading %
-- ('loading_fallback'), or not applicable ('not_casual').
ALTER TABLE quotes ADD COLUMN casual_rate_source TEXT;
