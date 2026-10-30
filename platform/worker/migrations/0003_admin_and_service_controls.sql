CREATE TABLE IF NOT EXISTS admin_audit_log (
  id TEXT PRIMARY KEY,
  admin_user_id TEXT NOT NULL REFERENCES users(id),
  action TEXT NOT NULL,
  target_id TEXT,
  details_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit_log(created_at);

INSERT OR IGNORE INTO service_settings
  (service_id, enabled, guest_free_uses, registered_free_uses, max_input_chars, max_output_tokens)
VALUES
  ('website', 0, 0, 2, 8000, 2000),
  ('video-prompts', 0, 1, 1, 5000, 1500),
  ('logo', 0, 0, 2, 2000, 1000),
  ('business-content', 0, 1, 1, 5000, 1500),
  ('documents', 0, 1, 1, 8000, 2000);
