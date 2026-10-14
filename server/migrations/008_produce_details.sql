ALTER TABLE products ADD COLUMN variety TEXT NOT NULL DEFAULT '' CHECK(length(variety)<=80);
ALTER TABLE products ADD COLUMN quality_notes TEXT NOT NULL DEFAULT '' CHECK(length(quality_notes)<=500);
ALTER TABLE products ADD COLUMN harvest_date TEXT NOT NULL DEFAULT '';
