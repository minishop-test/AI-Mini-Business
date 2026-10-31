ALTER TABLE orders ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'pending' CHECK(payment_status IN ('pending','paid','refunded'));
ALTER TABLE orders ADD COLUMN delivery_status TEXT NOT NULL DEFAULT 'pending' CHECK(delivery_status IN ('pending','delivered'));
