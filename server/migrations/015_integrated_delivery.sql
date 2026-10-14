ALTER TABLE orders ADD COLUMN delivery_mode TEXT NOT NULL DEFAULT 'unconnected' CHECK(delivery_mode IN ('unconnected','demo'));
UPDATE orders SET delivery_mode='demo' WHERE EXISTS(SELECT 1 FROM demo_shipments d WHERE d.order_id=orders.id);
