CREATE TABLE IF NOT EXISTS admin_login_attempts (
  ip_hash TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0),
  window_started TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_login_attempts_window
ON admin_login_attempts(window_started);
