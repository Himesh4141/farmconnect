CREATE TABLE inventory_adjustments (
 id INTEGER PRIMARY KEY,
 product_id TEXT REFERENCES products(id) ON DELETE SET NULL,
 actor_id TEXT NOT NULL REFERENCES users(id),
 sale_mode TEXT NOT NULL, quantity_change INTEGER NOT NULL,
 previous_stock INTEGER NOT NULL, new_stock INTEGER NOT NULL,
 reason TEXT NOT NULL, created_at INTEGER NOT NULL
) STRICT;
CREATE INDEX inventory_adjustments_product ON inventory_adjustments(product_id,created_at);
