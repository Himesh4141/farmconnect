CREATE TABLE admin_events (
 id INTEGER PRIMARY KEY,
 actor_id TEXT NOT NULL REFERENCES users(id),
 action TEXT NOT NULL,
 target TEXT NOT NULL,
 reason TEXT NOT NULL,
 created_at INTEGER NOT NULL
) STRICT;
CREATE INDEX admin_events_recent ON admin_events(created_at DESC,id DESC);
CREATE TABLE listing_moderation (
 product_id TEXT PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
 blocked INTEGER NOT NULL CHECK(blocked IN (0,1)),
 reason TEXT NOT NULL,
 revision INTEGER NOT NULL DEFAULT 1,
 updated_at INTEGER NOT NULL
) STRICT;
CREATE TABLE store_controls (
 id INTEGER PRIMARY KEY CHECK(id=1),
 checkout_paused INTEGER NOT NULL DEFAULT 0 CHECK(checkout_paused IN (0,1)),
 revision INTEGER NOT NULL DEFAULT 0,
 reason TEXT NOT NULL DEFAULT ''
) STRICT;
INSERT INTO store_controls(id) VALUES (1);
CREATE INDEX orders_created ON orders(created_at DESC,id);
CREATE INDEX users_created ON users(created_at DESC,id);
