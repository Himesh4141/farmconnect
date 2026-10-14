CREATE TABLE product_photos (
 id TEXT PRIMARY KEY, farm_id TEXT NOT NULL REFERENCES farms(id),
 bytes BLOB NOT NULL, created_at INTEGER NOT NULL
) STRICT;
CREATE INDEX product_photos_farm ON product_photos(farm_id,created_at);
