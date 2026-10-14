ALTER TABLE account_profiles ADD COLUMN access_status TEXT NOT NULL DEFAULT 'approved' CHECK(access_status IN ('approved','pending','suspended'));
UPDATE account_profiles SET access_status='pending' WHERE account_type!='consumer';
CREATE TABLE access_applications (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL UNIQUE REFERENCES users(id),
 account_type TEXT NOT NULL CHECK(account_type IN ('farmer','bulk_buyer')),
 business_name TEXT NOT NULL,
 phone TEXT NOT NULL,
 location TEXT NOT NULL,
 evidence TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('pending','needs_information','rejected','invited','approved')),
 review_note TEXT NOT NULL DEFAULT '',
 revision INTEGER NOT NULL DEFAULT 0,
 updated_at INTEGER NOT NULL
) STRICT;
INSERT INTO access_applications(id,user_id,account_type,business_name,phone,location,evidence,status,review_note,updated_at)
SELECT user_id,user_id,account_type,business_name,'','','','needs_information','Previously self-selected role. Submit verification details for approval.',0 FROM account_profiles WHERE account_type!='consumer';
CREATE TABLE access_invitations (
 token_hash TEXT PRIMARY KEY,
 application_id TEXT NOT NULL UNIQUE REFERENCES access_applications(id),
 user_id TEXT NOT NULL REFERENCES users(id),
 email TEXT NOT NULL,
 expires_at INTEGER NOT NULL
) STRICT;
CREATE TABLE access_events (
 id INTEGER PRIMARY KEY,
 application_id TEXT REFERENCES access_applications(id),
 actor_id TEXT NOT NULL REFERENCES users(id),
 target_user_id TEXT NOT NULL REFERENCES users(id),
 action TEXT NOT NULL,
 note TEXT NOT NULL,
 created_at INTEGER NOT NULL
) STRICT;
