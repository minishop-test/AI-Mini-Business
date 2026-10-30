# AI Mini Business API foundation

This is a development foundation, not a production-ready service.

## Implemented API routes
- `GET /api/health`: health check.
- `GET /api/services`: service availability from D1 settings.
- `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/logout`.
- `POST /api/orders`, `GET /api/orders/me`: customer order submission and own-order listing.
- `GET /api/admin/customers`, `GET /api/admin/orders`: admin-only customer and order lists.
- `POST /api/admin/order`: admin-only order status transitions, quote, preview, notes and delivery link.
- `GET /api/admin/overview`: admin-only counts and service settings.
- `GET /api/admin/usage`: admin-only usage-event aggregates.
- `POST /api/admin/pause`: admin-only global AI pause setting.
- `POST /api/admin/service`: admin-only service enable/disable.
- `GET /api/quota/me`: customer quota snapshot by service.
- `POST /api/quota/reserve`: reserves one registered free use when the service is enabled, the global pause is off, the customer has remaining quota, and the daily budget permits it. This does not start AI generation.
- `POST /api/generate`: always disabled; no AI provider is called.

Authentication uses PBKDF2-SHA-256 password hashes with per-user salts and random session tokens stored as SHA-256 hashes. Session cookies are HttpOnly, Secure, SameSite=Lax.

## Apply D1 migrations in order
1. `migrations/0001_initial.sql`
2. `migrations/0002_auth_sessions.sql`
3. `migrations/0003_admin_and_service_controls.sql`
4. `migrations/0004_quota_budget.sql`
5. `migrations/0005_order_workflow.sql`

Bind the database as `DB`.

## Cloudflare deployment template
The folder includes `wrangler.toml` and `package.json`.

1. Install Node.js and run `npm install` inside `platform/worker`.
2. Create the D1 database using `npm run db:create`.
3. Copy the generated database ID into `wrangler.toml` in place of the placeholder.
4. Configure `ALLOWED_ORIGIN` to the exact public website origin (no trailing slash).
5. Apply migrations in order with `npm run db:migrate:remote`.
6. Deploy the API using `npm run deploy`.
7. Test `GET /api/health` and confirm `/api/services` can read D1.

For cookie-based login, use a custom domain arrangement on the same registrable domain, for example website `https://www.example.com` and API `https://api.example.com`. A Pages `.pages.dev` frontend calling a Worker `.workers.dev` API is cross-site and may have session cookies blocked by browser privacy settings. Configure CORS `ALLOWED_ORIGIN` to the exact frontend origin. Do not use wildcard origins.

The admin page is at `/platform/admin/`; the customer page is at `/platform/customer/`. These static files are served by the same Pages site as the root `index.html`.

## Configure the first administrator
Registration always creates a customer. There is intentionally no public admin-registration route.

1. Register your own account through the normal registration route after deploying a private test instance.
2. Find that account's ID in the D1 `users` table.
3. Promote only your own verified account using the D1 console:

```sql
UPDATE users SET role = 'admin' WHERE email = 'YOUR-VERIFIED-EMAIL';
```

Replace the placeholder with your own email. Never expose this SQL operation through a public endpoint. Keep the admin account's email and password private.

## Environment configuration
- `ALLOWED_ORIGIN`: exact website origin, including scheme, e.g. `https://example.com`. No wildcard.
- Keep `AI_ENABLED` unset or false.
- Keep `GLOBAL_PAUSE` unset or true; the generation route remains disabled regardless.

Browser requests must send credentials for the session cookie. State-changing routes require an exact Origin match with `ALLOWED_ORIGIN`.

## Current limitations — do not launch publicly yet
- No rate limiting or bot/abuse protection.
- No email verification, password reset, MFA, or account lockout.
- No CSRF token flow; Origin checking is only one layer of defense.
- Basic admin and customer HTML pages are in `../admin/index.html` and `../customer/index.html`; they are static interfaces and still need deployment and browser/API integration testing.
- Order workflow APIs support a manual review and payment process. There is no payment gateway or automatic email/file delivery.
- Quota reservations are a first-stage server-side gate for registered users. They do not yet implement guest trials, paid top-ups, automatic release/settlement, or reliable provider metering.
- Each reservation currently uses a conservative fixed estimate of 1,000 internal budget units; this is a placeholder, not a real Cloudflare Neurons or currency conversion.
- Service enable switches are configuration only; they do not enable generation.
- No AI provider integration; generated content, logo image generation, website ZIP packaging and automated delivery are not implemented.
- Security review and deployment testing are still required.

## Cost and secret safety
Do not put passwords, API keys, database identifiers, or private values in Git. Use Cloudflare secrets/bindings. Do not enable paid providers or automatic overages. AI generation stays disabled until server-side quotas, atomic reservations, budget enforcement, and monitoring are completed and tested.
