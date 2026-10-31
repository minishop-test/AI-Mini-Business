# Platform development area

This directory contains the new AI Mini Business backend foundation. It is intentionally separate from the existing root website.

## Important
- The current root `index.html`, backup file, PDF product, Google Form, Google Sheet, and Apps Script order/delivery workflow are not changed by this foundation.
- The new API is not connected to the live website yet.
- The API currently has no working authentication, admin dashboard, payment automation, or AI generation.
- AI generation is disabled by default.

## Planned stages
1. Backend foundation and database schema.
2. Secure registration/login and server-side sessions.
3. Admin controls, service toggles, usage dashboard, and global pause.
4. Server-enforced guest/account quotas and daily resource limits.
5. Service generation workflows, order review, payment confirmation, and delivery.
6. Customer website ZIP templates with independent backend, admin portal, database migrations, and self-deployment guide.

Generated customer websites must use the customer's own hosting, database, and secrets. Never include AI Mini Business platform secrets in a customer ZIP.

## Customer website starter template
The `customer-site/` directory is a separate starter project for customer-owned storefronts. It includes a static storefront, Worker API, D1 schema, Wrangler configuration and deployment guide. Each customer must deploy it into their own Cloudflare account and configure their own D1 database and Worker secret. It does not reuse the platform database or secrets. It is a starter template, not a production-ready ecommerce platform; see its README for current limitations. ZIP generation and per-order customization are future tasks.
