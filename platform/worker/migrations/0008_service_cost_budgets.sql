ALTER TABLE service_settings ADD COLUMN estimated_cost_units_per_use INTEGER NOT NULL DEFAULT 1000 CHECK (estimated_cost_units_per_use BETWEEN 1 AND 1000000);
ALTER TABLE service_settings ADD COLUMN daily_request_limit INTEGER NOT NULL DEFAULT 100 CHECK (daily_request_limit BETWEEN 1 AND 10000);

UPDATE service_settings SET estimated_cost_units_per_use = 3000, daily_request_limit = 10 WHERE service_id = 'website';
UPDATE service_settings SET estimated_cost_units_per_use = 700, daily_request_limit = 100 WHERE service_id = 'video-prompts';
UPDATE service_settings SET estimated_cost_units_per_use = 2500, daily_request_limit = 20 WHERE service_id = 'logo';
UPDATE service_settings SET estimated_cost_units_per_use = 700, daily_request_limit = 100 WHERE service_id = 'business-content';
UPDATE service_settings SET estimated_cost_units_per_use = 900, daily_request_limit = 60 WHERE service_id = 'documents';

INSERT OR IGNORE INTO platform_controls (control_key, control_value)
VALUES ('daily_budget_units', '10000');
