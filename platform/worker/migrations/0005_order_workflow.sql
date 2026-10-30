ALTER TABLE orders ADD COLUMN customer_note TEXT;
ALTER TABLE orders ADD COLUMN admin_note TEXT;
ALTER TABLE orders ADD COLUMN preview_text TEXT;
ALTER TABLE orders ADD COLUMN delivery_url TEXT;
ALTER TABLE orders ADD COLUMN reviewed_at TEXT;
ALTER TABLE orders ADD COLUMN paid_at TEXT;
ALTER TABLE orders ADD COLUMN delivered_at TEXT;

CREATE INDEX IF NOT EXISTS idx_orders_user_created ON orders(user_id, created_at);
