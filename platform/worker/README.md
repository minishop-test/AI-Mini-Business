# AI Mini Business API foundation

This folder is a **development foundation**, not a production-ready service.

## Implemented in this branch
- `GET /api/health`: health check.
- `GET /api/services`: planned services; all are disabled.
- `POST /api/auth/register`: customer registration.
- `POST /api/auth/login`: customer login.
- `GET /api/auth/me`: current session lookup.
- `POST /api/auth/logout`: revoke current session.
- Passwords are stored as PBKDF2-SHA-256 hashes with per-user random salts.
- Session tokens are random, stored as SHA-256 hashes, and sent in Secure, HttpOnly, SameSite=Lax cookies.
- `POST /api/generate`: deliberately disabled; it does not call an AI provider.

## Important limitations
This is not ready for public production use yet. It still needs rate limiting / abuse protection, email verification and password reset, admin provisioning and role-protected admin routes, atomic quotas, usage accounting, order review, payment confirmation, file delivery, logging/monitoring, and security testing. Do not treat the current customer authentication as a complete account system.

## Database setup
Apply both migrations in order to a new Cloudflare D1 database:
1. `migrations/0001_initial.sql`
2. `migrations/0002_auth_sessions.sql`

Bind the D1 database to the Worker as `DB`.

## Environment configuration
- `ALLOWED_ORIGIN`: exact origin of the deployed website, including scheme, e.g. `https://example.com`. Do not use a wildcard.
- `AI_ENABLED`: keep unset or set to `false`.
- `GLOBAL_PAUSE`: keep unset or set to `true`.

For browser requests, use credentials so the session cookie is sent. The API currently accepts state-changing authentication requests only when the request Origin exactly matches `ALLOWED_ORIGIN`. Deploy the frontend and API on compatible origins and test cookie behavior before launch.

No API keys, passwords, database IDs, or other secrets belong in this repository. Use Cloudflare secret/environment settings for private values.

## Cost safety
- Keep the Cloudflare account on a plan you have explicitly chosen.
- Do not enable paid AI providers or automatic overages by default.
- Monitor provider usage separately from Workers requests and storage.
- A front-end button or hidden field is not a security boundary; all limits must be enforced on the server.
- AI generation remains disabled until quotas, budgets, and the global pause are implemented and tested.
