CREATE TABLE order_payments (
 order_id TEXT PRIMARY KEY REFERENCES orders(id),
 provider_order_id TEXT UNIQUE,
 provider_payment_id TEXT UNIQUE,
 amount_paise INTEGER NOT NULL CHECK(amount_paise > 0),
 state TEXT NOT NULL DEFAULT 'creating' CHECK(state IN ('creating','pending','paid','expired','review')),
 expires_at INTEGER NOT NULL,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL,
 is_test INTEGER NOT NULL CHECK(is_test IN (0,1))
) STRICT;
CREATE TABLE payment_events (
 event_id TEXT PRIMARY KEY,
 received_at INTEGER NOT NULL
) STRICT;
CREATE TABLE payment_refunds (
 id TEXT PRIMARY KEY,
 order_id TEXT NOT NULL REFERENCES orders(id),
 amount_paise INTEGER NOT NULL CHECK(amount_paise > 0),
 provider_refund_id TEXT UNIQUE,
 state TEXT NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','submitted','processed','review')),
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL,
 last_error TEXT NOT NULL DEFAULT ''
) STRICT;
CREATE INDEX payment_refunds_order ON payment_refunds(order_id);
CREATE TABLE external_shipments (
 id TEXT PRIMARY KEY,
 order_id TEXT NOT NULL,
 farm_id TEXT NOT NULL,
 provider TEXT NOT NULL CHECK(provider='delhivery'),
 waybill TEXT NOT NULL UNIQUE,
 status TEXT NOT NULL DEFAULT 'pickup_requested',
 provider_status TEXT NOT NULL DEFAULT 'Awaiting first tracking update',
 last_checked_at INTEGER,
 updated_at INTEGER NOT NULL,
 created_by TEXT NOT NULL REFERENCES users(id),
 UNIQUE(order_id,farm_id),
 FOREIGN KEY(order_id,farm_id) REFERENCES farm_fulfillments(order_id,farm_id)
) STRICT;
CREATE TABLE external_shipment_events (
 id INTEGER PRIMARY KEY,
 shipment_id TEXT NOT NULL REFERENCES external_shipments(id),
 status TEXT NOT NULL,
 provider_status TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 UNIQUE(shipment_id,status,provider_status)
) STRICT;
CREATE TABLE saved_addresses (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id),
 label TEXT NOT NULL,
 address_json TEXT NOT NULL,
 updated_at INTEGER NOT NULL
) STRICT;
CREATE INDEX saved_addresses_owner ON saved_addresses(user_id,updated_at DESC);
