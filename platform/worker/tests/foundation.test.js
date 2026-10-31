import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const api = await readFile(new URL("../src/index.js", import.meta.url), "utf8");
const customerTemplate = await readFile(new URL("../src/customer-site-template.js", import.meta.url), "utf8");
const customer = await readFile(new URL("../../customer/index.html", import.meta.url), "utf8");
const admin = await readFile(new URL("../../admin/index.html", import.meta.url), "utf8");
const customerSiteApi = await readFile(new URL("../../customer-site/src/index.js", import.meta.url), "utf8");
const customerSiteHtml = await readFile(new URL("../../customer-site/site/index.html", import.meta.url), "utf8");
const customerSiteSchema = await readFile(new URL("../../customer-site/schema.sql", import.meta.url), "utf8");
const customerSiteReadme = await readFile(new URL("../../customer-site/README.md", import.meta.url), "utf8");
const customerAdmin = await readFile(new URL("../../customer-site/site/admin.html", import.meta.url), "utf8");
const zipBuilder = await readFile(new URL("../../customer-site/tools/build-zip.mjs", import.meta.url), "utf8");
const customerPackage = JSON.parse(await readFile(new URL("../../customer-site/package.json", import.meta.url), "utf8"));
const migrations = await Promise.all(
  Array.from({ length: 11 }, (_, i) =>
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
      "order_packages",
      "order_revisions",
    ][i]}.sql`, import.meta.url), "utf8")
  )
);

test("Worker source parses as an ES module", async () => {
  // Node's --check is also exposed as a package script for a direct syntax check.
  assert.match(api, /export default\s*\{/);
});

test("all seven ordered D1 migration files exist", () => {
  assert.equal(migrations.length, 11);
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
  assert.match(api, /!\["business-content", "website"\]\.includes\(serviceId\)/);
  assert.match(api, /max_tokens: isWebsite \? 900 : 512/);
  assert.match(api, /@cf\/meta\/llama-3\.2-1b-instruct/);
});

test("AI website generation returns a validated configuration and bounded product suggestions", () => {
  assert.match(api, /const isWebsite = serviceId === "website"/);
  assert.match(api, /Chỉ trả về MỘT JSON object hợp lệ/);
  assert.match(api, /websiteConfig\.primaryColor/);
  assert.match(api, /websiteConfig\.products\.length > 8/);
  assert.match(api, /priceVnd/);
  assert.match(api, /generation: isWebsite/);
  assert.match(api, /max_tokens: isWebsite \? 900 : 512/);
});

test("AI website generation creates a pending-review order with the generated JSON preview", () => {
  assert.match(api, /INSERT INTO orders \(id, user_id, service_id, status, customer_brief, preview_text, amount_vnd\)/);
  assert.match(api, /'website', 'pending_review'/);
  assert.match(api, /order: websiteOrder \? \{ id: websiteOrder.id, status: "pending_review" \} : null/);
  assert.match(customer, /data\.order\?\.id/);
  assert.match(customer, /Promise\.all\(\[refreshQuota\(\),refreshOrders\(\)\]\)/);
});

test("customer dashboard exposes website generation and a JSON config download", () => {
  assert.match(customer, /id="websiteDraftForm"/);
  assert.match(customer, /service_id:"website"/);
  assert.match(customer, /website_config/);
  assert.match(customer, /downloadWebsiteConfig/);
  assert.match(customer, /website-config\.json/);
  assert.match(customer, /URL\.createObjectURL/);
});

test("website generation still requires an explicit admin enable switch and a quota reservation", () => {
  assert.match(api, /controlMap\.ai_generation_enabled !== "true"/);
  assert.match(api, /const reserve = await env\.DB\.batch\(\[/);
  assert.match(api, /daily_budget_units/);
  assert.match(api, /serviceId === "website"/);
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

test("customer website starter has independent D1 schema and isolated backend", () => {
  assert.match(customerSiteSchema, /CREATE TABLE IF NOT EXISTS products/);
  assert.match(customerSiteSchema, /CREATE TABLE IF NOT EXISTS orders/);
  assert.match(customerSiteApi, /env\.DB/);
  assert.doesNotMatch(customerSiteApi, /ai-mini-business-db|RESEND_API_KEY/);
});

test("customer starter protects admin endpoints with a server-side secret", () => {
  assert.match(customerSiteApi, /function isAdmin/);
  assert.match(customerSiteApi, /ADMIN_API_TOKEN/);
  assert.match(customerSiteApi, /\/api\/admin\/orders/);
  assert.match(customerSiteApi, /\/api\/admin\/products/);
  assert.match(customerSiteApi, /untrusted_origin/);
});

test("customer storefront uses safe text rendering and submits orders through its own API", () => {
  assert.match(customerSiteHtml, /const API_BASE=/);
  assert.match(customerSiteHtml, /textContent=p\.name/);
  assert.match(customerSiteHtml, /\/api\/orders/);
});

test("customer starter documents independent deployment and missing production features", () => {
  assert.match(customerSiteReadme, /D1 database/);
  assert.match(customerSiteReadme, /ADMIN_API_TOKEN/);
  assert.match(customerSiteReadme, /chưa phải nền tảng thương mại điện tử production-ready/);
});

test("customer site has a real admin dashboard for products and orders", () => {
  assert.match(customerSiteHtml, /admin\.html/);
  assert.match(customerSiteApi, /SELECT id,name,description,price_vnd,image_url,active,created_at FROM products/);
  assert.match(customerSiteApi, /PATCH/);
  assert.match(customerSiteApi, /invalid_product_status/);
  assert.ok(customerSiteApi.includes("UPDATE products SET name=?,description=?,price_vnd=?,image_url=?,active=? WHERE id=?"));
});

test("customer admin dashboard uses session-only token and safe DOM text rendering", () => {
  assert.match(customerAdmin, /let adminToken=""/);
  assert.doesNotMatch(customerAdmin, /localStorage|sessionStorage/);
  assert.match(customerAdmin, /textContent/);
  assert.match(customerAdmin, /\/api\/admin\/products/);
  assert.match(customerAdmin, /\/api\/admin\/orders/);
  assert.match(customerAdmin, /ADMIN_API_TOKEN/);
});

test("customer ZIP builder packages all deployable source files without platform secrets", () => {
  for (const file of ["README.md", "package.json", "wrangler.toml", "schema.sql", "src/index.js", "site/index.html", "site/admin.html"]) {
    assert.ok(zipBuilder.includes('"'+file+'"'), "ZIP must include "+file);
  }
  assert.match(zipBuilder, /zipSync/);
  assert.doesNotMatch(zipBuilder, /ADMIN_API_TOKEN|RESEND_API_KEY|CLOUDFLARE_API_TOKEN|Bearer\\s/);
  assert.equal(customerPackage.scripts["build:zip"], "node tools/build-zip.mjs");
  assert.match(customerPackage.dependencies.fflate, /0\.8/);
});

test("customer ZIP builder supports API and Pages origin configuration", () => {
  assert.match(zipBuilder, /--api-url/);
  assert.match(zipBuilder, /--pages-origin/);
  assert.match(zipBuilder, /REPLACE-WITH-YOUR-WORKER/);
  assert.match(zipBuilder, /REPLACE-WITH-YOUR-PAGES/);
});

test("customer ZIP builder personalizes storefront branding and creates product seed SQL", () => {
  assert.match(zipBuilder, /storeName/);
  assert.match(zipBuilder, /tagline/);
  assert.match(zipBuilder, /primaryColor/);
  assert.match(zipBuilder, /seed-products\.sql/);
  assert.match(zipBuilder, /priceVnd/);
  assert.match(zipBuilder, /https:/);
  assert.match(zipBuilder, /--config/);
  assert.match(zipBuilder, /slice\(0, 30\)/);
  assert.match(zipBuilder, /safeColor/);
});

test("generated customer ZIP applies the selected visual design and safely escapes customer content", () => {
  assert.match(api, /value\.replace\("<body>", '<body class="theme-'/);
  assert.match(api, /theme-bold/);
  assert.match(api, /theme-editorial/);
  assert.match(api, /repeat\("\+columns\+"/);
  assert.match(api, /store-nav/);
  assert.match(api, /store-hero/);
  assert.match(api, /esc\(storeName\)/);
  assert.match(api, /esc\(tagline\)/);
  assert.match(api, /esc\(heroImageUrl\)/);
  assert.match(api, /esc\(p\.slice\(0,40\)\)/);
  assert.match(api, /primaryColor/);
});

test("website orders cannot be marked delivered until a private ZIP exists", () => {
  assert.match(api, /website_package_required/);
  assert.match(api, /deliveryCheck\?\.service_id === "website" && !deliveryCheck\.package_key/);
  assert.match(api, /order\.status !== "delivered" \|\| !order\.package_key/);
  assert.match(api, /package_storage_not_configured/);
});

test("admin can generate a personalized website ZIP directly from a paid website order", () => {
  assert.match(api, /import \{ zipSync, strToU8 \} from "fflate"/);
  assert.match(api, /CUSTOMER_SITE_FILES/);
  assert.match(api, /\/api\/admin\/build-website-package/);
  assert.match(api, /order\.service_id !== "website"/);
  assert.match(api, /!\["paid", "processing"\]\.includes\(order\.status\)/);
  assert.match(api, /zipSync\(files, \{ level: 6 \}\)/);
  assert.match(api, /seed-products\.sql/);
  assert.match(api, /store-config\.json/);
  assert.match(api, /env\.PACKAGES\.put\(key, zip/);
  assert.match(api, /website_package_generated/);
  assert.match(admin, /id="buildPackage"/);
  assert.match(admin, /buildWebsitePackage/);
});

test("bundled website template contains isolated customer frontend, API and deployment instructions", () => {
  for (const file of ["README.md","package.json","wrangler.toml","schema.sql","src/index.js","site/index.html","site/admin.html"]) {
    assert.ok(customerTemplate.includes('"'+file+'"'), "missing bundled template "+file);
  }
  assert.match(customerTemplate, /ADMIN_API_TOKEN/);
  assert.match(customerTemplate, /CREATE TABLE IF NOT EXISTS products/);
  assert.match(customerTemplate, /customer-store-api/);
});

test("visual editor supports layout templates, product columns, banner and device preview", () => {
  assert.match(customer, /id="editTemplate"/);
  assert.match(customer, /id="editColumns"/);
  assert.match(customer, /id="editHeroImage"/);
  assert.match(customer, /id="editHeroTitle"/);
  assert.match(customer, /id="editViewport"/);
  assert.match(customer, /pv-editorial/);
  assert.match(customer, /pv-mobile/);
  assert.match(customer, /--pv-cols/);
  assert.match(customer, /banner\.src=cfg\.heroImageUrl/);
  assert.match(api, /const template = \["minimal","bold","editorial"\]/);
  assert.match(api, /const productColumns = \[2,3,4\]/);
  assert.match(api, /const heroImageUrl/);
  assert.match(api, /const heroTitle/);
});

test("customer storefront admin uses expiring hashed sessions and deployment schema includes session table", () => {
  assert.match(customerSiteApi, /async function hashSessionToken/);
  assert.match(customerSiteApi, /admin_sessions WHERE token_hash=\?/);
  assert.match(customerSiteApi, /expires_at > CURRENT_TIMESTAMP/);
  assert.match(customerSiteApi, /api\/admin\/login/);
  assert.match(customerSiteApi, /datetime\('now','\+30 minutes'\)/);
  assert.match(customerSiteApi, /api\/admin\/logout/);
  assert.match(customerSiteApi, /DELETE FROM admin_sessions/);
  assert.match(customerSiteApi, /await isAdmin\(request, env\)/);
  assert.match(customerAdmin, /api\/admin\/login/);
  assert.match(customerAdmin, /expires_in/);
  assert.match(customerAdmin, /api\/admin\/logout/);
  assert.match(customerSiteSchema, /CREATE TABLE IF NOT EXISTS admin_sessions/);
  assert.match(customerSiteReadme, /phiên đăng nhập ngắn hạn/);
  assert.match(customerSiteReadme, /0002_admin_sessions\.sql/);
});

test("customer storefront admin awaits session checks and throttles failed login attempts", () => {
  assert.match(customerSiteApi, /await isAdmin\(request, env\)/);
  assert.doesNotMatch(customerSiteApi, /if \(!isAdmin\(request, env\)\)/);
  assert.match(customerSiteApi, /admin_login_attempts/);
  assert.match(customerSiteApi, /attempts\.attempts >= 5/);
  assert.match(customerSiteApi, /15 \* 60 \* 1000/);
  assert.match(customerSiteApi, /login_rate_limited/);
  assert.match(customerSiteSchema, /CREATE TABLE IF NOT EXISTS admin_login_attempts/);
  assert.match(customerAdmin, /api\/admin\/login/);
});

test("customer storefront records admin mutations and exposes a protected read-only audit log", () => {
  assert.match(customerSiteApi, /async function writeAudit/);
  assert.match(customerSiteApi, /INSERT INTO admin_audit_log/);
  assert.ok(customerSiteApi.includes('"product.updated"'));
  assert.ok(customerSiteApi.includes('"order.delivery_file_uploaded"'));
  assert.ok(customerSiteApi.includes('"order.payment_delivery_updated"'));
  assert.match(customerSiteApi, /await isAdmin\(request, env\)/);
  assert.match(customerSiteSchema, /CREATE TABLE IF NOT EXISTS admin_audit_log/);
  assert.match(customerAdmin, /id="auditLog"/);
  assert.ok(customerAdmin.includes('api("/api/admin/audit-log")'));
  assert.match(customerAdmin, /entry\.action/);
  assert.match(customerSiteReadme, /D1 export/);
  assert.match(customerSiteReadme, /0003_admin_audit_log\.sql/);
});

test("customer admin dashboard provides local product and order search fields", () => {
  assert.match(customerAdmin, /id="productSearch"/);
  assert.match(customerAdmin, /id="orderSearch"/);
  assert.match(customerAdmin, /function filterRows/);
  assert.match(customerAdmin, /toLocaleLowerCase\("vi"\)/);
});

test("private delivery uploads reject oversized multipart requests before parsing", () => {
  assert.match(customerSiteApi, /content-length/);
  assert.match(customerSiteApi, /upload_too_large/);
  assert.match(customerSiteApi, /20 \* 1024 \* 1024/);
});

test("order cannot be marked delivered until a private delivery file exists", () => {
  assert.match(customerSiteApi, /delivery_file_required_before_completion/);
  assert.match(customerSiteApi, /SELECT order_id FROM order_deliveries WHERE order_id=\?/);
});

test("download token is consumed only after authorization and private object retrieval", () => {
  const tokenRead = customerSiteApi.indexOf("SELECT order_id FROM delivery_download_tokens");
  const objectRead = customerSiteApi.indexOf("env.DELIVERIES.get(file.object_key)", tokenRead);
  const consume = customerSiteApi.indexOf("UPDATE delivery_download_tokens SET used_at=CURRENT_TIMESTAMP", tokenRead);
  assert.ok(tokenRead >= 0 && objectRead > tokenRead && consume > objectRead);
});

test("customer order admin separates payment confirmation from delivery", () => {
  assert.match(customerSiteSchema, /payment_status TEXT NOT NULL DEFAULT 'pending'/);
  assert.match(customerSiteSchema, /delivery_status TEXT NOT NULL DEFAULT 'pending'/);
  assert.match(customerSiteApi, /payment_required_before_delivery/);
  assert.ok(customerSiteApi.includes('"order.payment_delivery_updated"'));
  assert.match(customerAdmin, /payment_status:payment\.value,delivery_status:delivery\.value/);
  assert.match(customerAdmin, /Chưa thanh toán/);
  assert.match(customerAdmin, /Chưa bàn giao/);
  assert.match(customerSiteReadme, /0004_payment_delivery\.sql/);
});

test("customer storefront and API do not collect or expose customer phone numbers", () => {
  assert.doesNotMatch(customerSiteHtml, /customerPhone|customer_phone/);
  assert.doesNotMatch(customerAdmin, /customer_phone|Điện thoại/);
  assert.doesNotMatch(customerSiteApi, /customer_phone/);
  assert.match(customerSiteApi, /INSERT INTO orders \(id,customer_name,customer_email,product_id/);
});

test("customer admin shows expandable order details and responsive mobile layout", () => {
  assert.match(customerAdmin, /details\.textContent="Chi tiết"/);
  assert.doesNotMatch(customerAdmin, /customer_phone/);
  assert.match(customerAdmin, /unit_price_vnd/);
  assert.match(customerAdmin, /dataset\.detailFor/);
  assert.match(customerAdmin, /@media\(max-width:640px\)/);
  assert.match(customerAdmin, /overflow-x:auto/);
});

test("customer storefront admin can edit product fields and export orders as CSV", () => {
  assert.match(customerSiteApi, /UPDATE products SET name=\?,description=\?,price_vnd=\?,image_url=\?,active=\?/);
  assert.match(customerSiteApi, /product\.updated/);
  assert.match(customerSiteApi, /invalid_product_price/);
  assert.match(customerAdmin, /id="exportOrders"/);
  assert.match(customerAdmin, /don-hang\.csv/);
  assert.ok(customerAdmin.includes('api("/api/admin/products/"+p.id'));
});

test("customer can edit website draft fields and save through authenticated revision endpoint", () => {
  assert.match(api, /websiteConfigMatch/);
  assert.match(api, /UPDATE orders SET preview_text/);
  assert.match(api, /status='pending_review'/);
  assert.match(api, /INSERT INTO order_revisions/);
  assert.match(customer, /id="visualEditorCard"/);
  assert.match(customer, /function loadVisualEditor/);
  assert.match(customer, /function readEditorConfig/);
  assert.match(customer, /Mở trình chỉnh sửa trực quan/);
  assert.match(customer, /website-config/);
  assert.match(customer, /Lưu thay đổi/);
  assert.match(customer, /Hoàn tác/);
});

test("customer dashboard renders a visual website preview with safe DOM text and bounded images", () => {
  assert.match(customer, /id="websiteLivePreview"/);
  assert.match(customer, /function renderStorePreview/);
  assert.match(customer, /productName\.textContent/);
  assert.match(customer, /name\.textContent/);
  assert.match(customer, /primaryColor/);
  assert.match(customer, /products\.slice\(0,8\)/);
  assert.match(customer, /https:/);
  assert.match(customer, /renderStorePreview\(visual,cfg\)/);
});

test("website revisions are limited to the customer's own pending-review order", () => {
  assert.match(api, /WHERE id = \? AND user_id = \? AND service_id = 'website'/);
  assert.match(api, /revisionOrder.status !== "pending_review"/);
  assert.match(api, /UPDATE orders SET preview_text = \?[^\n]*status = 'pending_review'/);
  assert.match(api, /INSERT INTO order_revisions/);
  assert.match(api, /const websiteOrder = isWebsite \? \(revisionOrder/);
  assert.match(customer, /Yêu cầu AI chỉnh sửa website/);
  assert.match(customer, /order_id:o.id/);
  assert.match(customer, /Gửi yêu cầu chỉnh sửa/);
});

test("website revision history migration is scoped to order and user", () => {
  assert.match(migrations[10], /CREATE TABLE IF NOT EXISTS order_revisions/);
  assert.match(migrations[10], /order_id TEXT NOT NULL REFERENCES orders/);
  assert.match(migrations[10], /user_id TEXT NOT NULL REFERENCES users/);
});

test("order package migration stores only private package metadata", () => {
  assert.match(migrations[9], /package_key TEXT/);
  assert.match(migrations[9], /package_size INTEGER/);
  assert.match(migrations[9], /package_uploaded_at TEXT/);
});

test("admin package upload requires a paid or processing order and private R2 storage", () => {
  assert.match(api, /url\.pathname === "\/api\/admin\/order-package"/);
  assert.match(api, /if \(!\["paid", "processing"\]\.includes\(order\.status\)\)/);
  assert.match(api, /env\.PACKAGES\.put\(key, bytes/);
  assert.match(api, /application\/zip/);
  assert.match(api, /10 \* 1024 \* 1024/);
  assert.match(api, /0x04034b50/);
});

test("customer ZIP download requires ownership, delivered status and private R2 object", () => {
  assert.match(api, /packageMatch = url\.pathname\.match/);
  assert.match(api, /WHERE id = \? AND user_id = \? LIMIT 1/);
  assert.match(api, /order\.status !== "delivered"/);
  assert.match(api, /env\.PACKAGES\.get\(order\.package_key\)/);
  assert.match(customer, /Tải website ZIP đã bàn giao/);
});

test("admin UI uploads ZIP as binary and customer ZIP download is authenticated", () => {
  assert.match(admin, /id="packageFile"/);
  assert.match(admin, /uploadOrderPackage/);
  assert.match(admin, /content-type":"application\/zip"/);
  assert.match(admin, /body:file/);
  assert.match(admin, /api\/admin\/order-package/);
  assert.match(customer, /Tải website ZIP đã bàn giao/);
});

test("Worker declares a private R2 bucket binding for deliverables", () => {
  const wrangler = readFile(new URL("../wrangler.toml", import.meta.url), "utf8");
});

test("customer website documents the required product seed step", () => {
  assert.match(customerSiteReadme, /seed-products\.sql/);
  assert.match(customerSiteReadme, /store\.json/);
  assert.match(customerSiteReadme, /tối đa 30 sản phẩm/);
});
