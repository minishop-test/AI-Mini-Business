INSERT OR IGNORE INTO platform_controls (control_key, control_value)
VALUES ('ai_generation_enabled', 'false');

CREATE TABLE IF NOT EXISTS ai_generations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  usage_event_id TEXT NOT NULL UNIQUE REFERENCES usage_events(id) ON DELETE CASCADE,
  service_id TEXT NOT NULL,
  input_brief TEXT NOT NULL,
  output_text TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ai_generations_user_created
  ON ai_generations(user_id, created_at);
