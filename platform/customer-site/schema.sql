PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 160),
  description TEXT NOT NULL DEFAULT '' CHECK(length(description) <= 3000),
  price_vnd INTEGER NOT NULL CHECK(price_vnd >= 0),
  image_url TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  customer_name TEXT NOT NULL CHECK(length(customer_name) BETWEEN 1 AND 120),
  customer_email TEXT NOT NULL CHECK(length(customer_email) <= 254),
  customer_phone TEXT NOT NULL DEFAULT '' CHECK(length(customer_phone) <= 30),
  product_id TEXT NOT NULL REFERENCES products(id),
  product_name_snapshot TEXT NOT NULL,
  unit_price_vnd INTEGER NOT NULL CHECK(unit_price_vnd >= 0),
  quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 20),
  total_vnd INTEGER NOT NULL CHECK(total_vnd >= 0),
  note TEXT NOT NULL DEFAULT '' CHECK(length(note) <= 1000),
  status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new','confirmed','completed','cancelled')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_products_active ON products(active, created_at);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status, created_at);

CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash TEXT PRIMARY KEY,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_expiry
ON admin_sessions(expires_at);

CREATE TABLE IF NOT EXISTS admin_login_attempts (
  ip_hash TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0),
  window_started TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_login_attempts_window
ON admin_login_attempts(window_started);
