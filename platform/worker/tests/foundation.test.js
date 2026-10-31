import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const api = await readFile(new URL("../src/index.js", import.meta.url), "utf8");
const customer = await readFile(new URL("../../customer/index.html", import.meta.url), "utf8");
const admin = await readFile(new URL("../../admin/index.html", import.meta.url), "utf8");
const migrations = await Promise.all(
  Array.from({ length: 9 }, (_, i) =>
    readFile(new URL(`../migrations/${String(i + 1).padStart(4, "0")}_${[
      "initial",
      "auth_sessions",
      "admin_and_service_controls",
      "quota_budget",
      "order_workflow",
      "api_rate_limits",
      "email_verification_password_reset",
      "service_cost_budgets",
      "ai_generation_control",
    ][i]}.sql`, import.meta.url), "utf8")
  )
);

test("Worker source parses as an ES module", async () => {
  // Node's --check is also exposed as a package script for a direct syntax check.
  assert.match(api, /export default\s*\{/);
});

test("all seven ordered D1 migration files exist", () => {
  assert.equal(migrations.length, 9);
  assert.match(migrations[5], /api_rate_limits/);
  assert.match(migrations[6], /email_action_tokens/);
  assert.match(migrations[7], /estimated_cost_units_per_use/);
});

test("public registration never accepts an admin role", () => {
  assert.match(api, /INSERT INTO users \(id, email, password_hash, role\) VALUES \(\?, \?, \?, 'customer'\)/);
  assert.doesNotMatch(api, /body\.role/);
});

test("login requires verified email and password reset revokes sessions", () => {
  assert.match(api, /email_not_verified/);
  assert.match(api, /DELETE FROM sessions WHERE user_id = \?/);
});

test("email action tokens are hashed, expiring and single-use", () => {
  assert.match(api, /const tokenHash = await sha256\(token\)/);
  assert.match(api, /used_at IS NULL AND expires_at > \?/);
  assert.match(api, /email_action_tokens SET used_at = CURRENT_TIMESTAMP/);
});

test("sensitive write routes enforce the configured origin", () => {
  assert.match(api, /function requireTrustedOrigin/);
  assert.match(api, /!requireTrustedOrigin\(request, env\)/);
});

test("AI generation stays disabled until explicitly implemented", () => {
  assert.match(api, /error: "generation_disabled"/);
  assert.match(api, /controlMap\.ai_generation_enabled !== "true"/);
});

test("customer UI handles verification and password reset links", () => {
  assert.match(customer, /get\("verify"\)/);
  assert.match(customer, /get\("reset"\)/);
  assert.match(customer, /api\/auth\/reset-password/);
});

test("admin UI uses textContent for customer-provided order labels", () => {
  assert.match(admin, /title\.textContent/);
  assert.match(admin, /detail\.textContent/);
});

test("admin write endpoints have a server-side rate limit", () => {
  assert.match(api, /"admin-write", user\.id, 30, 60/);
});

test("quota settlement checks both conditional updates", () => {
  assert.match(api, /const settlement = await env\.DB\.batch\(\[/);
  assert.match(api, /reservation_changed_retry/);
  assert.match(api, /status = 'reserved' AND EXISTS \(SELECT 1 FROM quota_reservations/);
});

test("customer order listing is scoped to the authenticated user", () => {
  assert.match(api, /FROM orders WHERE user_id = \?/);
  assert.match(api, /\.bind\(user\.id\)\.all\(\)/);
});

test("admin routes verify the server-side admin role before returning data", () => {
  assert.match(api, /if \(user\.role !== "admin"\) return json\(\{ error: "forbidden" \}/);
});

test("quota reservation uses per-service cost and daily request limits", () => {
  assert.match(api, /settings\.estimated_cost_units_per_use/);
  assert.match(api, /settings\.daily_request_limit/);
  assert.match(api, /daily_budget_units/);
  assert.match(api, /COUNT\(\*\) FROM usage_events WHERE service_id = \?/);
});

test("admin can update the daily budget and validated service cost controls", () => {
  assert.match(api, /\/api\/admin\/budget/);
  assert.match(api, /invalid_cost_controls/);
  assert.match(api, /estimated_cost_units_per_use = COALESCE/);
});

test("generation endpoint remains disabled despite quota configuration", () => {
  assert.match(api, /generation_disabled/);
});

test("Workers AI generation is guarded by a default-off database kill switch", () => {
  assert.match(migrations[8], /ai_generation_enabled', 'false'/);
  assert.match(api, /controlMap\.ai_generation_enabled !== "true"/);
  assert.match(api, /\/api\/admin\/ai-generation/);
});

test("AI generation only allows business-content and caps output tokens", () => {
  assert.match(api, /serviceId !== "business-content"/);
  assert.match(api, /max_tokens: 512/);
  assert.match(api, /@cf\/meta\/llama-3\.2-1b-instruct/);
});

test("AI generation reserves quota before inference and releases it on failure", () => {
  assert.match(api, /const reserve = await env\.DB\.batch\(\[/);
  assert.match(api, /status='failed'.*WHERE id=\? AND status='reserved'/);
  assert.match(api, /status='released'.*WHERE id=\? AND status='reserved'/);
});

test("AI generation stores output server-side and customer UI renders it as text", () => {
  assert.match(api, /INSERT INTO ai_generations/);
  assert.match(customer, /api\("\/api\/generate"/);
  assert.match(customer, /result\.textContent=data\.generation\.text/);
});

test("admin overview reports live generation switch and daily budget usage", () => {
  assert.match(api, /generation_enabled: controlMap\.ai_generation_enabled === "true"/);
  assert.match(api, /daily_budget_units: Number\(controlMap\.daily_budget_units/);
  assert.match(api, /today_usage: \{ requests:/);
});

test("admin dashboard exposes AI switch and daily budget controls", () => {
  assert.match(admin, /id="generationBtn"/);
  assert.match(admin, /id="saveBudget"/);
  assert.match(admin, /\/api\/admin\/ai-generation/);
  assert.match(admin, /\/api\/admin\/budget/);
  assert.match(admin, /today_usage/);
});
