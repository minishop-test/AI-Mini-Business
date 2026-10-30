INSERT OR IGNORE INTO platform_controls (control_key, control_value)
VALUES
  ('daily_budget_units', '10000'),
  ('daily_used_units', '0'),
  ('daily_budget_date_utc', '');

CREATE TABLE IF NOT EXISTS quota_reservations (
  id TEXT PRIMARY KEY,
  usage_event_id TEXT NOT NULL UNIQUE REFERENCES usage_events(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  service_id TEXT NOT NULL,
  reserved_units INTEGER NOT NULL CHECK (reserved_units > 0),
  reservation_date_utc TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('reserved', 'settled', 'released')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  settled_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_quota_res_user_service_date
  ON quota_reservations(user_id, service_id, reservation_date_utc);

CREATE INDEX IF NOT EXISTS idx_quota_res_date_status
  ON quota_reservations(reservation_date_utc, status);
