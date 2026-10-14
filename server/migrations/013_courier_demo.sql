-- Test deliveries are separate from real fulfillment and payment records.
CREATE TABLE demo_shipments (
 id TEXT PRIMARY KEY,
 order_id TEXT NOT NULL,
 farm_id TEXT NOT NULL,
 tracking_number TEXT NOT NULL UNIQUE,
 status TEXT NOT NULL CHECK(status IN ('pickup_requested','picked_up','in_transit','out_for_delivery','delivered')),
 pickup_json TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL,
 revision INTEGER NOT NULL DEFAULT 0,
 UNIQUE(order_id,farm_id),
 FOREIGN KEY(order_id,farm_id) REFERENCES farm_fulfillments(order_id,farm_id)
) STRICT;
CREATE TABLE demo_shipment_events (
 id INTEGER PRIMARY KEY,
 shipment_id TEXT NOT NULL REFERENCES demo_shipments(id),
 actor_id TEXT NOT NULL REFERENCES users(id),
 status TEXT NOT NULL,
 created_at INTEGER NOT NULL
) STRICT;
CREATE INDEX demo_shipment_events_shipment ON demo_shipment_events(shipment_id,id);
