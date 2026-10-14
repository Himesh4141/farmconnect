CREATE TABLE delivery_partners (
 user_id TEXT PRIMARY KEY REFERENCES users(id),
 phone TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','suspended')),
 created_at INTEGER NOT NULL
) STRICT;
ALTER TABLE demo_shipments ADD COLUMN assigned_to TEXT REFERENCES delivery_partners(user_id);
CREATE INDEX demo_shipments_assignment ON demo_shipments(assigned_to,updated_at);
CREATE TABLE delivery_access_events (
 id INTEGER PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES delivery_partners(user_id),
 action TEXT NOT NULL,
 created_at INTEGER NOT NULL
) STRICT;
