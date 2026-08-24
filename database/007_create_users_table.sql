-- =========================================================
-- Auth: Admin users
-- =========================================================
-- Only "admin" accounts live in the database. "guest" is not a stored
-- account — guests log in with a shared PIN (kept in server config, not
-- the DB) plus a free-text display name, and get a restricted session.
-- See services/authService.js.

DROP TABLE IF EXISTS app_user CASCADE;

CREATE TABLE app_user (

  user_id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  username VARCHAR(50) NOT NULL UNIQUE,

  password_hash VARCHAR(200) NOT NULL,

  display_name VARCHAR(100) NOT NULL,

  is_active BOOLEAN NOT NULL DEFAULT TRUE,

  last_login_at TIMESTAMP,

  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP

);

-- Session store for express-session (connect-pg-simple). This table's
-- shape is dictated by connect-pg-simple itself; created here so the
-- app never needs createTableIfMissing at runtime.
CREATE TABLE IF NOT EXISTS session (
  sid VARCHAR NOT NULL COLLATE "default" PRIMARY KEY,
  sess JSON NOT NULL,
  expire TIMESTAMP(6) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_session_expire ON session (expire);
