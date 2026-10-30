# AI Mini Business API foundation

This is a development foundation, not a production-ready service.

## Implemented API routes
- `GET /api/health`: health check.
- `GET /api/services`: service availability from D1 settings.
- `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/logout`.
- `GET /api/admin/overview`: admin-only counts and service settings.
- `GET /api/admin/usage`: admin-only usage-event aggregates.
- `POST /api/admin/pause`: admin-only global AI pause setting.
- `POST /api/admin/service`: admin-only service enable/disable.
- `POST /api/generate`: always disabled; no AI provider is called.

Authentication uses PBKDF2-SHA-256 password hashes with per-user salts and random session tokens stored as SHA-256 hashes. Session cookies are HttpOnly, Secure, SameSite=Lax.

## Apply D1 migrations in order
1. `migrations/0001_initial.sql`
2. `migrations/0002_auth_sessions.sql`
3. `migrations/0003_admin_and_service_controls.sql`

Bind the database as `DB`.

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
- Admin APIs are implemented, but there is no admin web interface.
- Usage overview only reads event records; no quota reservation or reliable provider metering is implemented.
- Service enable switches are configuration only; they do not enable generation.
- No order review, payment confirmation, file delivery, or AI provider integration.
- Security review and deployment testing are still required.

## Cost and secret safety
Do not put passwords, API keys, database identifiers, or private values in Git. Use Cloudflare secrets/bindings. Do not enable paid providers or automatic overages. AI generation stays disabled until server-side quotas, atomic reservations, budget enforcement, and monitoring are completed and tested.
