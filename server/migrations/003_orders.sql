CREATE TABLE orders (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id),
 request_key TEXT NOT NULL,
 request_hash TEXT NOT NULL,
 address_json TEXT NOT NULL,
 subtotal_paise INTEGER NOT NULL CHECK(subtotal_paise > 0),
 delivery_fee_paise INTEGER NOT NULL CHECK(delivery_fee_paise >= 0),
 status TEXT NOT NULL CHECK(status IN ('placed')),
 payment_method TEXT NOT NULL CHECK(payment_method = 'cod'),
 payment_status TEXT NOT NULL CHECK(payment_status = 'pending'),
 created_at INTEGER NOT NULL,
 UNIQUE(user_id, request_key)
) STRICT;
CREATE INDEX orders_user_created ON orders(user_id, created_at DESC);
CREATE TABLE order_items (
 order_id TEXT NOT NULL REFERENCES orders(id),
 product_id TEXT NOT NULL REFERENCES products(id),
 name TEXT NOT NULL,
 unit TEXT NOT NULL,
 quantity INTEGER NOT NULL CHECK(quantity > 0),
 unit_price_paise INTEGER NOT NULL CHECK(unit_price_paise > 0),
 PRIMARY KEY(order_id, product_id)
) STRICT;
