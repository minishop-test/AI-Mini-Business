PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT,
  role TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('customer', 'admin')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS service_settings (
  service_id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  guest_free_uses INTEGER NOT NULL DEFAULT 0 CHECK (guest_free_uses >= 0),
  registered_free_uses INTEGER NOT NULL DEFAULT 1 CHECK (registered_free_uses >= 0),
  max_input_chars INTEGER NOT NULL DEFAULT 5000 CHECK (max_input_chars > 0),
  max_output_tokens INTEGER NOT NULL DEFAULT 1200 CHECK (max_output_tokens > 0),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS usage_events (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id),
  guest_key_hash TEXT,
  service_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('reserved', 'completed', 'failed', 'refunded')),
  units INTEGER NOT NULL DEFAULT 1 CHECK (units > 0),
  provider TEXT,
  model TEXT,
  estimated_cost_units INTEGER NOT NULL DEFAULT 0,
  actual_cost_units INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_usage_user_service_created
  ON usage_events(user_id, service_id, created_at);

CREATE INDEX IF NOT EXISTS idx_usage_guest_service_created
  ON usage_events(guest_key_hash, service_id, created_at);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id),
  service_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_review'
    CHECK (status IN ('pending_review', 'awaiting_payment', 'paid', 'processing', 'delivered', 'cancelled')),
  customer_brief TEXT NOT NULL,
  output_object_key TEXT,
  amount_vnd INTEGER NOT NULL DEFAULT 0 CHECK (amount_vnd >= 0),
  payment_reference TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_orders_status_created ON orders(status, created_at);

CREATE TABLE IF NOT EXISTS platform_controls (
  control_key TEXT PRIMARY KEY,
  control_value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO platform_controls (control_key, control_value)
VALUES ('global_ai_pause', 'true'), ('daily_budget_enabled', 'true');
