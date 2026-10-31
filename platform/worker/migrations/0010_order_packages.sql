ALTER TABLE orders ADD COLUMN package_key TEXT;
ALTER TABLE orders ADD COLUMN package_size INTEGER;
ALTER TABLE orders ADD COLUMN package_uploaded_at TEXT;

CREATE INDEX IF NOT EXISTS idx_orders_package_key ON orders(package_key);
