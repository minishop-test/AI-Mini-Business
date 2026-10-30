# AI Mini Business API foundation

This folder is a **starter foundation**, not a finished production backend.

## Current behavior
- `GET /api/health`: health check.
- `GET /api/services`: returns the planned service list; all services are disabled.
- `POST /api/generate`: deliberately disabled. It returns an error and does not call an AI provider.

The API does not yet implement customer login, admin login, quotas, payment confirmation, file delivery, or actual AI generation. Do not expose it as a production ordering system until those parts are implemented and tested.

## Cloudflare setup (later)
1. Create a Cloudflare Worker in your own account.
2. Set the Worker entry point to `src/index.js`.
3. Create a D1 database and apply `migrations/0001_initial.sql`.
4. Bind the D1 database as `DB` when database-backed routes are added.
5. Configure `ALLOWED_ORIGIN` to the exact production website origin.
6. Keep AI generation disabled until server-side authentication, atomic quota reservation, usage accounting, rate limits, payment review, and the global pause control are complete.

No API keys, passwords, database IDs, or other secrets belong in this repository. Use Cloudflare secret/environment settings for private values.

## Cost safety
- Keep the Cloudflare account on a plan you have explicitly chosen.
- Do not enable paid AI providers or automatic overages by default.
- Monitor provider usage separately from Workers requests and storage.
- A front-end button or hidden field is not a security boundary; all limits must be enforced on the server.
