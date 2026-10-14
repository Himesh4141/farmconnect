CREATE TABLE customer_details (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  phone TEXT NOT NULL DEFAULT '',
  revision INTEGER NOT NULL DEFAULT 0,
  default_address_id TEXT REFERENCES saved_addresses(id) ON DELETE SET NULL
) STRICT;
ALTER TABLE saved_addresses ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
