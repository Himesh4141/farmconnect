CREATE TABLE farms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120)
) STRICT;

CREATE TABLE products (
  id TEXT PRIMARY KEY,
  farm_id TEXT NOT NULL REFERENCES farms(id),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 160),
  category TEXT NOT NULL CHECK (category IN ('Vegetables', 'Fruits', 'Leafy greens')),
  unit TEXT NOT NULL CHECK (length(unit) BETWEEN 1 AND 40),
  price_paise INTEGER NOT NULL CHECK (price_paise BETWEEN 1 AND 100000000),
  bulk_price_paise INTEGER NOT NULL CHECK (bulk_price_paise BETWEEN 1 AND price_paise),
  bulk_min INTEGER NOT NULL CHECK (bulk_min BETWEEN 2 AND 10000),
  stock INTEGER NOT NULL CHECK (stock BETWEEN 0 AND 1000000),
  image TEXT NOT NULL,
  photo_credit TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  display_order INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE INDEX products_category_active ON products(category, active);
CREATE INDEX products_farm ON products(farm_id);

CREATE TABLE delivery_areas (
  pincode TEXT PRIMARY KEY CHECK (length(pincode) = 6 AND pincode NOT GLOB '*[^0-9]*'),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
) STRICT;
