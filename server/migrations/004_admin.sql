CREATE TABLE orders_new (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id),
 request_key TEXT NOT NULL,
 request_hash TEXT NOT NULL,
 address_json TEXT NOT NULL,
 subtotal_paise INTEGER NOT NULL CHECK(subtotal_paise > 0),
 delivery_fee_paise INTEGER NOT NULL CHECK(delivery_fee_paise >= 0),
 status TEXT NOT NULL CHECK(status IN ('placed','confirmed','packed','out_for_delivery','delivered','cancelled')),
 payment_method TEXT NOT NULL CHECK(payment_method = 'cod'),
 payment_status TEXT NOT NULL CHECK(payment_status IN ('pending','paid','cancelled')),
 created_at INTEGER NOT NULL,
 UNIQUE(user_id, request_key)
) STRICT;

CREATE TABLE order_items_new (
 order_id TEXT NOT NULL REFERENCES orders_new(id),
 product_id TEXT NOT NULL REFERENCES products(id),
 name TEXT NOT NULL,
 unit TEXT NOT NULL,
 quantity INTEGER NOT NULL CHECK(quantity > 0),
 unit_price_paise INTEGER NOT NULL CHECK(unit_price_paise > 0),
 PRIMARY KEY(order_id, product_id)
) STRICT;

INSERT INTO orders_new SELECT * FROM orders;
INSERT INTO order_items_new SELECT * FROM order_items;
DROP TABLE order_items;
DROP TABLE orders;
ALTER TABLE orders_new RENAME TO orders;
ALTER TABLE order_items_new RENAME TO order_items;
CREATE INDEX orders_user_created ON orders(user_id, created_at DESC);
ALTER TABLE products ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
CREATE TABLE admin_users (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE) STRICT;
CREATE TABLE order_events (
 id INTEGER PRIMARY KEY,
 order_id TEXT NOT NULL REFERENCES orders(id),
 actor_id TEXT NOT NULL REFERENCES users(id),
 status TEXT NOT NULL,
 created_at INTEGER NOT NULL
) STRICT;
