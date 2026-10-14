CREATE TABLE farm_details (
 farm_id TEXT PRIMARY KEY REFERENCES farms(id),
 phone TEXT NOT NULL DEFAULT '',
 pickup_address TEXT NOT NULL DEFAULT '',
 city TEXT NOT NULL DEFAULT '',
 pincode TEXT NOT NULL DEFAULT '',
 evidence TEXT NOT NULL DEFAULT '',
 revision INTEGER NOT NULL DEFAULT 0
) STRICT;
INSERT INTO farm_details(farm_id,phone,pickup_address,evidence)
SELECT p.farm_id,COALESCE(a.phone,''),COALESCE(a.location,''),COALESCE(a.evidence,'') FROM account_profiles p LEFT JOIN access_applications a ON a.user_id=p.user_id WHERE p.account_type='farmer';
ALTER TABLE products ADD COLUMN archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0,1));
ALTER TABLE products ADD COLUMN published_once INTEGER NOT NULL DEFAULT 0 CHECK(published_once IN (0,1));
UPDATE products SET published_once=1 WHERE active=1 OR id IN (SELECT product_id FROM order_items);
ALTER TABLE farm_fulfillments ADD COLUMN rejection_reason TEXT NOT NULL DEFAULT '';
DELETE FROM access_invitations WHERE application_id IN (SELECT id FROM access_applications WHERE account_type='farmer');
UPDATE access_applications SET status='pending',review_note='Farmer activation no longer uses invitation codes. Awaiting direct review.',revision=revision+1 WHERE account_type='farmer' AND status='invited';
