CREATE TABLE IF NOT EXISTS order_deliveries (
  order_id TEXT PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
  object_key TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL CHECK(length(file_name) <= 180),
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK(size_bytes BETWEEN 1 AND 20971520),
  uploaded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS delivery_download_tokens (
  token_hash TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_delivery_tokens_expiry ON delivery_download_tokens(expires_at);
