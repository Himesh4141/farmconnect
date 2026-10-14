CREATE TABLE google_identities (
  subject TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
) STRICT;
CREATE TABLE auth_settings (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  password_enabled INTEGER NOT NULL DEFAULT 1 CHECK(password_enabled IN (0,1))
) STRICT;
CREATE TABLE oauth_attempts (
  state_hash TEXT PRIMARY KEY,
  nonce TEXT NOT NULL,
  challenge TEXT NOT NULL,
  portal TEXT NOT NULL,
  mobile INTEGER NOT NULL,
  link_user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  ticket_hash TEXT UNIQUE,
  identity_json TEXT
) STRICT;
CREATE TABLE session_details (
  token_hash TEXT PRIMARY KEY REFERENCES sessions(token_hash) ON DELETE CASCADE,
  id TEXT NOT NULL UNIQUE,
  device TEXT NOT NULL,
  created_at INTEGER NOT NULL
) STRICT;
CREATE TABLE security_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event TEXT NOT NULL,
  created_at INTEGER NOT NULL
) STRICT;
CREATE INDEX security_events_user ON security_events(user_id, id DESC);
