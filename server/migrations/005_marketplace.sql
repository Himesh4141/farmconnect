CREATE TABLE account_profiles (
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 account_type TEXT NOT NULL CHECK(account_type IN ('consumer','farmer','bulk_buyer')),
 business_name TEXT NOT NULL DEFAULT '',
 farm_id TEXT UNIQUE REFERENCES farms(id),
 CHECK((account_type='farmer' AND farm_id IS NOT NULL) OR (account_type!='farmer' AND farm_id IS NULL))
) STRICT;
INSERT INTO account_profiles(user_id,account_type) SELECT id,'consumer' FROM users;
ALTER TABLE orders ADD COLUMN purchase_kind TEXT NOT NULL DEFAULT 'consumer';
ALTER TABLE orders ADD COLUMN business_name TEXT NOT NULL DEFAULT '';
ALTER TABLE order_items ADD COLUMN farm_id TEXT REFERENCES farms(id);
ALTER TABLE order_items ADD COLUMN farm_name TEXT NOT NULL DEFAULT '';
UPDATE order_items SET farm_id=(SELECT farm_id FROM products WHERE products.id=order_items.product_id);
UPDATE order_items SET farm_name=(SELECT name FROM farms WHERE farms.id=order_items.farm_id);
CREATE TABLE farm_fulfillments (
 order_id TEXT NOT NULL REFERENCES orders(id),
 farm_id TEXT NOT NULL REFERENCES farms(id),
 status TEXT NOT NULL CHECK(status IN ('placed','confirmed','packed','ready_for_pickup','cancelled')),
 updated_at INTEGER NOT NULL,
 PRIMARY KEY(order_id,farm_id)
) STRICT;
CREATE TABLE farm_events (
 id INTEGER PRIMARY KEY,
 order_id TEXT NOT NULL,
 farm_id TEXT NOT NULL,
 actor_id TEXT NOT NULL REFERENCES users(id),
 status TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 FOREIGN KEY(order_id,farm_id) REFERENCES farm_fulfillments(order_id,farm_id)
) STRICT;
CREATE INDEX farm_fulfillments_farm ON farm_fulfillments(farm_id,updated_at DESC);
