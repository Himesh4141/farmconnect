CREATE TABLE saved_products (
 user_id TEXT NOT NULL REFERENCES users(id),
 product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
 created_at INTEGER NOT NULL,
 PRIMARY KEY(user_id,product_id)
) STRICT;
CREATE TABLE product_reviews (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id),
 product_id TEXT NOT NULL REFERENCES products(id),
 order_id TEXT NOT NULL REFERENCES orders(id),
 rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
 comment TEXT NOT NULL,
 is_demo INTEGER NOT NULL CHECK(is_demo IN (0,1)),
 hidden INTEGER NOT NULL DEFAULT 0 CHECK(hidden IN (0,1)),
 moderation_reason TEXT NOT NULL DEFAULT '',
 revision INTEGER NOT NULL DEFAULT 0,
 updated_at INTEGER NOT NULL,
 UNIQUE(user_id,product_id)
) STRICT;
CREATE INDEX reviews_product ON product_reviews(product_id,hidden,is_demo,updated_at DESC);
CREATE TABLE order_help (
 id TEXT PRIMARY KEY,
 order_id TEXT NOT NULL,
 product_id TEXT NOT NULL,
 user_id TEXT NOT NULL REFERENCES users(id),
 farm_id TEXT NOT NULL REFERENCES farms(id),
 category TEXT NOT NULL CHECK(category IN ('quality','missing','wrong','delivery','other')),
 status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved','declined')),
 revision INTEGER NOT NULL DEFAULT 0,
 refund_id TEXT UNIQUE REFERENCES payment_refunds(id),
 refund_paise INTEGER NOT NULL DEFAULT 0 CHECK(refund_paise>=0),
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL,
 UNIQUE(order_id,product_id),
 FOREIGN KEY(order_id,product_id) REFERENCES order_items(order_id,product_id)
) STRICT;
CREATE INDEX help_owner ON order_help(user_id,updated_at DESC);
CREATE INDEX help_farm ON order_help(farm_id,status,updated_at DESC);
CREATE TABLE help_messages (
 id TEXT PRIMARY KEY,
 case_id TEXT NOT NULL REFERENCES order_help(id),
 author_id TEXT NOT NULL REFERENCES users(id),
 author_role TEXT NOT NULL CHECK(author_role IN ('buyer','farmer','admin')),
 message TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 request_key TEXT NOT NULL,
 UNIQUE(case_id,author_id,request_key)
) STRICT;
